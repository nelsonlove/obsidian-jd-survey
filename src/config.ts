export interface JdSurveyConfig {
  frontmatterPrefix: string;
  vaultRoot: string;            // absolute; filled from adapter.basePath at runtime
  fsRoot: string;               // absolute; "~" expanded
  defaultDepth: number;
  dateFormat: string;
  stalenessThresholdDays: number;
  dashboardNotePath: string;    // vault-relative path to the dashboard note
  dashboardMarkerBegin: string;
  dashboardMarkerEnd: string;
  llmEnabled: boolean;
  anthropicApiKey: string;
  anthropicModel: string;
  keepIfAccurate: boolean;
}

export const DEFAULT_CONFIG: Omit<JdSurveyConfig, "vaultRoot"> = {
  frontmatterPrefix: "survey",
  fsRoot: "~/Documents",
  defaultDepth: 2,
  dateFormat: "YYYY-MM-DD",
  stalenessThresholdDays: 180,
  dashboardNotePath: "00-09 System/08 Obsidian/08.34 Stale surveys.md",
  dashboardMarkerBegin: "<!-- table:begin -->",
  dashboardMarkerEnd: "<!-- table:end -->",
  llmEnabled: true,
  anthropicApiKey: "",
  anthropicModel: "claude-haiku-4-5-20251001",
  keepIfAccurate: false,
};

export interface SurveyKeys {
  object: string;
  target: string;
  filepath: string;
  legacyFlat: string[];
  legacyBare: string | null;
}

export function deriveKeys(prefix: string): SurveyKeys {
  return {
    object: prefix,
    target: `${prefix}-target`,
    filepath: `${prefix}-filepath`,
    legacyFlat: ["at", "items", "depth", "by", "stubs"].map((s) => `${prefix}-${s}`),
    legacyBare: prefix === "survey" ? "surveyed" : null,
  };
}
