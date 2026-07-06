import { describe, it, expect, vi } from "vitest";
import { generateProseViaCli, claudeEnv, ExecFn } from "./claudeCli";
import { DEFAULT_CONFIG } from "./config";

const baseCfg = { ...DEFAULT_CONFIG, vaultRoot: "/v", fsRoot: "/d" } as any;

function makeExec(result: Awaited<ReturnType<ExecFn>>): { exec: ExecFn; calls: { bin: string; args: string[]; input: string }[] } {
  const calls: { bin: string; args: string[]; input: string }[] = [];
  const exec: ExecFn = async (bin, args, input, _env) => { calls.push({ bin, args, input }); return result; };
  return { exec, calls };
}

describe("generateProseViaCli", () => {
  it("returns trimmed, unquoted prose on success", async () => {
    const { exec } = makeExec({ code: 0, stdout: '  "Prose."  ', stderr: "" });
    const result = await generateProseViaCli("my prompt", baseCfg, exec);
    expect(result).toBe("Prose.");
  });

  it("returns null on nonzero exit code", async () => {
    const { exec } = makeExec({ code: 1, stdout: "Some output", stderr: "Error" });
    const result = await generateProseViaCli("prompt", baseCfg, exec);
    expect(result).toBeNull();
  });

  it("returns null when errorCode is set (e.g. ENOENT)", async () => {
    const { exec } = makeExec({ code: null, stdout: "", stderr: "spawn error", errorCode: "ENOENT" });
    const result = await generateProseViaCli("prompt", baseCfg, exec);
    expect(result).toBeNull();
  });

  it("returns null on empty stdout", async () => {
    const { exec } = makeExec({ code: 0, stdout: "   ", stderr: "" });
    const result = await generateProseViaCli("prompt", baseCfg, exec);
    expect(result).toBeNull();
  });

  it("calls exec with --print and --no-session-persistence args", async () => {
    const { exec, calls } = makeExec({ code: 0, stdout: "result", stderr: "" });
    await generateProseViaCli("test prompt", baseCfg, exec);
    expect(calls[0].args).toEqual(["--print", "--no-session-persistence"]);
  });

  it("passes the prompt as input", async () => {
    const { exec, calls } = makeExec({ code: 0, stdout: "result", stderr: "" });
    await generateProseViaCli("test prompt", baseCfg, exec);
    expect(calls[0].input).toBe("test prompt");
  });

  it("uses claudeBinaryPath when set", async () => {
    const { exec, calls } = makeExec({ code: 0, stdout: "result", stderr: "" });
    const cfg = { ...baseCfg, claudeBinaryPath: "/usr/bin/my-claude" };
    await generateProseViaCli("prompt", cfg, exec);
    expect(calls[0].bin).toBe("/usr/bin/my-claude");
  });

  it("defaults to 'claude' when claudeBinaryPath is empty", async () => {
    const { exec, calls } = makeExec({ code: 0, stdout: "result", stderr: "" });
    await generateProseViaCli("prompt", { ...baseCfg, claudeBinaryPath: "" }, exec);
    expect(calls[0].bin).toBe("claude");
  });

  it("defaults to 'claude' when claudeBinaryPath is whitespace-only", async () => {
    const { exec, calls } = makeExec({ code: 0, stdout: "result", stderr: "" });
    await generateProseViaCli("prompt", { ...baseCfg, claudeBinaryPath: "   " }, exec);
    expect(calls[0].bin).toBe("claude");
  });

  it("returns null when exec throws", async () => {
    const exec: ExecFn = async () => { throw new Error("boom"); };
    const result = await generateProseViaCli("prompt", baseCfg, exec);
    expect(result).toBeNull();
  });
});

describe("claudeEnv", () => {
  it("prepends /opt/homebrew/bin to PATH", () => {
    const env = claudeEnv({ HOME: "/home/user", PATH: "/usr/bin" });
    expect(env.PATH).toMatch(/^\/opt\/homebrew\/bin:/);
  });

  it("includes /usr/local/bin, .local/bin, and .claude/local in PATH", () => {
    const env = claudeEnv({ HOME: "/home/user", PATH: "/usr/bin" });
    expect(env.PATH).toContain("/usr/local/bin");
    expect(env.PATH).toContain("/home/user/.local/bin");
    expect(env.PATH).toContain("/home/user/.claude/local");
  });

  it("preserves other env vars", () => {
    const env = claudeEnv({ HOME: "/home/user", PATH: "/usr/bin", CUSTOM: "value" });
    expect(env.CUSTOM).toBe("value");
  });
});
