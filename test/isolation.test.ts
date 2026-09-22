import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClaudeCliPanelist } from "../src/providers/cli.js";
import { describeIsolation, foldIsolation, isolationSummary, receiptFlags, seatEnv } from "../src/providers/isolation.js";
import { ConsensusEngine } from "../src/protocol/engine.js";
import { renderReport } from "../src/report.js";
import { agreeAll, fakePanelist, phaseOf } from "./fake.js";
import type { CompletionRequest, CompletionResult, Panelist } from "../src/types.js";

const HOST = {
  PATH: "/usr/bin:/bin",
  HOME: "/home/u",
  LC_ALL: "C",
  CLAUDECODE: "1",
  CLAUDE_CODE_SESSION_ID: "host-session",
  CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/host.sock",
  CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-x",
  ANTHROPIC_API_KEY: "sk-ant-x",
  OPENAI_API_KEY: "sk-openai-x",
  GITHUB_TOKEN: "ghp_x",
  AWS_PROFILE: "prod",
};

describe("seatEnv", () => {
  it("keeps what a CLI needs to start plus its own vendor's auth", () => {
    const { env } = seatEnv("claude", HOST);
    expect(env).toMatchObject({ PATH: "/usr/bin:/bin", HOME: "/home/u", LC_ALL: "C", ANTHROPIC_API_KEY: "sk-ant-x", CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-x", AWS_PROFILE: "prod" });
  });

  it("withholds the host agent's session state and other vendors' keys", () => {
    const { env, dropped } = seatEnv("claude", HOST);
    for (const k of ["CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_MESSAGING_SOCKET", "OPENAI_API_KEY", "GITHUB_TOKEN"]) expect(env[k]).toBeUndefined();
    expect(dropped).toBe(5);
    const codex = seatEnv("codex", HOST).env;
    expect(codex.OPENAI_API_KEY).toBe("sk-openai-x");
    expect(codex.ANTHROPIC_API_KEY).toBeUndefined();
    expect(codex.AWS_PROFILE).toBeUndefined();
  });

  it("passes extra names listed in CONSENSUS_SEAT_ENV", () => {
    const { env } = seatEnv("codex", { ...HOST, CONSENSUS_SEAT_ENV: "github_token, NOPE" });
    expect(env.GITHUB_TOKEN).toBe("ghp_x");
  });
});

describe("receipts", () => {
  it("record lockdown flags without the prompt-bearing values", () => {
    const flags = receiptFlags(["-p", "--output-format", "stream-json", "--tools", "", "--system-prompt", "SECRET SYSTEM", "--json-schema", "{}", "--model", "m"], ["--system-prompt", "--json-schema", "--model"]);
    expect(flags).toEqual(["-p", "--output-format", "stream-json", "--tools", '""']);
  });

  it("treat Claude Code's structured-output tool as clean and anything else as not", () => {
    const ok = foldIsolation(undefined, { route: "cli", evidence: "observed", tools: ["StructuredOutput"], mcpServers: [], plugins: [] });
    expect(ok.clean).toBe(true);
    const dirty = foldIsolation(ok, { route: "cli", evidence: "observed", tools: [], mcpServers: ["github"] });
    expect(dirty).toMatchObject({ clean: false, calls: 2, mcpServers: ["github"] });
    expect(describeIsolation("claude", dirty)).toContain("NOT CLEAN");
  });

  it("count Claude Code's built-in plugins as clean but installed plugins as not", () => {
    const builtin = foldIsolation(undefined, { route: "cli", evidence: "observed", tools: [], mcpServers: [], plugins: ["agents-md@builtin", "telemetry@builtin"] });
    expect(builtin.clean).toBe(true);
    expect(describeIsolation("claude", builtin)).toContain("CLI built-ins: agents-md, telemetry");
    expect(foldIsolation(undefined, { route: "cli", evidence: "observed", plugins: ["superpowers@claude-plugins"] }).clean).toBe(false);
  });

  it("drop Gemini's prompt text, which rides on -p", () => {
    expect(receiptFlags(["-p", "Respond to the request above.", "-o", "json", "--approval-mode", "plan"], ["-p", "-m"])).toEqual(["-o", "json", "--approval-mode", "plan"]);
  });

  it("keep the weakest evidence seen across calls", () => {
    const a = foldIsolation(undefined, { route: "cli", evidence: "observed", tools: [] });
    expect(foldIsolation(a, { route: "cli", evidence: "configured" }).evidence).toBe("configured");
  });
});

describe("Claude CLI seat (fake binary)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  async function fakeClaude(init: Record<string, unknown>): Promise<{ bin: string; envFile: string }> {
    const dir = await mkdtemp(join(tmpdir(), "consensus-fake-claude-"));
    const envFile = join(dir, "env.txt");
    const bin = join(dir, "claude");
    const lines = [
      JSON.stringify({ type: "system", subtype: "init", claude_code_version: "9.9.9", ...init }),
      JSON.stringify({ type: "assistant", message: {} }),
      JSON.stringify({ type: "result", is_error: false, result: "hello", usage: { input_tokens: 3, output_tokens: 2 }, total_cost_usd: 0.001 }),
    ];
    await writeFile(bin, `#!/bin/sh\ncat > /dev/null\nenv > "${envFile}"\ncat <<'EOF'\n${lines.join("\n")}\nEOF\n`);
    await chmod(bin, 0o755);
    return { bin, envFile };
  }

  it("parses stream-json, returns an observed receipt, and never hands the seat the host's session env", async () => {
    Object.assign(process.env, { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "host-session", OPENAI_API_KEY: "sk-openai-x" });
    const { bin, envFile } = await fakeClaude({ tools: [], mcp_servers: [], plugins: [{ name: "telemetry", path: "builtin", source: "telemetry@builtin" }], apiKeySource: "none" });
    const res = await createClaudeCliPanelist({ bin }).complete({ system: "sys", messages: [{ role: "user", content: "q" }] });
    expect(res.text).toBe("hello");
    expect(res.usage).toMatchObject({ outputTokens: 2, costUsd: 0.001 });
    expect(res.isolation).toMatchObject({ route: "cli", evidence: "observed", version: "9.9.9", tools: [], mcpServers: [], plugins: ["telemetry@builtin"], apiKeySource: "none" });
    expect(res.isolation!.flags).toContain("--strict-mcp-config");
    expect(res.isolation!.flags!.join(" ")).not.toContain("sys");
    const seen = await readFile(envFile, "utf8");
    expect(seen).not.toMatch(/^CLAUDECODE=/m);
    expect(seen).not.toMatch(/^CLAUDE_CODE_SESSION_ID=/m);
    expect(seen).not.toMatch(/^OPENAI_API_KEY=/m);
    expect(seen).toMatch(/^PATH=/m);
    expect(res.isolation!.envPassed).not.toContain("CLAUDECODE");
  });

  it("reports a seat that loaded MCP servers as not clean", async () => {
    const { bin } = await fakeClaude({ tools: ["Bash"], mcp_servers: [{ name: "github", status: "connected" }] });
    const res = await createClaudeCliPanelist({ bin }).complete({ system: "s", messages: [{ role: "user", content: "q" }] });
    const s = foldIsolation(undefined, res.isolation!);
    expect(s).toMatchObject({ clean: false, tools: ["Bash"], mcpServers: ["github"] });
  });
});

