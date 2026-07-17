import { describe, it, expect, vi } from "vitest";
import { surveyNote } from "./survey";
import { makeFakeFs } from "./fs";
import { DEFAULT_CONFIG } from "./config";
import { renderWithProse, renderCallout } from "./renderer";

const cfg = { ...DEFAULT_CONFIG, vaultRoot: "/v", fsRoot: "/d", llmEnabled: false } as any;
const deps = (fs: any) => ({ fs, today: new Date(2026, 6, 5), request: null, exec: null, embedEnabled: false });

// Fixtures for provenance gate + embed tests
const cfgLlmOn = { ...DEFAULT_CONFIG, vaultRoot: "/v", fsRoot: "/d", llmEnabled: true, proseProvider: "claude-cli" } as any;
const cfgSkeleton = { ...DEFAULT_CONFIG, vaultRoot: "/v", fsRoot: "/d", llmEnabled: false, proseProvider: "skeleton" } as any;
// fsWith2Items: the path "A/13.22 Imaging" (relPath "A/13.22 Imaging.md" → mirrorRel) needs 2 items
const fsWith2Items = makeFakeFs({ "/d/A/13.22 Imaging": { "file1.pdf": "file", "file2.pdf": "file" } });

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
    const surveyFm = { at: "2026-01-01", items: 2, depth: 2, by: "jd-survey-llm", stubs: 0 };
    const fm = { "jd-id": "26.10", title: "X", survey: surveyFm } as any;
    const body = bodyWithSection(existingProse);
    const fs = makeFakeFs({ "/d/A/26.10 X": { "a.pdf": "file", "b.pdf": "file" } });
    const calls: string[] = [];
    const r = await surveyNote("A/26.10 X.md", fm, body, keepCfg, { ...deps(fs), request: makeRequest(calls) as any });
    expect(r.status).toBe("surveyed");
    expect(r.by).toBe("jd-survey-llm");     // provenance preserved from fm.survey.by
    expect(r.section).toContain(existingProse);
    expect(calls).toHaveLength(1);          // only the judge call, no generation
    expect(calls[0]).not.toContain("FORMAT"); // confirm it was the judge prompt
  });

  it("generates new prose when judge says REWRITE", async () => {
    const existingProse = "2 files: tax PDFs from prior year.";
    const surveyFm = { at: "2026-01-01", items: 2, depth: 2, by: "jd-survey-llm", stubs: 0 };
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
    const surveyFm = { at: "2026-01-01", items: 2, depth: 2, by: "jd-survey-llm", stubs: 0 };
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
    const surveyFm = { at: "2026-01-01", items: 2, depth: 2, by: "jd-survey-llm", stubs: 0 };
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

  it("falls back to full rewrite when judge call fails", async () => {
    const existingProse = "2 files: tax PDFs from prior year.";
    const surveyFm = { at: "2026-01-01", items: 2, depth: 2, by: "jd-survey-llm", stubs: 0 };
    const fm = { "jd-id": "26.10", title: "X", survey: surveyFm } as any;
    const body = bodyWithSection(existingProse);
    const fs = makeFakeFs({ "/d/A/26.10 X": { "a.pdf": "file", "b.pdf": "file" } });
    const calls: string[] = [];
    // Judge fails (non-200), gen succeeds
    const judgeFailRequest = async (opts: { url: string; method: string; headers: Record<string, string>; body: string }) => {
      const parsed = JSON.parse(opts.body) as { messages: { content: string }[] };
      const promptText = parsed.messages[0].content as string;
      calls.push(promptText);
      if (promptText.includes("FORMAT")) {
        return { status: 200, json: { content: [{ type: "text", text: "Fresh generated prose." }] }, text: "" };
      } else {
        return { status: 500, json: {}, text: "judge failed" };
      }
    };
    const r = await surveyNote("A/26.10 X.md", fm, body, keepCfg, { ...deps(fs), request: judgeFailRequest as any });
    expect(r.status).toBe("surveyed");
    expect(r.by).toBe("jd-survey-llm");
    expect(r.section).toContain("Fresh generated prose.");
    expect(r.section).not.toContain("<!-- TODO: prose summary -->");
  });

  it("skips judge and generation when proseProvider is skeleton", async () => {
    const existingProse = "2 files: tax PDFs from prior year.";
    const surveyFm = { at: "2026-01-01", items: 2, depth: 2, by: "jd-survey-llm", stubs: 0 };
    const fm = { "jd-id": "26.10", title: "X", survey: surveyFm } as any;
    const body = bodyWithSection(existingProse);
    const fs = makeFakeFs({ "/d/A/26.10 X": { "a.pdf": "file", "b.pdf": "file" } });
    const calls: string[] = [];
    const skeletonCfg = { ...cfg, llmEnabled: true, anthropicApiKey: "k", keepIfAccurate: true, proseProvider: "skeleton" } as any;
    const trackingRequest = async (opts: { url: string; method: string; headers: Record<string, string>; body: string }) => {
      const parsed = JSON.parse(opts.body) as { messages: { content: string }[] };
      const promptText = parsed.messages[0].content as string;
      calls.push(promptText);
      return { status: 200, json: { content: [{ type: "text", text: "Should not reach here." }] }, text: "" };
    };
    const r = await surveyNote("A/26.10 X.md", fm, body, skeletonCfg, { ...deps(fs), request: trackingRequest as any });
    expect(r.status).toBe("surveyed");
    expect(r.by).toBe("jd-survey");
    expect(r.section).toContain("## Contents (Filesystem)");
    expect(r.section).toContain("<!-- TODO: prose summary -->");
    expect(calls).toHaveLength(0);  // No provider calls at all
  });
});

