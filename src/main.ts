import { Notice, Plugin, Platform, TFile, requestUrl } from "obsidian";
import { DEFAULT_CONFIG, JdSurveyConfig, deriveKeys } from "./config";
import { NodeFs } from "./fs";
import { surveyNote } from "./survey";
import { stampFrontmatter, writeBody } from "./obsidian/stamp";
import { applySurveyToFrontmatter, migrateFrontmatter } from "./frontmatter";
import { candidatesFromPaths } from "./obsidian/notes";
import { readSurveyState, stalenessReason } from "./staleness";
import { walk } from "./walker";
import { resolveFsPath } from "./pathResolver";
import { buildStatusTable, spliceMarkers, StatusRow } from "./dashboard";
import { formatDate } from "./date";
import { JdSurveySettingTab } from "./settings";
import type { RequestFn } from "./anthropic";
import type { ExecFn } from "./claudeCli";

const request: RequestFn = async (opts) => {
  const r = await requestUrl({ url: opts.url, method: opts.method, headers: opts.headers, body: opts.body, throw: false });
  return { status: r.status, json: r.json, text: r.text };
};

const exec: ExecFn = (bin, args, input, env) => new Promise((resolve) => {
  const cp = require("child_process") as typeof import("child_process");
  let stdout = "", stderr = "";
  let child: import("child_process").ChildProcess;
  try { child = cp.spawn(bin, args, { env: env as NodeJS.ProcessEnv }); }
  catch (e: any) { resolve({ code: null, stdout: "", stderr: String(e?.message ?? e), errorCode: e?.code }); return; }
  const timer = setTimeout(() => child.kill(), 120000);
  child.on("error", (e: any) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: String(e?.message ?? e), errorCode: e?.code }); });
  child.stdout?.on("data", (d) => { stdout += d.toString(); });
  child.stderr?.on("data", (d) => { stderr += d.toString(); });
  child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  if (input) { child.stdin?.write(input); child.stdin?.end(); }
});

