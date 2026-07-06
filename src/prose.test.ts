import { describe, it, expect } from "vitest";
import { buildTree, buildLlmPrompt, extractEmbeddedCount, extractExistingProse } from "./prose";
import { makeFakeFs } from "./fs";

describe("buildTree", () => {
  it("renders dirs before files, bundles elided, stubs annotated, header first", () => {
    const fs = makeFakeFs({ "/r": { "z.pdf": "file", "sub": { "x": "file" }, "App.app": { "c": "file" }, ".foo.pdf.icloud": "file" } });
    const tree = buildTree("/r", 2, fs);
    const lines = tree.split("\n");
    expect(lines[0]).toBe("r/");
    expect(tree).toContain("App.app/   [bundle, elided]");
    expect(tree).toContain("foo.pdf   [iCloud, not downloaded]");
    // "sub" (dir) appears before "z.pdf" (file)
    expect(tree.indexOf("sub")).toBeLessThan(tree.indexOf("z.pdf"));
  });
});

describe("extract helpers", () => {
  it("extracts an embedded count", () => {
    expect(extractEmbeddedCount("About 24 documents scanned…")).toBe(24);
    expect(extractEmbeddedCount("No number here")).toBeNull();
  });
  it("extracts existing prose, dropping heading + callout", () => {
    const body = "## Contents (Filesystem)\n\n> [!info] Filesystem snapshot\n> 2 items · surveyed 2026-07-05 · depth 2\n\nReal prose here.\n\n## Next\n";
    expect(extractExistingProse(body)).toBe("Real prose here.");
  });
  it("returns null when only the placeholder is present", () => {
    const body = "## Contents (Filesystem)\n\n> [!info] Filesystem snapshot\n> 2 items · surveyed x · depth 2\n\n<!-- TODO: prose summary -->\n";
    expect(extractExistingProse(body)).toBeNull();
  });
});

describe("buildLlmPrompt", () => {
  it("includes the count and title and format instructions", () => {
    const p = buildLlmPrompt({ jdid: "26.10", title: "Taxes", fsPath: "/docs/26.10 Taxes", count: 24, depth: 2, tree: "26.10 Taxes/\n└── a.pdf" });
    expect(p).toContain("26.10");
    expect(p).toContain("Taxes");
    expect(p).toContain("24");
    expect(p).toMatch(/FORMAT A/); // format instructions present
  });
});
