import path from "path";
import type { FsLike } from "./fs";
import type { JdSurveyConfig } from "./config";
import { deriveKeys } from "./config";
import type { Frontmatter, SurveyBy, SurveyObject } from "./types";
import { resolveFsPath } from "./pathResolver";
import { walk } from "./walker";
import { formatDate } from "./date";
import { renderCallout, renderSkeleton, renderWithProse, renderEmbed, matchSection, replaceSnapshotCallout, sectionHasEmbedFence, sectionHasProse } from "./renderer";
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
  const embed = (deps.embedEnabled && res.embedRel)
    ? renderEmbed(res.embedRel, cfg.embedVirtualDir) : undefined;

  const existingBy = obj["by"] as SurveyBy | undefined;
  const proseProtected = existingBy === "claude-code" || existingBy === "human";

  // ── Surgical protected path ──
  // When the slot is provenance-protected AND its existing section carries real
  // prose, we NEVER re-render the section. Instead we take the existing section
  // verbatim and transform it minimally: refresh the snapshot callout in place
  // and, if the section has no EmbedRelativeTo fence yet, append a fresh embed.
  // Hand-authored callouts, blockquotes, and embeds are preserved byte-for-byte.
  // (An empty protected section — no real prose — is a dead end; we fall through
  //  to the normal flow so the note can be regenerated and un-stuck.)
  if (proseProtected) {
    const existingSection = matchSection(body);
    if (existingSection && sectionHasProse(existingSection)) {
      let section = replaceSnapshotCallout(existingSection, callout);
      if (embed && !sectionHasEmbedFence(existingSection)) {
        section = section.trimEnd() + "\n\n" + embed;
      }
      // Normalize a single trailing newline to match renderer output shape.
      section = section.trimEnd() + "\n";
      const by = existingBy as SurveyBy;
      const survey: SurveyObject = { at: dateStr, items: w.items, depth, by, stubs: w.stubs };
      return { status: "surveyed", reason: "ok", by, section, survey };
    }
    // else: empty protected section → fall through to the normal unprotected flow.
  }

  let prose: string | null = null;
  let keptExisting = false;

  if (cfg.llmEnabled && cfg.proseProvider !== "skeleton") {
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

  // Fix 2: a no-new-prose run (LLM disabled, skeleton provider, or provider
  // failure) must not clobber existing prose with the TODO placeholder. If we
  // produced no fresh prose and didn't already keep something, salvage the
  // existing prose. The trailing-embed strip in extractExistingProse prevents a
  // double embed when this kept prose is re-rendered with the fresh embed below.
  if (!prose && !keptExisting) {
    const existing = extractExistingProse(body);
    if (existing) { prose = existing; keptExisting = true; }
  }

  // Fix 3: never fabricate `human` (or `claude-code`) provenance. The only path
  // that yields protected provenance is the surgical path above (which returns
  // early). Every kept-existing path here — judge-KEEP, Fix-2 keep — stamps
  // jd-survey-llm unless the note already carried a valid `by` value.
  let by: SurveyBy;
  if (keptExisting) {
    by = (obj["by"] as SurveyBy) || "jd-survey-llm";
  } else {
    by = prose ? "jd-survey-llm" : "jd-survey";
  }
  const section = prose ? renderWithProse(callout, prose, embed) : renderSkeleton(callout, embed);
  const survey: SurveyObject = { at: dateStr, items: w.items, depth, by, stubs: w.stubs };
  return { status: "surveyed", reason: "ok", by, section, survey };
}
