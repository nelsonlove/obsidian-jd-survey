import { describe, it, expect } from "vitest";
import { deriveKeys, DEFAULT_CONFIG } from "./config";

describe("deriveKeys", () => {
  it("derives all key names from the default prefix", () => {
    const k = deriveKeys("survey");
    expect(k.object).toBe("survey");
    expect(k.target).toBe("survey-target");
    expect(k.filepath).toBe("survey-filepath");
    expect(k.legacyFlat).toEqual([
      "survey-at", "survey-items", "survey-depth", "survey-by", "survey-stubs",
    ]);
    expect(k.legacyBare).toBe("surveyed");
  });

  it("derives from a custom prefix and drops the bare legacy alias", () => {
    const k = deriveKeys("fsscan");
    expect(k.object).toBe("fsscan");
    expect(k.target).toBe("fsscan-target");
    expect(k.filepath).toBe("fsscan-filepath");
    expect(k.legacyFlat[0]).toBe("fsscan-at");
    expect(k.legacyBare).toBeNull();
  });

  it("has sane defaults", () => {
    expect(DEFAULT_CONFIG.frontmatterPrefix).toBe("survey");
    expect(DEFAULT_CONFIG.defaultDepth).toBe(2);
    expect(DEFAULT_CONFIG.stalenessThresholdDays).toBe(180);
    expect(DEFAULT_CONFIG.dateFormat).toBe("YYYY-MM-DD");
  });
});
