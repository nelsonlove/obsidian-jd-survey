import { App, PluginSettingTab, Setting } from "obsidian";
import type JdSurveyPlugin from "./main";

export class JdSurveySettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: JdSurveyPlugin) { super(app, plugin); }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;

    new Setting(containerEl).setName("Frontmatter prefix").setDesc("Base name for all survey frontmatter keys.")
      .addText((t) => t.setValue(s.frontmatterPrefix).onChange(async (v) => { s.frontmatterPrefix = v.trim() || "survey"; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Filesystem root").setDesc("Root of the filesystem tree (~ expanded).")
      .addText((t) => t.setValue(s.fsRoot).onChange(async (v) => { s.fsRoot = v.trim() || "~/Documents"; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Embed virtual directory")
      .setDesc("The External File Embed virtual-directory name that maps to your Filesystem Root; leave `icloud` unless you named it differently.")
      .addText((t) => t.setValue(s.embedVirtualDir).onChange(async (v) => { s.embedVirtualDir = v.trim() || "icloud"; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Default depth")
      .addText((t) => t.setValue(String(s.defaultDepth)).onChange(async (v) => { const n = parseInt(v, 10); if (n >= 1) { s.defaultDepth = n; await this.plugin.saveSettings(); } }));
    new Setting(containerEl).setName("Staleness threshold (days)")
      .addText((t) => t.setValue(String(s.stalenessThresholdDays)).onChange(async (v) => { const n = parseInt(v, 10); if (n >= 1) { s.stalenessThresholdDays = n; await this.plugin.saveSettings(); } }));
    new Setting(containerEl).setName("Date format")
      .addText((t) => t.setValue(s.dateFormat).onChange(async (v) => { s.dateFormat = v.trim() || "YYYY-MM-DD"; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Dashboard note path")
      .addText((t) => t.setValue(s.dashboardNotePath).onChange(async (v) => { s.dashboardNotePath = v.trim(); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Dashboard marker (begin)")
      .addText((t) => t.setValue(s.dashboardMarkerBegin).onChange(async (v) => { s.dashboardMarkerBegin = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Dashboard marker (end)")
      .addText((t) => t.setValue(s.dashboardMarkerEnd).onChange(async (v) => { s.dashboardMarkerEnd = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Generate prose (LLM)")
      .addToggle((t) => t.setValue(s.llmEnabled).onChange(async (v) => { s.llmEnabled = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Prose provider").setDesc("auto = try the local `claude` CLI, then the Anthropic API, else skeleton.")
      .addDropdown((d) => d
        .addOption("auto", "auto")
        .addOption("claude-cli", "claude-cli")
        .addOption("api", "api")
        .addOption("skeleton", "skeleton")
        .setValue(s.proseProvider)
        .onChange(async (v) => { s.proseProvider = v as typeof s.proseProvider; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Claude binary path").setDesc("Optional absolute path to the `claude` binary; leave blank to search PATH (Homebrew/usr-local/.local/.claude are auto-added).")
      .addText((t) => t.setPlaceholder("claude").setValue(s.claudeBinaryPath).onChange(async (v) => { s.claudeBinaryPath = v.trim(); await this.plugin.saveSettings(); }));
    new Setting(containerEl)
      .setName("Keep if accurate")
      .setDesc("When re-surveying, keep existing jd-survey-llm prose if a judge finds it still accurate. (Skill/human prose is always kept, regardless of this setting.)")
      .addToggle((t) =>
        t.setValue(s.keepIfAccurate).onChange(async (v) => {
          s.keepIfAccurate = v;
          await this.plugin.saveSettings();
        }),
      );
    new Setting(containerEl).setName("Anthropic model")
      .addText((t) => t.setValue(s.anthropicModel).onChange(async (v) => { s.anthropicModel = v.trim(); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Anthropic API key").setDesc("Stored in the plugin's data.json (which Syncs).")
      .addText((t) => { t.inputEl.type = "password"; t.setValue(s.anthropicApiKey).onChange(async (v) => { s.anthropicApiKey = v.trim(); await this.plugin.saveSettings(); }); });
  }
}
