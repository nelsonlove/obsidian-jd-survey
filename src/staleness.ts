import type { Frontmatter } from "./types";
import type { SurveyKeys } from "./config";
import { parseDate, daysBetween } from "./date";

export interface SurveyState {
  at: Date | null; items: number | null; stubs: number | null; depth: number | null; by: string | null;
}
export type Reason = string; // "never" | "count-drift" | "stub-drift" | "stale-<N>d"

function asInt(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;
}

export function readSurveyState(fm: Frontmatter, keys: SurveyKeys): SurveyState {
  const obj = (fm[keys.object] && typeof fm[keys.object] === "object")
    ? (fm[keys.object] as Record<string, unknown>) : {};
  return {
    at: parseDate(obj["at"]),
    items: asInt(obj["items"]),
    stubs: asInt(obj["stubs"]),
    depth: asInt(obj["depth"]),
    by: typeof obj["by"] === "string" ? (obj["by"] as string) : null,
  };
}

export function ageReasonLabel(thresholdDays: number): string {
  return `stale-${thresholdDays}d`;
}

export function stalenessReason(
  state: SurveyState,
  current: { items: number; stubs: number },
  thresholdDays: number,
  today: Date,
): Reason | null {
  if (state.at === null) return "never";
  if (state.items !== null && state.items !== current.items) return "count-drift";
  if (state.stubs !== null && state.stubs !== current.stubs) return "stub-drift";
  if (daysBetween(state.at, today) > thresholdDays) return ageReasonLabel(thresholdDays);
  return null;
}
