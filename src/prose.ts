import type { FsLike } from "./fs";
import { isBundle, isIcloudStub, icloudOriginalName, isVisible } from "./walker";
import { matchSection, PROSE_PLACEHOLDER } from "./renderer";

// ── embedded-count regex + threshold (ported from jd-survey.py lines 68–72) ──

export const EMBEDDED_COUNT_RE =
  /^\s*(?:about\s+|roughly\s+|approximately\s+|~)?(\d+)\s+(?:items?|files?|documents?|pdfs?|notes?|emails?|records?)\b/i;

export const COUNT_DRIFT_REWRITE_THRESHOLD = 0.5;

// ── extractEmbeddedCount (ported from jd-survey.py lines 584–596) ──

export function extractEmbeddedCount(prose: string): number | null {
  const firstLine = prose.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  const m = EMBEDDED_COUNT_RE.exec(firstLine);
  return m ? Number(m[1]) : null;
}

// ── buildTree (ported from jd-survey.py lines 357–393) ──
// Returns a string with the directory basename on the first line, followed by
// box-drawing lines. Dirs before files, bundles elided, iCloud stubs annotated.

function buildTreeLines(
  dir: string,
  depth: number,
  fs: FsLike,
  skipPath: string | undefined,
  prefix: string,
  current: number,
): string[] {
  if (current >= depth) return [];

  let entries;
  try {
    entries = fs.readDir(dir);
  } catch {
    return [];
  }

  // Visible-or-stub items only (bundles are visible, rendered as elided).
  const items = entries.filter((e) => {
    const abs = dir + "/" + e.name;
    if (skipPath && abs === skipPath) return false;
    return isIcloudStub(e) || isVisible(e.name);
  });

  // Sort: real dirs (non-bundle) first, then everything else, alphabetically.
  items.sort((a, b) => {
    const aIsRealDir = a.isDirectory() && !isBundle(a);
    const bIsRealDir = b.isDirectory() && !isBundle(b);
    if (aIsRealDir !== bIsRealDir) return aIsRealDir ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });

  const lines: string[] = [];
  items.forEach((e, i) => {
    const isLast = i === items.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const abs = dir + "/" + e.name;

    if (isIcloudStub(e)) {
      const original = icloudOriginalName(e.name);
      lines.push(`${prefix}${connector}${original}   [iCloud, not downloaded]`);
    } else if (isBundle(e)) {
      lines.push(`${prefix}${connector}${e.name}/   [bundle, elided]`);
    } else if (e.isDirectory()) {
      lines.push(`${prefix}${connector}${e.name}/`);
      if (current + 1 < depth) {
        const subPrefix = prefix + (isLast ? "    " : "│   ");
        lines.push(...buildTreeLines(abs, depth, fs, undefined, subPrefix, current + 1));
      }
    } else {
      lines.push(`${prefix}${connector}${e.name}`);
    }
  });

  return lines;
}

export function buildTree(root: string, depth: number, fs: FsLike, skipPath?: string): string {
  const base = root.split("/").filter(Boolean).pop() ?? root;
  const header = `${base}/`;
  const lines = buildTreeLines(root, depth, fs, skipPath, "", 0);
  return [header, ...lines].join("\n");
}

// ── LLM prompt template (ported verbatim from jd-survey.py lines 74–126) ──

