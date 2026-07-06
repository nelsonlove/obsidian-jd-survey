import path from "path";
import type { FsLike } from "./fs";
import type { JdSurveyConfig } from "./config";
import { deriveKeys } from "./config";
import type { Frontmatter, SurveyBy, SurveyObject } from "./types";
import { resolveFsPath } from "./pathResolver";
import { walk } from "./walker";
import { formatDate } from "./date";
import { renderCallout, renderSkeleton, renderWithProse } from "./renderer";
import { buildTree, buildLlmPrompt } from "./prose";
import type { RequestFn } from "./anthropic";
import { generateProseFrom } from "./proseSource";
import type { ExecFn } from "./claudeCli";

export interface SurveyDeps { fs: FsLike; today: Date; request: RequestFn | null; exec: ExecFn | null; }
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

  let prose: string | null = null;
  if (cfg.llmEnabled && cfg.proseProvider !== "skeleton") {
    const jdid = (fm["jd-id"] as string) || relPath.split("/").pop()!.split(" ")[0];
    const title = (fm["title"] as string) || path.posix.basename(relPath, ".md").split(" ").slice(1).join(" ");
    const tree = buildTree(res.fsPath, depth, deps.fs, res.skipPath ?? undefined);
    const prompt = buildLlmPrompt({ jdid, title, fsPath: res.fsPath, count: w.items, depth, tree });
    prose = await generateProseFrom(prompt, cfg, { request: deps.request, exec: deps.exec });
  }

  const by: SurveyBy = prose ? "jd-survey-llm" : "jd-survey";
  const section = prose ? renderWithProse(callout, prose) : renderSkeleton(callout);
  const survey: SurveyObject = { at: dateStr, items: w.items, depth, by, stubs: w.stubs };
  return { status: "surveyed", reason: "ok", by, section, survey };
}
