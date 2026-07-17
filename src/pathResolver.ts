import path from "path";
import type { FsLike } from "./fs";
import type { JdSurveyConfig, SurveyKeys } from "./config";
import type { Frontmatter, SurveyTarget } from "./types";

export type ResolveResult =
  | { kind: "optout" }
  | { kind: "no-mapping" }
  | { kind: "resolved"; fsPath: string; skipPath: string | null; embedRel: string | null };

export function expandTilde(p: string, home: string): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return home + "/" + p.slice(2);
  return p;
}

function isFolderNote(relPath: string): boolean {
  const dir = path.posix.dirname(relPath);
  const stem = path.posix.basename(relPath, ".md");
  return dir !== "." && path.posix.basename(dir) === stem;
}

export function resolveFsPath(
  relPath: string,
  fm: Frontmatter,
  cfg: JdSurveyConfig,
  keys: SurveyKeys,
  fs: FsLike,
): ResolveResult {
  const target = (fm[keys.target] as SurveyTarget | undefined);

  // 1. Opt-out
  if (target === "none" || fm["has-filesystem"] === false) return { kind: "optout" };

  const home = process.env.HOME || "";
  const fsRoot = expandTilde(cfg.fsRoot, home);

  // 2. Explicit filepath override
  const fp = fm[keys.filepath];
  if (typeof fp === "string" && fp.trim() !== "") {
    const raw = fp.trim();
    if (raw.includes("\0")) return { kind: "no-mapping" };
    let abs: string;
    if (raw.startsWith("/") || raw.startsWith("~")) {
      abs = expandTilde(raw, home);
    } else {
      abs = path.posix.normalize(fsRoot + "/" + raw);
      // reject escapes above fsRoot
      if (abs !== fsRoot && !abs.startsWith(fsRoot + "/")) return { kind: "no-mapping" };
    }
    return fs.isDirectory(abs)
      ? { kind: "resolved", fsPath: abs, skipPath: null, embedRel: null }
      : { kind: "no-mapping" };
  }

  const folderNote = isFolderNote(relPath);

  // 3. Vault target (folder notes only)
  if (target === "vault") {
    if (!folderNote) return { kind: "no-mapping" };
    const parentRel = path.posix.dirname(relPath);
    const abs = path.posix.normalize(cfg.vaultRoot + "/" + parentRel);
    if (!fs.isDirectory(abs)) return { kind: "no-mapping" };
    const noteAbs = path.posix.normalize(cfg.vaultRoot + "/" + relPath);
    return { kind: "resolved", fsPath: abs, skipPath: noteAbs, embedRel: null };
  }

  // 4. Default: parallel-tree in fsRoot
  let mirrorRel: string;
  if (folderNote) mirrorRel = path.posix.dirname(relPath);
  else mirrorRel = relPath.replace(/\.md$/, "");
  const abs = path.posix.normalize(fsRoot + "/" + mirrorRel);
  if (!fs.isDirectory(abs)) return { kind: "no-mapping" };
  return { kind: "resolved", fsPath: abs, skipPath: null, embedRel: mirrorRel };
}
