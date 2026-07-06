import type { JdSurveyConfig } from "./config";

export type RequestFn = (opts: {
  url: string; method: string; headers: Record<string, string>; body: string;
}) => Promise<{ status: number; json: any; text: string }>;

const API_URL = "https://api.anthropic.com/v1/messages";
const MAX_TOKENS = 1024;

export function postProcessProse(text: string): string | null {
  let out = (text ?? "").trim().replace(/^["']+|["']+$/g, "").trim();
  if (!out) return null;
  if (out.length > 5000) out = out.slice(0, 5000).trimEnd() + "…";
  return out;
}

async function call(prompt: string, cfg: JdSurveyConfig, request: RequestFn): Promise<string | null> {
  if (!cfg.anthropicApiKey) return null;
  try {
    const res = await request({
      url: API_URL,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": cfg.anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: cfg.anthropicModel,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (res.status !== 200) return null;
    const block = res.json?.content?.find((b: any) => b.type === "text");
    return postProcessProse(block?.text ?? "");
  } catch {
    return null;
  }
}

export function generateProse(prompt: string, cfg: JdSurveyConfig, request: RequestFn): Promise<string | null> {
  return call(prompt, cfg, request);
}
export function judgeProse(prompt: string, cfg: JdSurveyConfig, request: RequestFn): Promise<string | null> {
  return call(prompt, cfg, request);
}
