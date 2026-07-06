import { describe, it, expect } from "vitest";
import { surveyNote } from "./survey";
import { makeFakeFs } from "./fs";
import { DEFAULT_CONFIG } from "./config";
import { renderWithProse, renderCallout } from "./renderer";

const cfg = { ...DEFAULT_CONFIG, vaultRoot: "/v", fsRoot: "/d", llmEnabled: false } as any;
const deps = (fs: any) => ({ fs, today: new Date(2026, 6, 5), request: null, exec: null });

describe("surveyNote", () => {
  it("skips on opt-out", async () => {
    const r = await surveyNote("A/26.10 X.md", { "survey-target": "none" }, "# X\n", cfg, deps(makeFakeFs({})));
    expect(r.status).toBe("skipped");
    expect(r.reason).toBe("optout");
  });

  it("skips an empty directory", async () => {
    const fs = makeFakeFs({ "/d/A/26.10 X": {} });
    const r = await surveyNote("A/26.10 X.md", {}, "# X\n", cfg, deps(fs));
    expect(r.status).toBe("skipped");
    expect(r.reason).toBe("empty");
  });

  it("writes a skeleton survey when LLM disabled", async () => {
    const fs = makeFakeFs({ "/d/A/26.10 X": { "a.pdf": "file", "b.pdf": "file" } });
    const r = await surveyNote("A/26.10 X.md", {}, "# X\n", cfg, deps(fs));
    expect(r.status).toBe("surveyed");
    expect(r.by).toBe("jd-survey");
    expect(r.survey!.items).toBe(2);
    expect(r.section).toContain("## Contents (Filesystem)");
    expect(r.section).toContain("<!-- TODO: prose summary -->");
    expect(r.survey!.at).toBe("2026-07-05");
  });

  it("uses LLM prose and jd-survey-llm provenance when a request succeeds", async () => {
    const fs = makeFakeFs({ "/d/A/26.10 X": { "a.pdf": "file", "b.pdf": "file" } });
    const request = async () => ({ status: 200, json: { content: [{ type: "text", text: "Two tax PDFs." }] }, text: "" });
    const r = await surveyNote("A/26.10 X.md", {}, "# X\n", { ...cfg, llmEnabled: true, anthropicApiKey: "k" }, { ...deps(fs), request });
    expect(r.by).toBe("jd-survey-llm");
    expect(r.section).toContain("Two tax PDFs.");
  });

  it("falls back to skeleton when the LLM request fails", async () => {
    const fs = makeFakeFs({ "/d/A/26.10 X": { "a.pdf": "file" } });
    const request = async () => ({ status: 500, json: {}, text: "err" });
    const r = await surveyNote("A/26.10 X.md", {}, "# X\n", { ...cfg, llmEnabled: true, anthropicApiKey: "k" }, { ...deps(fs), request });
    expect(r.status).toBe("surveyed");
    expect(r.by).toBe("jd-survey");
    expect(r.section).toContain("<!-- TODO: prose summary -->");
  });
});

// Helper: build a note body that has a real ## Contents (Filesystem) section so
// extractExistingProse can find real prose in it.
function bodyWithSection(prose: string): string {
  const callout = renderCallout(2, "2026-01-01", 2, 0);
  const section = renderWithProse(callout, prose);
  return `# X\n\n${section}\n`;
}

