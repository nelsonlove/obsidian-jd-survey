import type { DirEntry, FsLike } from "./fs";
import type { WalkResult } from "./types";

export const EXCLUDED_NAMES: ReadonlySet<string> = new Set([".DS_Store", "Thumbs.db"]);

export const BUNDLE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".app", ".bundle", ".docset", ".framework", ".inform", ".kext",
  ".photoslibrary", ".pkg", ".plugin", ".rtfd", ".wdgt",
]);

export function isVisible(name: string): boolean {
  return !name.startsWith(".") && !EXCLUDED_NAMES.has(name);
}

export function isIcloudStub(entry: DirEntry): boolean {
  return entry.isFile() && entry.name.startsWith(".") && entry.name.endsWith(".icloud");
}

export function icloudOriginalName(name: string): string {
  return name.slice(1, name.length - ".icloud".length);
}

export function isBundle(entry: DirEntry): boolean {
  if (!entry.isDirectory()) return false;
  const lower = entry.name.toLowerCase();
  for (const ext of BUNDLE_EXTENSIONS) if (lower.endsWith(ext)) return true;
  return false;
}

export function walk(root: string, depth: number, fs: FsLike, skipPath?: string): WalkResult {
  const stubNames: string[] = [];
  function rec(dir: string, current: number, skip?: string): { items: number; stubs: number } {
    if (current >= depth) return { items: 0, stubs: 0 };
    let items = 0, stubs = 0;
    for (const entry of fs.readDir(dir)) {
      const abs = dir + "/" + entry.name;
      if (skip && abs === skip) continue;
      if (isIcloudStub(entry)) { stubs += 1; stubNames.push(icloudOriginalName(entry.name)); continue; }
      if (!isVisible(entry.name)) continue;
      items += 1;
      if (entry.isDirectory() && !isBundle(entry)) {
        const sub = rec(abs, current + 1, undefined);
        items += sub.items; stubs += sub.stubs;
      }
    }
    return { items, stubs };
  }
  const r = rec(root, 0, skipPath);
  return { items: r.items, stubs: r.stubs, stubOriginalNames: stubNames.sort() };
}
