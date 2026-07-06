export const SECTION_HEADING = "## Contents (Filesystem)";
export const PROSE_PLACEHOLDER = "<!-- TODO: prose summary -->";

export function renderCallout(items: number, dateStr: string, depth: number, stubs: number): string {
  const itemLabel = items === 1 ? "item" : "items";
  const parts = [`${items} ${itemLabel}`, `surveyed ${dateStr}`, `depth ${depth}`];
  if (stubs) parts.push(`${stubs} iCloud ${stubs === 1 ? "stub" : "stubs"}`);
  return `> [!info] Filesystem snapshot\n> ${parts.join(" · ")}`;
}

export function renderSkeleton(callout: string): string {
  return `${SECTION_HEADING}\n\n${callout}\n\n${PROSE_PLACEHOLDER}\n`;
}

export function renderWithProse(callout: string, prose: string): string {
  return `${SECTION_HEADING}\n\n${callout}\n\n${prose.trimEnd()}\n`;
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