describe("engine", () => {
  function withReceipt(p: Panelist): Panelist {
    return {
      ...p,
      provider: "claude",
      async complete(req: CompletionRequest): Promise<CompletionResult> {
        return { ...(await p.complete(req)), isolation: { route: "cli", evidence: "observed", tools: [], mcpServers: [], plugins: [] } };
      },
    };
  }
  const script = (name: string) => (req: CompletionRequest) => (phaseOf(req) === "critique" ? agreeAll(req) : phaseOf(req) === "synthesize" ? "# Answer\nx" : `${name} answer`);

  it("records a receipt per seat across calls and summarizes it in the report", async () => {
    const cli = withReceipt(fakePanelist("claude:m", script("A")));
    const api = fakePanelist("openai:m", script("B"));
    const run = await new ConsensusEngine({ panel: [cli, api], rounds: 1 }).run("q");
    expect(run.isolation!["claude:m"]).toMatchObject({ route: "cli", evidence: "observed", clean: true });
    expect(run.isolation!["claude:m"]!.calls).toBeGreaterThanOrEqual(2);
    expect(run.isolation!["openai:m"]).toMatchObject({ route: "api", evidence: "request", clean: true });
    expect(isolationSummary(run.isolation)).toMatch(/^Isolation: 2\/2 seats clean/);
    expect(renderReport(run)).toContain("Isolation: 2/2 seats clean");
  });
});