export default class JdSurveyPlugin extends Plugin {
  settings!: JdSurveyConfig;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new JdSurveySettingTab(this.app, this));

    this.addCommand({ id: "survey-this-slot", name: "Survey this slot", callback: () => this.surveyActive() });
    this.addCommand({ id: "survey-all-stale", name: "Survey all stale slots", callback: () => this.surveyAllStale() });
    this.addCommand({ id: "refresh-stale-table", name: "Refresh stale-surveys table", callback: () => this.refreshDashboard() });
    this.addCommand({ id: "migrate-has-filesystem", name: "Migrate has-filesystem", callback: () => this.migrateAll() });
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) || {};
    // Spread order: defaults → persisted data → runtime vaultRoot (always wins)
    this.settings = { ...DEFAULT_CONFIG, ...data, vaultRoot: this.vaultRoot() };
  }
  async saveSettings(): Promise<void> {
    const { vaultRoot, ...persist } = this.settings;
    await this.saveData(persist);
  }
  private vaultRoot(): string {
    return (this.app.vault.adapter as any).basePath ?? "";
  }
  private deps() {
    return { fs: new NodeFs(), today: new Date(), request, exec };
  }

  private guard(): boolean {
    if (!Platform.isDesktopApp) { new Notice("jd-survey is desktop-only."); return false; }
    return true;
  }

  async surveyActive(): Promise<void> {
    if (!this.guard()) return;
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") { new Notice("jd-survey: no active markdown note"); return; }
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = { ...(cache?.frontmatter ?? {}) };
    const body = await this.app.vault.read(file);
    const res = await surveyNote(file.path, fm, body, { ...this.settings, vaultRoot: this.vaultRoot() }, this.deps());
    if (res.status === "skipped") { new Notice(`jd-survey: skipped (${res.reason})`); return; }
    const keys = deriveKeys(this.settings.frontmatterPrefix);
    await writeBody(this.app, file, res.section!);
    await stampFrontmatter(this.app, file, (f) => applySurveyToFrontmatter(f, res.survey!, keys));
    new Notice(`jd-survey: ${res.survey!.items} items · ${res.by}`);
  }

  async surveyAllStale(): Promise<void> {
    if (!this.guard()) return;
    const cfg = { ...this.settings, vaultRoot: this.vaultRoot() };
    const keys = deriveKeys(cfg.frontmatterPrefix);
    const deps = this.deps();
    const { fs, today } = deps;
    const cands = candidatesFromPaths(this.app.vault.getMarkdownFiles().map((f) => f.path));
    let changed = 0;
    for (const c of cands) {
      const file = this.app.vault.getAbstractFileByPath(c.relPath) as TFile | null;
      if (!file) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
      const resolved = resolveFsPath(c.relPath, fm, cfg, keys, fs);
      if (resolved.kind !== "resolved") continue;
      const state = readSurveyState(fm, keys, cfg.dateFormat);
      const depth = state.depth && state.depth > 0 ? state.depth : cfg.defaultDepth;
      const w = walk(resolved.fsPath, depth, fs, resolved.skipPath ?? undefined);
      if (w.items === 0) continue;
      const reason = stalenessReason(state, { items: w.items, stubs: w.stubs }, cfg.stalenessThresholdDays, today);
      if (!reason) continue; // fresh — skip
      const body = await this.app.vault.read(file);
      const res = await surveyNote(c.relPath, fm, body, cfg, deps);
      if (res.status !== "surveyed") continue;
      await writeBody(this.app, file, res.section!);
      await stampFrontmatter(this.app, file, (f) => applySurveyToFrontmatter(f, res.survey!, keys));
      changed += 1;
    }
    new Notice(`jd-survey: surveyed ${changed} stale slot(s)`);
  }

  async refreshDashboard(): Promise<void> {
    if (!this.guard()) return;
    const cfg = { ...this.settings, vaultRoot: this.vaultRoot() };
    const keys = deriveKeys(cfg.frontmatterPrefix);
    const fs = new NodeFs();
    const today = new Date();
    const rows: StatusRow[] = [];
    for (const c of candidatesFromPaths(this.app.vault.getMarkdownFiles().map((f) => f.path))) {
      const file = this.app.vault.getAbstractFileByPath(c.relPath) as TFile | null;
      if (!file) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
      const resolved = resolveFsPath(c.relPath, fm, cfg, keys, fs);
      if (resolved.kind !== "resolved") continue;
      const state = readSurveyState(fm, keys, cfg.dateFormat);
      const depth = state.depth && state.depth > 0 ? state.depth : cfg.defaultDepth;
      const w = walk(resolved.fsPath, depth, fs, resolved.skipPath ?? undefined);
      if (w.items === 0) continue;
      const reason = stalenessReason(state, { items: w.items, stubs: w.stubs }, cfg.stalenessThresholdDays, today);
      if (!reason) continue;
      rows.push({ jdid: c.jdid, title: c.title, at: state.at ? formatDate(state.at, cfg.dateFormat) : null, items: state.items, current: w.items, reason });
    }
    const table = buildStatusTable(rows);
    const dash = this.app.vault.getAbstractFileByPath(cfg.dashboardNotePath) as TFile | null;
    if (!dash) { new Notice(`jd-survey: dashboard note not found: ${cfg.dashboardNotePath}`); return; }
    let ok = false;
    await this.app.vault.process(dash, (data) => {
      const r = spliceMarkers(data, cfg.dashboardMarkerBegin, cfg.dashboardMarkerEnd, table);
      ok = r.ok; return r.ok ? r.body : data;
    });
    new Notice(ok ? `jd-survey: dashboard updated (${rows.length} stale)` : "jd-survey: dashboard markers not found");
  }

  async migrateAll(): Promise<void> {
    if (!this.guard()) return;
    const keys = deriveKeys(this.settings.frontmatterPrefix);
    let changed = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
      if (!Object.prototype.hasOwnProperty.call(fm, "has-filesystem")) continue;
      await stampFrontmatter(this.app, file, (f) => migrateFrontmatter(f, keys));
      changed += 1;
    }
    new Notice(`jd-survey: migrated ${changed} note(s)`);
  }
}