describe("provenance gate", () => {
  it("keeps claude-code prose and refreshes the callout (no LLM call)", async () => {
    const request = vi.fn(); const exec = vi.fn(); // must NOT be called
    const body =
      "# T\n\n## Contents (Filesystem)\n\n> [!info] Filesystem snapshot\n> 1 item · surveyed 2026-01-01 · depth 2\n\n" +
      "Human-quality gloss.\n";
    const fm = { "jd-id": "13.22", title: "Imaging", survey: { at: "2026-01-01", items: 1, depth: 2, by: "claude-code", stubs: 0 } };
    const res = await surveyNote("A/13.22 Imaging.md", fm, body, cfgLlmOn, {
      fs: fsWith2Items, today: new Date("2026-07-16"), request, exec, embedEnabled: false,
    });
    expect(res.status).toBe("surveyed");
    expect(res.by).toBe("claude-code");           // provenance preserved
    expect(res.section).toContain("Human-quality gloss.");
    expect(res.section).toContain("2 items");     // callout refreshed to current count
    expect(request).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it("regenerates jd-survey-llm prose (not protected)", async () => {
    const exec = vi.fn().mockResolvedValue({ code: 0, stdout: "Fresh prose.", stderr: "" });
    const fm = { "jd-id": "13.22", title: "Imaging", survey: { at: "2026-01-01", items: 1, depth: 2, by: "jd-survey-llm", stubs: 0 } };
    const res = await surveyNote("A/13.22 Imaging.md", fm, "# T\n\n## Contents (Filesystem)\n\nold\n", cfgLlmOn, {
      fs: fsWith2Items, today: new Date("2026-07-16"), request: vi.fn(), exec, embedEnabled: false,
    });
    expect(exec).toHaveBeenCalled();
    expect(res.by).toBe("jd-survey-llm");
  });
});

describe("provenance gate — no extractable prose", () => {
  it("protected (claude-code) with skeleton-only section: does not call LLM, keeps provenance, emits skeleton", async () => {
    const request = vi.fn(); const exec = vi.fn();
    // Body has a Contents section but only the skeleton placeholder — no real prose
    const body =
      "# T\n\n## Contents (Filesystem)\n\n> [!info] Filesystem snapshot\n> 1 item · surveyed 2026-01-01 · depth 2\n\n" +
      "<!-- TODO: prose summary -->\n";
    const fm = { "jd-id": "13.22", title: "Imaging", survey: { at: "2026-01-01", items: 1, depth: 2, by: "claude-code", stubs: 0 } };
    const res = await surveyNote("A/13.22 Imaging.md", fm, body, cfgLlmOn, {
      fs: fsWith2Items, today: new Date("2026-07-16"), request, exec, embedEnabled: false,
    });
    expect(res.status).toBe("surveyed");
    expect(res.by).toBe("claude-code");             // provenance preserved
    expect(res.section).toContain("<!-- TODO: prose summary -->"); // skeleton emitted
    expect(request).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it("protected (human) with real prose: does not call judge even with keepIfAccurate ON, preserves prose", async () => {
    const request = vi.fn(); const exec = vi.fn();
    const existingProse = "Curated scans and X-rays from annual checkups.";
    const body =
      "# T\n\n" +
      renderWithProse(renderCallout(2, "2026-01-01", 2, 0), existingProse) +
      "\n";
    const fm = { "jd-id": "13.22", title: "Imaging", survey: { at: "2026-01-01", items: 2, depth: 2, by: "human", stubs: 0 } };
    const keepLlmCfg = { ...cfgLlmOn, keepIfAccurate: true } as any;
    const res = await surveyNote("A/13.22 Imaging.md", fm, body, keepLlmCfg, {
      fs: fsWith2Items, today: new Date("2026-07-16"), request, exec, embedEnabled: false,
    });
    expect(res.status).toBe("surveyed");
    expect(res.by).toBe("human");                   // provenance preserved
    expect(res.section).toContain(existingProse);   // existing prose kept
    expect(request).not.toHaveBeenCalled();         // judge never reached
    expect(exec).not.toHaveBeenCalled();
  });
});

describe("embed emission", () => {
  it("appends the embed when embedEnabled and embedRel present", async () => {
    const res = await surveyNote("A/13.22 Imaging.md", { "jd-id": "13.22", title: "Imaging" }, "# T\n", cfgSkeleton, {
      fs: fsWith2Items, today: new Date("2026-07-16"), request: null, exec: null, embedEnabled: true,
    });
    expect(res.section).toContain("```EmbedRelativeTo\nicloud://A/13.22 Imaging/#\n```");
  });
  it("omits the embed when embedEnabled is false", async () => {
    const res = await surveyNote("A/13.22 Imaging.md", { "jd-id": "13.22", title: "Imaging" }, "# T\n", cfgSkeleton, {
      fs: fsWith2Items, today: new Date("2026-07-16"), request: null, exec: null, embedEnabled: false,
    });
    expect(res.section).not.toContain("EmbedRelativeTo");
  });
});
