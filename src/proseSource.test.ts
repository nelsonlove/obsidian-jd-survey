import { describe, it, expect, vi } from "vitest";
import { generateProseFrom, ProseDeps } from "./proseSource";
import { DEFAULT_CONFIG } from "./config";
import type { ExecFn } from "./claudeCli";
import type { RequestFn } from "./anthropic";

const baseCfg = { ...DEFAULT_CONFIG, vaultRoot: "/v", fsRoot: "/d" } as any;

function makeExec(stdout: string, code = 0): ExecFn {
  return async (_bin, _args, _input, _env) => ({ code, stdout, stderr: "" });
}

function makeRequest(text: string, status = 200): RequestFn {
  return async (_opts) => ({ status, json: { content: [{ type: "text", text }] }, text: "" });
}

describe("generateProseFrom — auto mode", () => {
  it("returns CLI result when CLI succeeds (API not called)", async () => {
    const requestSpy = vi.fn(makeRequest("from-api"));
    const deps: ProseDeps = {
      exec: makeExec("from-cli"),
      request: requestSpy,
    };
    const cfg = { ...baseCfg, proseProvider: "auto", anthropicApiKey: "k" };
    const result = await generateProseFrom("prompt", cfg, deps);
    expect(result).toBe("from-cli");
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it("falls to API when CLI returns null and a key+request exist", async () => {
    const deps: ProseDeps = {
      exec: makeExec("", 1), // CLI fails
      request: makeRequest("from-api"),
    };
    const cfg = { ...baseCfg, proseProvider: "auto", anthropicApiKey: "k" };
    const result = await generateProseFrom("prompt", cfg, deps);
    expect(result).toBe("from-api");
  });

  it("returns null when both CLI and API fail", async () => {
    const deps: ProseDeps = {
      exec: makeExec("", 1),
      request: makeRequest("", 500),
    };
    const cfg = { ...baseCfg, proseProvider: "auto", anthropicApiKey: "k" };
    const result = await generateProseFrom("prompt", cfg, deps);
    expect(result).toBeNull();
  });
});

describe("generateProseFrom — claude-cli mode", () => {
  it("returns CLI result and never calls API", async () => {
    const requestSpy = vi.fn(makeRequest("from-api"));
    const deps: ProseDeps = {
      exec: makeExec("from-cli"),
      request: requestSpy,
    };
    const cfg = { ...baseCfg, proseProvider: "claude-cli", anthropicApiKey: "k" };
    const result = await generateProseFrom("prompt", cfg, deps);
    expect(result).toBe("from-cli");
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it("returns null when CLI fails without calling API", async () => {
    const requestSpy = vi.fn(makeRequest("from-api"));
    const deps: ProseDeps = {
      exec: makeExec("", 1),
      request: requestSpy,
    };
    const cfg = { ...baseCfg, proseProvider: "claude-cli", anthropicApiKey: "k" };
    const result = await generateProseFrom("prompt", cfg, deps);
    expect(result).toBeNull();
    expect(requestSpy).not.toHaveBeenCalled();
  });
});

describe("generateProseFrom — api mode", () => {
  it("returns API result and never calls CLI", async () => {
    const execSpy = vi.fn(makeExec("from-cli"));
    const deps: ProseDeps = {
      exec: execSpy,
      request: makeRequest("from-api"),
    };
    const cfg = { ...baseCfg, proseProvider: "api", anthropicApiKey: "k" };
    const result = await generateProseFrom("prompt", cfg, deps);
    expect(result).toBe("from-api");
    expect(execSpy).not.toHaveBeenCalled();
  });
});

describe("generateProseFrom — skeleton mode", () => {
  it("always returns null regardless of CLI or API availability", async () => {
    const deps: ProseDeps = {
      exec: makeExec("from-cli"),
      request: makeRequest("from-api"),
    };
    const cfg = { ...baseCfg, proseProvider: "skeleton", anthropicApiKey: "k" };
    const result = await generateProseFrom("prompt", cfg, deps);
    expect(result).toBeNull();
  });
});

describe("generateProseFrom — availability guards", () => {
  it("skips CLI when exec is null (auto mode)", async () => {
    const deps: ProseDeps = { exec: null, request: makeRequest("from-api") };
    const cfg = { ...baseCfg, proseProvider: "auto", anthropicApiKey: "k" };
    const result = await generateProseFrom("prompt", cfg, deps);
    expect(result).toBe("from-api");
  });

  it("skips API when no API key (auto mode, CLI also fails)", async () => {
    const deps: ProseDeps = { exec: makeExec("", 1), request: makeRequest("from-api") };
    const cfg = { ...baseCfg, proseProvider: "auto", anthropicApiKey: "" };
    const result = await generateProseFrom("prompt", cfg, deps);
    expect(result).toBeNull();
  });

  it("skips API when request is null (auto mode)", async () => {
    const deps: ProseDeps = { exec: makeExec("", 1), request: null };
    const cfg = { ...baseCfg, proseProvider: "auto", anthropicApiKey: "k" };
    const result = await generateProseFrom("prompt", cfg, deps);
    expect(result).toBeNull();
  });

  it("skips CLI when exec is null in claude-cli mode", async () => {
    const deps: ProseDeps = { exec: null, request: makeRequest("from-api") };
    const cfg = { ...baseCfg, proseProvider: "claude-cli", anthropicApiKey: "k" };
    const result = await generateProseFrom("prompt", cfg, deps);
    expect(result).toBeNull();
  });
});
