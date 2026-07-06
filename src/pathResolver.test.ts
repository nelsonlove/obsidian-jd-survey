import { describe, it, expect } from "vitest";
import { resolveFsPath, expandTilde } from "./pathResolver";
import { makeFakeFs } from "./fs";
import { deriveKeys, JdSurveyConfig } from "./config";

const keys = deriveKeys("survey");
const cfg = (over: Partial<JdSurveyConfig> = {}): JdSurveyConfig => ({
  frontmatterPrefix: "survey", vaultRoot: "/vault", fsRoot: "/docs",
  defaultDepth: 2, dateFormat: "YYYY-MM-DD", stalenessThresholdDays: 180,
  dashboardNotePath: "d.md", dashboardMarkerBegin: "<!--b-->", dashboardMarkerEnd: "<!--e-->",
  llmEnabled: false, anthropicApiKey: "", anthropicModel: "m", keepIfAccurate: false,
  proseProvider: "auto", claudeBinaryPath: "", ...over,
});

describe("expandTilde", () => {
  it("expands a leading ~", () => {
    expect(expandTilde("~/Documents", "/Users/n")).toBe("/Users/n/Documents");
    expect(expandTilde("/abs", "/Users/n")).toBe("/abs");
  });

  it("expandTilde('~', home) returns the home dir", () => {
    expect(expandTilde("~", "/Users/n")).toBe("/Users/n");
  });
});

describe("resolveFsPath", () => {
  it("opts out on survey-target: none", () => {
    const fs = makeFakeFs({});
    const r = resolveFsPath("A/26.10 X.md", { "survey-target": "none" }, cfg(), keys, fs);
    expect(r.kind).toBe("optout");
  });

  it("opts out on legacy has-filesystem: false", () => {
    const fs = makeFakeFs({});
    const r = resolveFsPath("A/26.10 X.md", { "has-filesystem": false }, cfg(), keys, fs);
    expect(r.kind).toBe("optout");
  });

  it("does NOT opt out when has-filesystem is true or absent", () => {
    const fs = makeFakeFs({ "/docs/A/26.10 X": { "f.pdf": "file" } });
    const r = resolveFsPath("A/26.10 X.md", { "has-filesystem": true }, cfg(), keys, fs);
    expect(r.kind).toBe("resolved");
  });

  it("resolves the parallel-tree mirror for a cat-level note", () => {
    const fs = makeFakeFs({ "/docs/A/26.10 X": { "f.pdf": "file" } });
    const r = resolveFsPath("A/26.10 X.md", {}, cfg(), keys, fs);
    expect(r).toEqual({ kind: "resolved", fsPath: "/docs/A/26.10 X", skipPath: null });
  });

  it("resolves the parent dir for a folder note", () => {
    const fs = makeFakeFs({ "/docs/A/26.54 X": { "f.pdf": "file" } });
    const r = resolveFsPath("A/26.54 X/26.54 X.md", {}, cfg(), keys, fs);
    expect(r).toEqual({ kind: "resolved", fsPath: "/docs/A/26.54 X", skipPath: null });
  });

  it("returns no-mapping when the documents dir is absent", () => {
    const fs = makeFakeFs({});
    const r = resolveFsPath("A/26.10 X.md", {}, cfg(), keys, fs);
    expect(r.kind).toBe("no-mapping");
  });

  it("survey-target: vault surveys the in-vault parent and sets skipPath", () => {
    const fs = makeFakeFs({ "/vault/A/26.54 X": { "26.54 X.md": "file", "note.md": "file" } });
    const r = resolveFsPath("A/26.54 X/26.54 X.md", { "survey-target": "vault" }, cfg(), keys, fs);
    expect(r).toEqual({
      kind: "resolved", fsPath: "/vault/A/26.54 X", skipPath: "/vault/A/26.54 X/26.54 X.md",
    });
  });

  it("honors an absolute survey-filepath override", () => {
    const fs = makeFakeFs({ "/elsewhere/data": { "x": "file" } });
    const r = resolveFsPath("A/26.10 X.md", { "survey-filepath": "/elsewhere/data" }, cfg(), keys, fs);
    expect(r).toEqual({ kind: "resolved", fsPath: "/elsewhere/data", skipPath: null });
  });

  it("resolves a relative survey-filepath against fsRoot", () => {
    const fs = makeFakeFs({ "/docs/sub/dir": { "x": "file" } });
    const r = resolveFsPath("A/26.10 X.md", { "survey-filepath": "sub/dir" }, cfg(), keys, fs);
    expect(r.kind).toBe("resolved");
    if (r.kind === "resolved") expect(r.fsPath).toBe("/docs/sub/dir");
  });

  it("rejects a relative survey-filepath that escapes fsRoot", () => {
    const fs = makeFakeFs({});
    const r = resolveFsPath("A/26.10 X.md", { "survey-filepath": "../escape" }, cfg(), keys, fs);
    expect(r.kind).toBe("no-mapping");
  });

  it("survey-target: vault on a non-folder note returns no-mapping", () => {
    const fs = makeFakeFs({ "/vault/A/26.10 X": { "note.md": "file" } });
    const r = resolveFsPath("A/26.10 X.md", { "survey-target": "vault" }, cfg(), keys, fs);
    expect(r.kind).toBe("no-mapping");
  });

  it("NUL byte in survey-filepath returns no-mapping", () => {
    const fs = makeFakeFs({});
    const r = resolveFsPath("A/26.10 X.md", { "survey-filepath": "bad\0path" }, cfg(), keys, fs);
    expect(r.kind).toBe("no-mapping");
  });
});
