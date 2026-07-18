import type { Frontmatter } from "./types";
import type { SurveyKeys } from "./config";
import type { SurveyObject } from "./types";
import { parseDate, formatDate } from "./date";

export function applySurveyToFrontmatter(fm: Frontmatter, survey: SurveyObject, keys: SurveyKeys): void {
  fm[keys.object] = {
    at: survey.at, items: survey.items, depth: survey.depth, by: survey.by, stubs: survey.stubs,
  };
  for (const k of keys.legacyFlat) delete fm[k];
  if (keys.legacyBare) delete fm[keys.legacyBare];
  delete fm["has-filesystem"];
}

export function migrateFrontmatter(fm: Frontmatter, keys: SurveyKeys): boolean {
  let changed = false;
  if (Object.prototype.hasOwnProperty.call(fm, "has-filesystem")) {
    if (fm["has-filesystem"] === false) { fm[keys.target] = "none"; changed = true; }
    delete fm["has-filesystem"];
    changed = true;
  }
  return changed;
}

/**
 * Normalize a legacy date value to `YYYY-MM-DD`, or null if it isn't a date.
 *
 * Obsidian parses an unquoted date-only YAML scalar (`surveyed: 2026-05-06`)
 * to a **UTC-midnight** `Date` object (YAML-1.1 timestamp semantics). Reading
 * that back with local getters would shift the calendar date a day earlier in
 * any negative-offset timezone (e.g. US Eastern: `2026-05-06T00:00Z` → local
 * `2026-05-05`), so the `Date` branch formats with UTC getters. String values
 * (a quoted scalar, or a `YYYY-MM-DD HH:MM` datetime) go through `parseDate`,
 * whose string branch already reads local-midnight consistently.
 */
function legacyDate(v: unknown): string | null {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  }
  const d = parseDate(v);
  return d ? formatDate(d, "YYYY-MM-DD") : null;
}

/**
 * Convert legacy survey frontmatter (bare `surveyed:` scalar and/or flat
 * `survey-*` keys) into the nested `survey:` object. Deliberately partial:
 * a bare scalar yields only `{at}` — no fabricated counts or provenance —
 * so staleness runs age-based until a real survey fills the other fields.
 * An existing nested object is never clobbered; legacy keys are stripped.
 */
export function migrateLegacySurveyed(fm: Frontmatter, keys: SurveyKeys): boolean {
  const bareKey = keys.legacyBare;
  const hasBare = bareKey !== null && Object.prototype.hasOwnProperty.call(fm, bareKey);
  const flatPresent = keys.legacyFlat.filter((k) => Object.prototype.hasOwnProperty.call(fm, k));
  if (!hasBare && flatPresent.length === 0) return false;

  const existing = fm[keys.object];
  const hasNested = typeof existing === "object" && existing !== null && !Array.isArray(existing);
  if (!hasNested) {
    const obj: Record<string, unknown> = {};
    // Flat keys are the newer legacy generation — prefer their date over the bare scalar's.
    const flatAt = legacyDate(fm[`${keys.object}-at`]);
    const bareAt = hasBare ? legacyDate(fm[bareKey!]) : null;
    const at = flatAt ?? bareAt;
    if (at) obj["at"] = at;
    for (const [field, key] of [
      ["items", `${keys.object}-items`],
      ["depth", `${keys.object}-depth`],
      ["by", `${keys.object}-by`],
      ["stubs", `${keys.object}-stubs`],
    ] as const) {
      if (Object.prototype.hasOwnProperty.call(fm, key)) obj[field] = fm[key];
    }
    fm[keys.object] = obj;
  }
  for (const k of keys.legacyFlat) delete fm[k];
  if (bareKey) delete fm[bareKey];
  return true;
}
