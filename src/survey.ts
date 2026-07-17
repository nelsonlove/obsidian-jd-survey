import path from "path";
import type { FsLike } from "./fs";
import type { JdSurveyConfig } from "./config";
import { deriveKeys } from "./config";
import type { Frontmatter, SurveyBy, SurveyObject } from "./types";
import { resolveFsPath } from "./pathResolver";
import { walk } from "./walker";
import { formatDate } from "./date";
import { renderCallout, renderSkeleton, renderWithProse, renderEmbed } from "./renderer";
import { buildTree, buildLlmPrompt, buildJudgePrompt, extractExistingProse, extractEmbeddedCount, COUNT_DRIFT_REWRITE_THRESHOLD } from "./prose";
import type { RequestFn } from "./anthropic";
import { generateProseFrom } from "./proseSource";
import type { ExecFn } from "./claudeCli";

export interface SurveyDeps { fs: FsLike; today: Date; request: RequestFn | null; exec: ExecFn | null; embedEnabled: boolean; }
export interface SurveyResult {
  status: "surveyed" | "skipped";
  reason: string;
  by?: SurveyBy;
  section?: string;
  survey?: SurveyObject;
}

export async function surveyNote(
  relPath: string, fm: Frontmatter, body: string, cfg: JdSurveyConfig, deps: SurveyDeps,
): Promise<SurveyResult> {
  const keys = deriveKeys(cfg.frontmatterPrefix);
  const res = resolveFsPath(relPath, fm, cfg, keys, deps.fs);
  if (res.kind === "optout") return { status: "skipped", reason: "optout" };
  if (res.kind === "no-mapping") return { status: "skipped", reason: "no-mapping" };

  const obj = (fm[keys.object] && typeof fm[keys.object] === "object")
    ? (fm[keys.object] as Record<string, unknown>) : {};
  const depth = typeof obj["depth"] === "number" && obj["depth"] > 0
    ? Math.trunc(obj["depth"] as number) : cfg.defaultDepth;

  const w = walk(res.fsPath, depth, deps.fs, res.skipPath ?? undefined);
  if (w.items === 0) return { status: "skipped", reason: "empty" };

  const dateStr = formatDate(deps.today, cfg.dateFormat);
  const callout = renderCallout(w.items, dateStr, depth, w.stubs);

  const existingBy = obj["by"] as SurveyBy | undefined;
  const proseProtected = existingBy === "claude-code" || existingBy === "human";

  let prose: string | null = null;
  let keptExisting = false;

  // Provenance gate: never overwrite skill/human-authored prose. Applies even
  // when llmEnabled is false, so skeleton runs don't clobber protected prose.
  if (proseProtected) {
    const existing = extractExistingProse(body);
    if (existing) { prose = existing; keptExisting = true; }
    else { keptExisting = true; }  // protected slot with no extractable prose: still block LLM; emit skeleton, preserve provenance
  }

  if (!keptExisting && cfg.llmEnabled && cfg.proseProvider !== "skeleton") {
    const jdid = (fm["jd-id"] as string) || relPath.split("/").pop()!.split(" ")[0];
    const title = (fm["title"] as string) || path.posix.basename(relPath, ".md").split(" ").slice(1).join(" ");
    const tree = buildTree(res.fsPath, depth, deps.fs, res.skipPath ?? undefined);
    const proseDeps = { request: deps.request, exec: deps.exec };

    if (cfg.keepIfAccurate) {
      const existing = extractExistingProse(body);
      if (existing) {
        let forceRewrite = false;
        const embedded = extractEmbeddedCount(existing);
        if (embedded !== null && embedded > 0) {
          forceRewrite = Math.abs(embedded - w.items) / embedded >= COUNT_DRIFT_REWRITE_THRESHOLD;
        }
        if (!forceRewrite) {
          const verdict = await generateProseFrom(
            buildJudgePrompt({ jdid, title, count: w.items, existing, tree }), cfg, proseDeps);
          if (verdict && verdict.trim().toUpperCase().startsWith("KEEP")) {
            prose = existing;
            keptExisting = true;
          }
        }
      }
    }

    if (!keptExisting) {
      const prompt = buildLlmPrompt({ jdid, title, fsPath: res.fsPath, count: w.items, depth, tree });
      prose = await generateProseFrom(prompt, cfg, proseDeps);
    }
  }

  let by: SurveyBy;
  if (keptExisting) {
    by = (obj["by"] as SurveyBy) || "human";   // preserve existing provenance
  } else {
    by = prose ? "jd-survey-llm" : "jd-survey";
  }
  const embed = (deps.embedEnabled && res.embedRel) ? renderEmbed(res.embedRel) : undefined;
  const section = prose ? renderWithProse(callout, prose, embed) : renderSkeleton(callout, embed);
  const survey: SurveyObject = { at: dateStr, items: w.items, depth, by, stubs: w.stubs };
  return { status: "surveyed", reason: "ok", by, section, survey };
}
