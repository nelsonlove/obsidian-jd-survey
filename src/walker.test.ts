import { describe, it, expect } from "vitest";
import { walk, isVisible, icloudOriginalName } from "./walker";
import { makeFakeFs } from "./fs";

describe("walk", () => {
  it("counts visible items and excludes dotfiles/DS_Store", () => {
    const fs = makeFakeFs({ "/r": { "a.pdf": "file", "b.txt": "file", ".DS_Store": "file", ".hidden": "file" } });
    const r = walk("/r", 2, fs);
    expect(r.items).toBe(2);
    expect(r.stubs).toBe(0);
  });

  it("counts a subdir as 1 and adds its contents within depth", () => {
    const fs = makeFakeFs({ "/r": { "sub": { "x": "file", "y": "file" } } });
    // depth 2: sub(1) + x + y = 3
    expect(walk("/r", 2, fs).items).toBe(3);
    // depth 1: only sub(1)
    expect(walk("/r", 1, fs).items).toBe(1);
  });

  it("treats iCloud stubs separately and recovers original names", () => {
    const fs = makeFakeFs({ "/r": { ".foo.pdf.icloud": "file", "real.pdf": "file" } });
    const r = walk("/r", 2, fs);
    expect(r.items).toBe(1);
    expect(r.stubs).toBe(1);
    expect(r.stubOriginalNames).toEqual(["foo.pdf"]);
  });

  it("counts a bundle as 1 and does not recurse into it", () => {
    const fs = makeFakeFs({ "/r": { "App.app": { "Contents": { "a": "file", "b": "file" } } } });
    expect(walk("/r", 2, fs).items).toBe(1);
  });

  it("honors skipPath at the top level", () => {
    const fs = makeFakeFs({ "/r": { "note.md": "file", "a.pdf": "file" } });
    expect(walk("/r", 2, fs, "/r/note.md").items).toBe(1);
  });

  it("isVisible + icloudOriginalName basics", () => {
    expect(isVisible(".DS_Store")).toBe(false);
    expect(isVisible("a.pdf")).toBe(true);
    expect(icloudOriginalName(".foo.pdf.icloud")).toBe("foo.pdf");
  });
});
