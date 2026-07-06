import type { JdSurveyConfig } from "./config";
import { generateProse, RequestFn } from "./anthropic";
import { generateProseViaCli, ExecFn } from "./claudeCli";

export interface ProseDeps { request: RequestFn | null; exec: ExecFn | null; }

export async function generateProseFrom(prompt: string, cfg: JdSurveyConfig, deps: ProseDeps): Promise<string | null> {
  const tryCli = async () => (deps.exec ? generateProseViaCli(prompt, cfg, deps.exec) : null);
  const tryApi = async () => (cfg.anthropicApiKey && deps.request ? generateProse(prompt, cfg, deps.request) : null);
  switch (cfg.proseProvider) {
    case "skeleton": return null;
    case "claude-cli": return await tryCli();
    case "api": return await tryApi();
    case "auto":
    default: return (await tryCli()) ?? (await tryApi());
  }
}
