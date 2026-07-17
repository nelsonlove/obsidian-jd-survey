export const SECTION_HEADING = "## Contents (Filesystem)";
export const PROSE_PLACEHOLDER = "<!-- TODO: prose summary -->";
// Marker line identifying an engine-authored snapshot callout. A `>`-block is
// only ever replaced/refreshed if its FIRST line, trimmed, equals this exactly.
export const SNAPSHOT_CALLOUT_MARKER = "> [!info] Filesystem snapshot";
export const EMBED_FENCE = "```EmbedRelativeTo";

export function renderCallout(items: number, dateStr: string, depth: number, stubs: number): string {
  const itemLabel = items === 1 ? "item" : "items";
  const parts = [`${items} ${itemLabel}`, `surveyed ${dateStr}`, `depth ${depth}`];
  if (stubs) parts.push(`${stubs} iCloud ${stubs === 1 ? "stub" : "stubs"}`);
  return `> [!info] Filesystem snapshot\n> ${parts.join(" · ")}`;
}

export function renderEmbed(relFolder: string, virtualDir: string = "icloud"): string {
  return "```EmbedRelativeTo\n" + virtualDir + "://" + relFolder + "/#\n```";
}

export function renderSkeleton(callout: string, embed?: string): string {
  const tail = embed ? `\n\n${embed}` : "";
  return `${SECTION_HEADING}\n\n${callout}\n\n${PROSE_PLACEHOLDER}${tail}\n`;
}

export function renderWithProse(callout: string, prose: string, embed?: string): string {
  const tail = embed ? `\n\n${embed}` : "";
  return `${SECTION_HEADING}\n\n${callout}\n\n${prose.trimEnd()}${tail}\n`;
}

function findHeadingStart(body: string): number {
  if (body.startsWith(SECTION_HEADING)) return 0;
  const i = body.indexOf("\n" + SECTION_HEADING);
  return i === -1 ? -1 : i + 1;
}

function findNextHeadingStart(body: string, from: number): number {
  const i = body.indexOf("\n## ", from);
  return i === -1 ? -1 : i + 1;
}

export function matchSection(body: string): string | null {
  const start = findHeadingStart(body);
  if (start === -1) return null;
  const from = start + SECTION_HEADING.length;
  const next = findNextHeadingStart(body, from);
  const end = next === -1 ? body.length : next;
  return body.slice(start, end).replace(/\s+$/, "");
}

export function upsertSection(body: string, newSection: string): string {
  const normalized = newSection.trimEnd() + "\n\n";
  const start = findHeadingStart(body);
  if (start !== -1) {
    const from = start + SECTION_HEADING.length;
    const next = findNextHeadingStart(body, from);
    const before = body.slice(0, start);
    if (next === -1) {
      return (before + normalized).trimEnd() + "\n";
    }
    return before + normalized + body.slice(next);
  }
  const h1 = /^# .+\n/m.exec(body);
  if (h1) {
    const idx = h1.index + h1[0].length;
    const remainder = body.slice(idx).replace(/^\n+/, "");
    return body.slice(0, idx) + "\n" + normalized + remainder;
  }
  return normalized + body.replace(/^\n+/, "");
}

// ── Surgical section-shape helpers (for the provenance-protected path) ──
//
// These operate on a section string as returned by matchSection: it begins with
// SECTION_HEADING and contains no trailing whitespace. They transform the
// section minimally, never re-rendering it, so hand-authored callouts, embeds,
// and blockquotes are preserved byte-for-byte.

// True if a line is exactly the EmbedRelativeTo fence opener (trimmed).
function isEmbedFenceLine(line: string): boolean {
  return line.trim() === EMBED_FENCE;
}

/**
 * Does the section contain any EmbedRelativeTo fence — engine's, hand-authored,
 * or retargeted? A single matching opener line anywhere counts.
 */
export function sectionHasEmbedFence(section: string): boolean {
  return section.split("\n").some(isEmbedFenceLine);
}

/**
 * Does the section have real prose worth protecting? Content is "real prose"
 * unless everything (minus heading, minus an engine snapshot callout matched by
 * marker only, minus EmbedRelativeTo fenced blocks, minus the TODO placeholder,
 * minus blanks) is empty.
 */
export function sectionHasProse(section: string): boolean {
  const lines = section.split("\n");
  // Drop heading line.
  let i = 0;
  if (i < lines.length && lines[i].trim() === SECTION_HEADING) i++;

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (t === "") { i++; continue; }
    if (t === PROSE_PLACEHOLDER) { i++; continue; }
    // Engine snapshot callout: contiguous `>`-block whose FIRST line is the marker.
    if (t === SNAPSHOT_CALLOUT_MARKER) {
      i++;
      while (i < lines.length && lines[i].trimStart().startsWith(">")) i++;
      continue;
    }
    // EmbedRelativeTo fenced block: skip opener through its closing fence.
    if (isEmbedFenceLine(line)) {
      i++;
      while (i < lines.length && lines[i].trim() !== "```") i++;
      if (i < lines.length) i++; // consume closing fence
      continue;
    }
    // Anything else — a human callout, a heading, prose — is real content.
    return true;
  }
  return false;
}

/**
 * Replace the engine snapshot callout with a fresh one, touching nothing else.
 * The snapshot callout is the contiguous `>`-block whose FIRST line, trimmed,
 * equals SNAPSHOT_CALLOUT_MARKER. If none exists, insert the fresh callout right
 * after the heading line (with a blank line on each side). Never touches any
 * other `>`-block.
 */
export function replaceSnapshotCallout(section: string, freshCallout: string): string {
  const lines = section.split("\n");

  // Locate the snapshot callout block by its marker first line.
  let calloutStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === SNAPSHOT_CALLOUT_MARKER) { calloutStart = i; break; }
  }

  if (calloutStart !== -1) {
    let calloutEnd = calloutStart;
    while (calloutEnd < lines.length && lines[calloutEnd].trimStart().startsWith(">")) {
      calloutEnd++;
    }
    const before = lines.slice(0, calloutStart);
    const after = lines.slice(calloutEnd);
    return [...before, ...freshCallout.split("\n"), ...after].join("\n");
  }

  // No snapshot callout: insert after the heading line.
  let headingIdx = 0;
  if (lines.length > 0 && lines[0].trim() === SECTION_HEADING) headingIdx = 0;
  const before = lines.slice(0, headingIdx + 1);
  const after = lines.slice(headingIdx + 1);
  // Drop leading blank lines from `after`; we re-add exactly one blank on each side.
  while (after.length > 0 && after[0].trim() === "") after.shift();
  return [...before, "", ...freshCallout.split("\n"), "", ...after].join("\n");
}