describe("surveyNote — keepIfAccurate", () => {
  // Fake request factory: returns "KEEP" for judge prompts, prose text for gen prompts.
  // RequestFn signature: (opts: {url, method, headers, body}) => Promise<{status, json, text}>
  function makeRequest(calls: string[]) {
    return async (opts: { url: string; method: string; headers: Record<string, string>; body: string }) => {
      // buildLlmPrompt contains "FORMAT"; buildJudgePrompt does not — use this to distinguish.
      const parsed = JSON.parse(opts.body) as { messages: { content: string }[] };
      const promptText = parsed.messages[0].content as string;
      calls.push(promptText);
      if (promptText.includes("FORMAT")) {
        return { status: 200, json: { content: [{ type: "text", text: "Fresh generated prose." }] }, text: "" };
      } else {
        return { status: 200, json: { content: [{ type: "text", text: "KEEP" }] }, text: "" };
      }
    };
  }

  function makeRewriteRequest(calls: string[]) {
    return async (opts: { url: string; method: string; headers: Record<string, string>; body: string }) => {
      const parsed = JSON.parse(opts.body) as { messages: { content: string }[] };
      const promptText = parsed.messages[0].content as string;
      calls.push(promptText);
      if (promptText.includes("FORMAT")) {
        return { status: 200, json: { content: [{ type: "text", text: "Fresh generated prose." }] }, text: "" };
      } else {
        return { status: 200, json: { content: [{ type: "text", text: "REWRITE: stale content" }] }, text: "" };
      }
    };
  }

  const keepCfg = { ...cfg, llmEnabled: true, anthropicApiKey: "k", keepIfAccurate: true } as any;

  it("keeps existing prose and preserves provenance when judge says KEEP", async () => {
    const existingProse = "2 files: tax PDFs from prior year.";
    const surveyFm = { at: "2026-01-01", items: 2, depth: 2, by: "human", stubs: 0 };
    const fm = { "jd-id": "26.10", title: "X", survey: surveyFm } as any;
    const body = bodyWithSection(existingProse);
    const fs = makeFakeFs({ "/d/A/26.10 X": { "a.pdf": "file", "b.pdf": "file" } });
    const calls: string[] = [];
    const r = await surveyNote("A/26.10 X.md", fm, body, keepCfg, { ...deps(fs), request: makeRequest(calls) as any });
    expect(r.status).toBe("surveyed");
    expect(r.by).toBe("human");             // provenance preserved from fm.survey.by
    expect(r.section).toContain(existingProse);
    expect(calls).toHaveLength(1);          // only the judge call, no generation
    expect(calls[0]).not.toContain("FORMAT"); // confirm it was the judge prompt
  });

  it("generates new prose when judge says REWRITE", async () => {
    const existingProse = "2 files: tax PDFs from prior year.";
    const surveyFm = { at: "2026-01-01", items: 2, depth: 2, by: "human", stubs: 0 };
    const fm = { "jd-id": "26.10", title: "X", survey: surveyFm } as any;
    const body = bodyWithSection(existingProse);
    const fs = makeFakeFs({ "/d/A/26.10 X": { "a.pdf": "file", "b.pdf": "file" } });
    const calls: string[] = [];
    const r = await surveyNote("A/26.10 X.md", fm, body, keepCfg, { ...deps(fs), request: makeRewriteRequest(calls) as any });
    expect(r.by).toBe("jd-survey-llm");
    expect(r.section).toContain("Fresh generated prose.");
    expect(calls).toHaveLength(2);          // judge call + generation call
  });

  it("skips judge and rewrites when embedded count drifted ≥50%", async () => {
    // Existing prose says "2 files" but now there are 4 (100% drift ≥ 50%).
    const existingProse = "2 files: tax PDFs from prior year.";
    const surveyFm = { at: "2026-01-01", items: 2, depth: 2, by: "human", stubs: 0 };
    const fm = { "jd-id": "26.10", title: "X", survey: surveyFm } as any;
    const body = bodyWithSection(existingProse);
    // 4 files → count=4, embedded=2, drift = |4-2|/2 = 1.0 ≥ 0.5 → force rewrite
    const fs = makeFakeFs({ "/d/A/26.10 X": { "a.pdf": "file", "b.pdf": "file", "c.pdf": "file", "d.pdf": "file" } });
    const calls: string[] = [];
    const r = await surveyNote("A/26.10 X.md", fm, body, keepCfg, { ...deps(fs), request: makeRequest(calls) as any });
    expect(r.by).toBe("jd-survey-llm");
    expect(r.section).toContain("Fresh generated prose.");
    // Only one call — the generation call, no judge
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("FORMAT");   // confirms it was the gen prompt, not judge
  });

  it("generates normally when no existing section is present", async () => {
    const fm = { "jd-id": "26.10", title: "X" } as any;
    const body = "# X\n\nNo survey section yet.\n";
    const fs = makeFakeFs({ "/d/A/26.10 X": { "a.pdf": "file", "b.pdf": "file" } });
    const calls: string[] = [];
    const r = await surveyNote("A/26.10 X.md", fm, body, keepCfg, { ...deps(fs), request: makeRequest(calls) as any });
    expect(r.by).toBe("jd-survey-llm");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("FORMAT");   // gen prompt only, no judge
  });

  it("does not call judge when keepIfAccurate is false (default cfg)", async () => {
    const existingProse = "2 files: tax PDFs from prior year.";
    const surveyFm = { at: "2026-01-01", items: 2, depth: 2, by: "human", stubs: 0 };
    const fm = { "jd-id": "26.10", title: "X", survey: surveyFm } as any;
    const body = bodyWithSection(existingProse);
    const fs = makeFakeFs({ "/d/A/26.10 X": { "a.pdf": "file", "b.pdf": "file" } });
    const calls: string[] = [];
    // keepIfAccurate defaults to false
    const noKeepCfg = { ...cfg, llmEnabled: true, anthropicApiKey: "k", keepIfAccurate: false } as any;
    const r = await surveyNote("A/26.10 X.md", fm, body, noKeepCfg, { ...deps(fs), request: makeRequest(calls) as any });
    expect(r.by).toBe("jd-survey-llm");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("FORMAT");   // only the gen prompt
  });
});
