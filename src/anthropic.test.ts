import { describe, it, expect } from "vitest";
import { generateProse } from "./anthropic";
import { JdSurveyConfig } from "./config";

const cfg = (over: Partial<JdSurveyConfig> = {}): JdSurveyConfig => ({
  frontmatterPrefix: "survey", vaultRoot: "/v", fsRoot: "/d", defaultDepth: 2,
  dateFormat: "YYYY-MM-DD", stalenessThresholdDays: 180, dashboardNotePath: "d.md",
  dashboardMarkerBegin: "b", dashboardMarkerEnd: "e", llmEnabled: true,
  anthropicApiKey: "sk-test", anthropicModel: "claude-haiku-4-5-20251001", keepIfAccurate: false,
  proseProvider: "auto", claudeBinaryPath: "", ...over,
});

const ok = async () => ({ status: 200, json: { content: [{ type: "text", text: '  "Some prose."  ' }] }, text: "" });

describe("generateProse", () => {
  it("returns trimmed, unquoted text on 200", async () => {
    expect(await generateProse("p", cfg(), ok)).toBe("Some prose.");
  });
  it("returns null with no api key", async () => {
    expect(await generateProse("p", cfg({ anthropicApiKey: "" }), ok)).toBeNull();
  });
  it("returns null on non-200", async () => {
    const bad = async () => ({ status: 429, json: {}, text: "rate limited" });
    expect(await generateProse("p", cfg(), bad)).toBeNull();
  });
  it("caps very long output at 5000 chars with an ellipsis", async () => {
    const long = async () => ({ status: 200, json: { content: [{ type: "text", text: "x".repeat(6000) }] }, text: "" });
    const out = await generateProse("p", cfg(), long);
    expect(out!.length).toBe(5001);
    expect(out!.endsWith("…")).toBe(true);
  });
});
