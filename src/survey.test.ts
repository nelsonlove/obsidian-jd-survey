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

  // REWRITTEN (Fix 2): skeleton provider makes no new prose, but an existing
  // jd-survey-llm section must NOT be clobbered to a TODO placeholder. Fix 2
  // salvages the existing prose; the callout is refreshed but prose is kept.
  it("skips judge/generation when provider is skeleton, keeping existing prose (Fix 2)", async () => {
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
    expect(r.by).toBe("jd-survey-llm");                 // Fix 2: kept, not downgraded
    expect(r.section).toContain(existingProse);         // existing prose salvaged
    expect(r.section).not.toContain("<!-- TODO: prose summary -->"); // NOT skeleton
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

describe("provenance gate — no extractable prose (fall-through)", () => {
  // SUPERSEDED behavior: previously a protected note with only a skeleton
  // placeholder re-stamped `claude-code` forever, permanently sticking the note.
  // NEW: an empty protected section has no prose to protect, so it falls through
  // to the normal unprotected flow — the LLM may regenerate and `by` stamps
  // per normal rules. This un-sticks a note whose prose the user blanked.
  it("protected (claude-code) with skeleton-only section + llm on: regenerates, by = jd-survey-llm", async () => {
    const exec = vi.fn().mockResolvedValue({ code: 0, stdout: "Fresh regenerated prose.", stderr: "" });
    const request = vi.fn();
    const body =
      "# T\n\n## Contents (Filesystem)\n\n> [!info] Filesystem snapshot\n> 1 item · surveyed 2026-01-01 · depth 2\n\n" +
      "<!-- TODO: prose summary -->\n";
    const fm = { "jd-id": "13.22", title: "Imaging", survey: { at: "2026-01-01", items: 1, depth: 2, by: "claude-code", stubs: 0 } };
    const res = await surveyNote("A/13.22 Imaging.md", fm, body, cfgLlmOn, {
      fs: fsWith2Items, today: new Date("2026-07-16"), request, exec, embedEnabled: false,
    });
    expect(res.status).toBe("surveyed");
    expect(res.by).toBe("jd-survey-llm");            // regenerated → normal stamp
    expect(res.section).toContain("Fresh regenerated prose.");
    expect(res.section).not.toContain("<!-- TODO: prose summary -->");
    expect(exec).toHaveBeenCalled();                 // LLM reached
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
  it("honors cfg.embedVirtualDir when appending the embed", async () => {
    const res = await surveyNote("A/13.22 Imaging.md", { "jd-id": "13.22", title: "Imaging" }, "# T\n",
      { ...cfgSkeleton, embedVirtualDir: "docs" } as any, {
        fs: fsWith2Items, today: new Date("2026-07-16"), request: null, exec: null, embedEnabled: true,
      });
    expect(res.section).toContain("```EmbedRelativeTo\ndocs://A/13.22 Imaging/#\n```");
  });
});

describe("surgical protected path", () => {
  const protectedFm = (by: string) =>
    ({ "jd-id": "13.22", title: "Imaging", survey: { at: "2026-01-01", items: 1, depth: 2, by, stubs: 0 } });

  it("preserves a human blockquote after the snapshot callout, refreshes the callout", async () => {
    const request = vi.fn(); const exec = vi.fn();
    const body =
      "# T\n\n## Contents (Filesystem)\n\n" +
      "> [!info] Filesystem snapshot\n> 1 item · surveyed 2026-01-01 · depth 2\n\n" +
      "> [!warning] Do not touch\n> hand-authored caveat\n\n" +
      "Curated gloss.\n";
    const res = await surveyNote("A/13.22 Imaging.md", protectedFm("human"), body, cfgLlmOn, {
      fs: fsWith2Items, today: new Date("2026-07-16"), request, exec, embedEnabled: false,
    });
    expect(res.by).toBe("human");
    expect(res.section).toContain("> [!warning] Do not touch\n> hand-authored caveat"); // byte-for-byte
    expect(res.section).toContain("2 items");         // snapshot refreshed
    expect(res.section).not.toContain("1 item ·");
    expect(res.section).toContain("Curated gloss.");
    expect(request).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it("inserts a fresh snapshot callout after the heading when the human replaced it", async () => {
    const body =
      "# T\n\n## Contents (Filesystem)\n\n" +
      "> [!note] My own summary callout\n> replaced the snapshot\n\n" +
      "Prose body.\n";
    const res = await surveyNote("A/13.22 Imaging.md", protectedFm("claude-code"), body, cfgLlmOn, {
      fs: fsWith2Items, today: new Date("2026-07-16"), request: vi.fn(), exec: vi.fn(), embedEnabled: false,
    });
    expect(res.section).toContain("> [!note] My own summary callout\n> replaced the snapshot"); // untouched
    expect(res.section).toContain("> [!info] Filesystem snapshot"); // fresh callout inserted
    expect(res.section).toContain("2 items");
    // Fresh callout is inserted after the heading, before the human callout.
    expect(res.section!.indexOf("[!info] Filesystem snapshot"))
      .toBeLessThan(res.section!.indexOf("[!note] My own summary callout"));
  });

  it("preserves a hand-authored EmbedRelativeTo pointing elsewhere; appends no second embed", async () => {
    const body =
      "# T\n\n## Contents (Filesystem)\n\n" +
      "> [!info] Filesystem snapshot\n> 1 item · surveyed 2026-01-01 · depth 2\n\n" +
      "Prose.\n\n" +
      "```EmbedRelativeTo\nicloud://SOME/OTHER/TARGET/#\n```\n";
    const res = await surveyNote("A/13.22 Imaging.md", protectedFm("human"), body, cfgLlmOn, {
      fs: fsWith2Items, today: new Date("2026-07-16"), request: vi.fn(), exec: vi.fn(), embedEnabled: true,
    });
    expect(res.section).toContain("icloud://SOME/OTHER/TARGET/#"); // preserved exactly
    expect(res.section).not.toContain("icloud://A/13.22 Imaging/#"); // no engine embed appended
    expect((res.section!.match(/```EmbedRelativeTo/g) || []).length).toBe(1);
  });

  it("appends the embed once when protected prose has none, and is idempotent", async () => {
    const body =
      "# T\n\n## Contents (Filesystem)\n\n" +
      "> [!info] Filesystem snapshot\n> 1 item · surveyed 2026-01-01 · depth 2\n\n" +
      "Prose only, no embed.\n";
    const deps1 = { fs: fsWith2Items, today: new Date("2026-07-16"), request: vi.fn(), exec: vi.fn(), embedEnabled: true };
    const res1 = await surveyNote("A/13.22 Imaging.md", protectedFm("claude-code"), body, cfgLlmOn, deps1);
    expect((res1.section!.match(/```EmbedRelativeTo/g) || []).length).toBe(1);
    expect(res1.section).toContain("icloud://A/13.22 Imaging/#");

    // Re-running on the transformed section must be a no-op (idempotent).
    const body2 = "# T\n\n" + res1.section;
    const res2 = await surveyNote("A/13.22 Imaging.md", protectedFm("claude-code"), body2, cfgLlmOn, deps1);
    expect(res2.section).toBe(res1.section);
  });

  it("does not truncate protected prose containing a literal EmbedRelativeTo fence in a code example", async () => {
    // The prose intentionally shows an EmbedRelativeTo fence as a fenced example.
    const body =
      "# T\n\n## Contents (Filesystem)\n\n" +
      "> [!info] Filesystem snapshot\n> 1 item · surveyed 2026-01-01 · depth 2\n\n" +
      "Prose explaining embeds.\n\n" +
      "Example fence:\n\n" +
      "```EmbedRelativeTo\nicloud://EXAMPLE/#\n```\n";
    // embedEnabled false so we don't append anything; we only refresh the callout.
    const res = await surveyNote("A/13.22 Imaging.md", protectedFm("human"), body, cfgLlmOn, {
      fs: fsWith2Items, today: new Date("2026-07-16"), request: vi.fn(), exec: vi.fn(), embedEnabled: false,
    });
    expect(res.section).toContain("Prose explaining embeds.");
    expect(res.section).toContain("Example fence:");
    expect(res.section).toContain("```EmbedRelativeTo\nicloud://EXAMPLE/#\n```"); // preserved
    expect(res.section).toContain("2 items"); // callout still refreshed
  });
});

describe("Fix 2 — no-new-prose keeps existing prose", () => {
  it("llmEnabled false + existing jd-survey-llm prose: prose kept, by jd-survey-llm, callout refreshed, NOT skeleton", async () => {
    const existingProse = "2 files: tax PDFs.";
    const fm = { "jd-id": "13.22", title: "Imaging", survey: { at: "2026-01-01", items: 1, depth: 2, by: "jd-survey-llm", stubs: 0 } } as any;
    const body =
      "# T\n\n" + renderWithProse(renderCallout(1, "2026-01-01", 2, 0), existingProse) + "\n";
    const cfgOff = { ...cfg, llmEnabled: false } as any;
    const res = await surveyNote("A/13.22 Imaging.md", fm, body, cfgOff, {
      fs: fsWith2Items, today: new Date("2026-07-16"), request: null, exec: null, embedEnabled: false,
    });
    expect(res.by).toBe("jd-survey-llm");
    expect(res.section).toContain(existingProse);
    expect(res.section).not.toContain("<!-- TODO: prose summary -->");
    expect(res.section).toContain("2 items"); // callout refreshed
  });
});

describe("Fix 3 — never fabricate human provenance", () => {
  it("keepIfAccurate KEEP with prose but no survey.by: stamps jd-survey-llm, not human", async () => {
    // No `survey.by` at all → not protected → judge path. Judge says KEEP.
    const existingProse = "2 files: tax PDFs from prior year.";
    const fm = { "jd-id": "13.22", title: "Imaging" } as any; // note: NO survey object
    const body =
      "# T\n\n" + renderWithProse(renderCallout(2, "2026-01-01", 2, 0), existingProse) + "\n";
    const keepReq = async (opts: { body: string }) => {
      const parsed = JSON.parse(opts.body) as { messages: { content: string }[] };
      const promptText = parsed.messages[0].content as string;
      if (promptText.includes("FORMAT")) return { status: 200, json: { content: [{ type: "text", text: "gen" }] }, text: "" };
      return { status: 200, json: { content: [{ type: "text", text: "KEEP" }] }, text: "" };
    };
    const keepCfg = { ...cfg, llmEnabled: true, anthropicApiKey: "k", keepIfAccurate: true } as any;
    const res = await surveyNote("A/13.22 Imaging.md", fm, body, keepCfg, {
      fs: fsWith2Items, today: new Date("2026-07-16"), request: keepReq as any, exec: null, embedEnabled: false,
    });
    expect(res.by).toBe("jd-survey-llm"); // NOT "human"
    expect(res.section).toContain(existingProse);
  });
});
