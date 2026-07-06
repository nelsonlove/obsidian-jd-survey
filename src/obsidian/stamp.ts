import { App, TFile } from "obsidian";
import type { Frontmatter } from "../types";
import { upsertSection } from "../renderer";

export async function stampFrontmatter(
  app: App, file: TFile, mutate: (fm: Frontmatter) => void,
): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => { mutate(fm as Frontmatter); });
}

const FM_BLOCK = /^---\n[\s\S]*?\n---\n?/;

export async function writeBody(app: App, file: TFile, section: string): Promise<void> {
  await app.vault.process(file, (data) => {
    const m = FM_BLOCK.exec(data);
    const head = m ? data.slice(0, m[0].length) : "";
    const body = m ? data.slice(m[0].length) : data;
    return head + upsertSection(body, section);
  });
}