export function buildLlmPrompt(p: {
  jdid: string;
  title: string;
  fsPath: string;
  count: number;
  depth: number;
  tree: string;
}): string {
  return `You are writing the body of a \`## Contents (Filesystem)\` section for a Johnny.Decimal slot.

JDID: ${p.jdid}
Title: ${p.title}
Filesystem path: ${p.fsPath}
Visible item count (recursive, depth ${p.depth}, bundles counted as 1): ${p.count}

Directory tree (up to depth ${p.depth}, bundles elided as \`[bundle, elided]\`, iCloud-evicted files shown as \`[iCloud, not downloaded]\`):

${p.tree}

Choose ONE of three body shapes based on the item count (N = ${p.count}):

FORMAT 1 — for N = 1: just sentence 1, no enumeration.

    1 <file|item>: <one-sentence noun-phrase describing what it is>.

FORMAT A — for N = 2 to 24, OR fewer than 2 categories of 3+ items each: lead + bulleted Includes.

    <N> <items|files>: <one-sentence noun-phrase describing what the folder collectively is>.

    Includes:
    - <category-1>
    - <category-2 (qualifier)>
    - …

FORMAT B — for N ≥ 25 AND at least 2 categories of 3+ items each: lead + H3 subsections.

    <N> <items|files>: <one-sentence noun-phrase>.

    ### <Category 1 name>
    - <item or item-group>
    - <item or item-group>

    ### <Category 2 name>
    - <item or item-group>
    - <item or item-group>

Default to FORMAT A when in doubt. Three loose items don't deserve their own H3.

Rules — follow strictly (apply to all formats):
- Use \`items\` if there are subdirectories OR a mix of files and directories; \`files\` if everything is flat.
- Sentence 1 is what the folder collectively is. Subsequent content is what's inside, enumerated by category.
- Enumerate by category, not by filename. "rental applications (multiple versions: compressed, B&W, full)" — not a list of filenames.
- Mention subfolders by role, not by name. "lease subdirectory" — not the full path. If a subfolder has notable depth-2 contents, you may qualify it briefly: "lease subdirectory with addenda".
- Bundles (\`[bundle, elided]\`) count as single items; mention them by their type ("Inform project bundle", "macOS application") not their internals.
- iCloud-evicted files (\`[iCloud, not downloaded]\`) are real items — include them in your categorization. Use the filename to infer what they are; don't speculate beyond it.
- Note exotic file types in passing if present (audio, video, image-scans, office docs).
- Bias toward content over infrastructure. Files that exist to support OTHER files — vendored libraries (jQuery/Bootstrap/Chart.js shipped alongside an HTML report), lock files, build artifacts, caches, thumbnails, asset/vendor/node_modules-style directories, \`.aux\`/\`.log\` companions to \`.tex\`, font files for a generated PDF — should be mentioned only when they explain something the reader cares about ("renders offline because libraries are vendored") or never. Do NOT give infrastructure its own H3 section in Format B. Categorize by what the slot is *for*, not what's literally on disk.
- Do NOT transcribe any PII: no personal names from filenames, no dollar amounts, no account numbers, no dates of birth.
- Do NOT echo filenames verbatim. Summarize.

Output ONLY the body text — pick the appropriate format above and emit ONLY its body. No heading. No preamble. No quotes around the output. No markdown fence.`;
}

// ── Judge prompt template (ported verbatim from jd-survey.py lines 129–158) ──
// Note: fs_path and depth omitted from interface per Task 10 spec.

export function buildJudgePrompt(p: {
  jdid: string;
  title: string;
  count: number;
  existing: string;
  tree: string;
}): string {
  return `You are auditing whether an existing survey description is still accurate given the current state of the directory.

JDID: ${p.jdid}
Title: ${p.title}
Current item count (recursive, bundles counted as 1): ${p.count}

CURRENT DIRECTORY TREE:
${p.tree}

EXISTING PROSE (what the survey currently says):
${p.existing}

Question: does the existing prose still factually describe what's in the directory? Consider:
- New categories of files added that the prose doesn't mention
- Categories described that no longer exist
- Counts or qualifiers that have shifted enough to mislead a reader
- Embedded numeric claims in the prose (e.g. "About two dozen files", "Twelve PDFs") that materially contradict the current count

Be tolerant of minor drift (a count off by a few, a slightly stale qualifier). Be strict about misleading omissions (a whole new kind of content not mentioned, or claims that no longer hold) AND about embedded numeric falsehoods — if the prose leads with a number or count-word that is materially wrong against the current state, that alone is grounds for REWRITE even when the categories described are still accurate.

If the prose is still essentially accurate — a reader would not be misled — output exactly:
KEEP

Otherwise output a single line starting with \`REWRITE:\` and a brief reason, like:
REWRITE: new category of audio files not mentioned
REWRITE: prose claims "weekly reports" but most are now monthly summaries
REWRITE: prose says "12 items" but directory now has 47

Output ONLY one line: either \`KEEP\` or \`REWRITE: <reason>\`. No preamble, no quotes, no other text.`;
}

// ── extractExistingProse (ported from jd-survey.py lines 542–581) ──

export function extractExistingProse(body: string): string | null {
  const section = matchSection(body);
  if (!section) return null;

  // Drop the heading line.
  const afterHeading = section.indexOf("\n");
  const rest = afterHeading === -1 ? "" : section.slice(afterHeading + 1);

  let lines = rest.split("\n");

  // Skip leading blank lines.
  while (lines.length > 0 && !lines[0].trim()) {
    lines.shift();
  }

  // If the first non-blank starts a callout block (lines starting with `>`),
  // strip the whole callout plus one blank line after it.
  if (lines.length > 0 && lines[0].trimStart().startsWith(">")) {
    let i = 0;
    while (i < lines.length && lines[i].trimStart().startsWith(">")) {
      i++;
    }
    // Skip a single blank line after the callout if present.
    if (i < lines.length && !lines[i].trim()) {
      i++;
    }
    lines = lines.slice(i);
  }

  const prose = lines.join("\n").trim();
  if (!prose || prose === PROSE_PLACEHOLDER) return null;
  return prose;
}
