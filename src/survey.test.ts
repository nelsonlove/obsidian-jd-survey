import { describe, it, expect } from "vitest";
import { surveyNote } from "./survey";
import { makeFakeFs } from "./fs";
import { DEFAULT_CONFIG } from "./config";

const cfg = { ...DEFAULT_CONFIG, vaultRoot: "/v", fsRoot: "/d", llmEnabled: false } as any;
const deps = (fs: any) => ({ fs, today: new Date(2026, 6, 5), request: null });

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
