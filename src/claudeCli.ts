import type { JdSurveyConfig } from "./config";
import { postProcessProse } from "./anthropic";

export interface ExecResult { code: number | null; stdout: string; stderr: string; errorCode?: string; }
export type ExecFn = (bin: string, args: string[], input: string, env: Record<string, string | undefined>) => Promise<ExecResult>;

// Obsidian's spawned PATH omits Homebrew etc.; prepend the common locations where `claude` lives.
export function claudeEnv(base: Record<string, string | undefined>): Record<string, string | undefined> {
  const home = base.HOME || "";
  const extra = ["/opt/homebrew/bin", "/usr/local/bin", `${home}/.local/bin`, `${home}/.claude/local`].join(":");
  return { ...base, PATH: `${extra}:${base.PATH || ""}` };
}

export async function generateProseViaCli(prompt: string, cfg: JdSurveyConfig, exec: ExecFn): Promise<string | null> {
  const bin = cfg.claudeBinaryPath && cfg.claudeBinaryPath.trim() ? cfg.claudeBinaryPath.trim() : "claude";
  try {
    const r = await exec(bin, ["--print", "--no-session-persistence"], prompt, claudeEnv(process.env as Record<string, string | undefined>));
    if (r.errorCode || r.code !== 0) return null;
    return postProcessProse(r.stdout);
  } catch {
    return null;
  }
}
