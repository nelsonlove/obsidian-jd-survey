export type Frontmatter = Record<string, unknown>;
export type SurveyTarget = "documents" | "vault" | "none";
export type SurveyBy = "human" | "claude-code" | "jd-survey" | "jd-survey-llm";

export interface WalkResult {
  items: number;
  stubs: number;
  stubOriginalNames: string[];
}

export interface SurveyObject {
  at: string;     // formatted per config.dateFormat
  items: number;
  depth: number;
  by: SurveyBy;
  stubs: number;
}
