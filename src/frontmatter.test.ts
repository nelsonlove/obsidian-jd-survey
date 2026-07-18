import { describe, it, expect } from "vitest";
import { applySurveyToFrontmatter, migrateFrontmatter, migrateLegacySurveyed } from "./frontmatter";
import { deriveKeys } from "./config";

const keys = deriveKeys("survey");

describe("applySurveyToFrontmatter", () => {
  it("writes the nested object in field order and strips legacy + has-filesystem", () => {
    const fm: any = {
      title: "X", modified: "2026-01-01", "has-filesystem": true,
      surveyed: "2025-01-01", "survey-items": 3, "survey-target": "documents",
    };
    applySurveyToFrontmatter(fm, { at: "2026-07-05", items: 24, depth: 2, by: "jd-survey-llm", stubs: 0 }, keys);
    expect(Object.keys(fm.survey)).toEqual(["at", "items", "depth", "by", "stubs"]);
    expect(fm.survey.by).toBe("jd-survey-llm");
    expect(fm.surveyed).toBeUndefined();
    expect(fm["survey-items"]).toBeUndefined();
    expect(fm["has-filesystem"]).toBeUndefined();
    expect(fm["survey-target"]).toBe("documents"); // preserved
    expect(fm.modified).toBe("2026-01-01");          // untouched
  });
});

describe("migrateFrontmatter", () => {
  it("rewrites has-filesystem:false to survey-target:none", () => {
    const fm: any = { "has-filesystem": false };
    expect(migrateFrontmatter(fm, keys)).toBe(true);
    expect(fm["survey-target"]).toBe("none");
    expect(fm["has-filesystem"]).toBeUndefined();
  });
  it("drops a stray has-filesystem:true", () => {
    const fm: any = { "has-filesystem": true };
    expect(migrateFrontmatter(fm, keys)).toBe(true);
    expect(fm["has-filesystem"]).toBeUndefined();
    expect(fm["survey-target"]).toBeUndefined();
  });
  it("no-ops when nothing to migrate", () => {
    expect(migrateFrontmatter({ title: "x" } as any, keys)).toBe(false);
  });
});

describe("migrateLegacySurveyed", () => {
  it("converts a bare surveyed: date to a partial {at} object", () => {
    const fm: any = { title: "X", surveyed: "2026-05-06" };
    expect(migrateLegacySurveyed(fm, keys)).toBe(true);
    expect(fm.survey).toEqual({ at: "2026-05-06" });
    expect(fm.surveyed).toBeUndefined();
    expect(fm.title).toBe("X");
  });

  it("truncates a datetime-ish scalar to the date part", () => {
    const fm: any = { surveyed: "2026-03-31 12:00" };
    expect(migrateLegacySurveyed(fm, keys)).toBe(true);
    expect(fm.survey).toEqual({ at: "2026-03-31" });
  });

  it("handles a Date-valued surveyed (Obsidian parses unquoted ISO dates to Date objects)", () => {
    // This is the ACTUAL production shape — the metadata cache / processFrontMatter
    // hand back a JS Date, not a string, for `surveyed: 2026-05-06`.
    const fm: any = { surveyed: new Date(2026, 4, 6) };
    expect(migrateLegacySurveyed(fm, keys)).toBe(true);
    expect(fm.survey).toEqual({ at: "2026-05-06" });
  });

  it("preserves the calendar date for a UTC-midnight Date regardless of local timezone", () => {
    // Obsidian builds a date-only YAML scalar as UTC midnight. Reading it back
    // with LOCAL getters would yield 2026-05-05 in any negative-offset zone;
    // the UTC-getter path must keep it 2026-05-06.
    const fm: any = { surveyed: new Date(Date.UTC(2026, 4, 6)) };
    expect(migrateLegacySurveyed(fm, keys)).toBe(true);
    expect(fm.survey).toEqual({ at: "2026-05-06" });
  });

  it("handles a Date-valued survey-at in the flat path", () => {
    const fm: any = {
      "survey-at": new Date(2026, 5, 17), "survey-items": 42,
      "survey-depth": 2, "survey-by": "jd-survey-llm", "survey-stubs": 0,
    };
    expect(migrateLegacySurveyed(fm, keys)).toBe(true);
    expect(fm.survey.at).toBe("2026-06-17");
  });

  it("converts a non-date bare scalar to an empty object (no fabricated at)", () => {
    const fm: any = { surveyed: "yes" };
    expect(migrateLegacySurveyed(fm, keys)).toBe(true);
    expect(fm.survey).toEqual({});
    expect(fm.surveyed).toBeUndefined();
  });

  it("treats survey: null as absent and still builds the object", () => {
    const fm: any = { survey: null, surveyed: new Date(2026, 0, 1) };
    expect(migrateLegacySurveyed(fm, keys)).toBe(true);
    expect(fm.survey).toEqual({ at: "2026-01-01" });
  });

  it("converts full flat keys to a complete nested object", () => {
    const fm: any = {
      "survey-at": "2026-06-17", "survey-by": "jd-survey-llm",
      "survey-depth": 2, "survey-items": 42, "survey-stubs": 0,
    };
    expect(migrateLegacySurveyed(fm, keys)).toBe(true);
    expect(fm.survey).toEqual({ at: "2026-06-17", items: 42, depth: 2, by: "jd-survey-llm", stubs: 0 });
    for (const k of ["survey-at", "survey-by", "survey-depth", "survey-items", "survey-stubs"]) {
      expect(fm[k]).toBeUndefined();
    }
  });

  it("prefers flat keys over an older bare scalar when both exist", () => {
    const fm: any = {
      surveyed: "2026-03-31",
      "survey-at": "2026-06-17", "survey-by": "jd-survey-llm",
      "survey-depth": 2, "survey-items": 42, "survey-stubs": 0,
    };
    expect(migrateLegacySurveyed(fm, keys)).toBe(true);
    expect(fm.survey.at).toBe("2026-06-17");
    expect(fm.surveyed).toBeUndefined();
  });

  it("includes only the flat fields that are present", () => {
    const fm: any = { "survey-at": "2026-06-01", "survey-items": 7 };
    expect(migrateLegacySurveyed(fm, keys)).toBe(true);
    expect(fm.survey).toEqual({ at: "2026-06-01", items: 7 });
  });

  it("keeps an existing nested object and just strips legacy keys", () => {
    const nested = { at: "2026-07-01", items: 3, depth: 2, by: "jd-survey", stubs: 0 };
    const fm: any = { survey: { ...nested }, surveyed: "2026-01-01" };
    expect(migrateLegacySurveyed(fm, keys)).toBe(true);
    expect(fm.survey).toEqual(nested);
    expect(fm.surveyed).toBeUndefined();
  });

  it("no-ops when there is nothing legacy", () => {
    const fm: any = { survey: { at: "2026-07-01", items: 3, depth: 2, by: "jd-survey", stubs: 0 } };
    expect(migrateLegacySurveyed(fm, keys)).toBe(false);
    expect(migrateLegacySurveyed({ title: "x" } as any, keys)).toBe(false);
  });
});
