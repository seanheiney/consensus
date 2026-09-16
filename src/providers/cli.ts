/**
 * Subscription-backed panelists: shell out to each vendor's own logged-in CLI
 * (Claude Code, Codex, Gemini CLI, Grok) in headless mode. The CLI owns the
 * auth, so a Claude / ChatGPT / Google / X subscription works with no API key
 * and this tool never sees a token.
 *
 * Every call runs in a fresh empty temp directory so the panelist cannot pick
 * up CLAUDE.md / AGENTS.md / project context from wherever the user ran us.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TransientError, type ChatMessage, type CompletionRequest, type CompletionResult, type Effort, type Panelist, type Usage } from "../types.js";

/** A single headless call is killed after this long unless the caller overrides it (see setDefaultTimeout / --timeout). */
export let DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
export function setDefaultTimeout(ms: number): void {
  DEFAULT_TIMEOUT_MS = ms;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export function runCommand(
  bin: string,
  args: string[],
  opts: { stdin?: string; env?: NodeJS.ProcessEnv; cwd?: string; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // Spawn with the user's real shell environment only. Stored consensus
    // credentials are never merged in (see credentials.ts).
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => reject(new Error(`failed to start ${bin}: ${err.message}`)));
    child.on("close", (code) => resolve({ stdout, stderr, code }));
    // SIGTERM first; SIGKILL if the CLI ignores it for 10 s.
    const kill = () => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
    };
    opts.signal?.addEventListener("abort", kill, { once: true });
    setTimeout(kill, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS).unref();
    child.stdin.on("error", () => {}); // EPIPE if the tool exits early
    if (opts.stdin !== undefined) child.stdin.write(opts.stdin);
    child.stdin.end();
  });
}

/** Single-turn CLIs get the conversation flattened into one prompt. */
export function flattenMessages(messages: ChatMessage[]): string {
  if (messages.length === 1) return messages[0]!.content;
  return messages
    .map((m) =>
      m.role === "user"
        ? m.content
        : `--- Your previous response ---\n${m.content}\n--- End of your previous response ---`,
    )
    .join("\n\n");
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "consensus-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function tail(s: string, n = 600): string {
  return s.trim().slice(-n);
}

function pickText(obj: unknown): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const o = obj as Record<string, unknown>;
  for (const k of ["result", "response", "text", "content", "message", "output"]) {
    if (typeof o[k] === "string") return o[k] as string;
  }
  return undefined;
}

export interface CliPanelistOptions {
  model?: string;
  effort?: Effort;
  /** Override the binary path. */
  bin?: string;
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Claude Code  (`claude -p`)  — Claude Pro/Max subscription or Console login
// ---------------------------------------------------------------------------
const CLAUDE_EFFORT: Record<Effort, string> = { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" };

/** Claude Code only accepts --effort on models that support it; Haiku 4.5 and older 4.5-era models ignore or reject it. */
function claudeTakesEffort(model?: string): boolean {
  return !model || !/haiku-4-5|sonnet-4-5|opus-4-5|-4-1|-3-/.test(model);
}

export function createClaudeCliPanelist(opts: CliPanelistOptions = {}): Panelist {
  const bin = opts.bin ?? "claude";
  return {
    id: `claude${opts.model ? `:${opts.model}` : ""}`,
    provider: "claude",
    model: opts.model ?? "default",
    effort: opts.effort,
    billing: process.env.ANTHROPIC_API_KEY ? "api" : "subscription",
    effortApplied: (e) => (claudeTakesEffort(opts.model) ? CLAUDE_EFFORT[e] : "ignored"),
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const effort = CLAUDE_EFFORT[opts.effort ?? req.effort ?? "high"];
      // Clean room: no built-in tools, no settings files, no CLAUDE.md / skills /
      // plugins / hooks (--safe-mode), and no user MCP servers (--strict-mcp-config).
      const args = [
        "-p",
        "--output-format", "json",
        "--tools", "",
        "--no-session-persistence",
        "--setting-sources", "",
        "--safe-mode",
        "--strict-mcp-config",
        "--mcp-config", '{"mcpServers":{}}',
        "--system-prompt", req.system,
      ];
      if (claudeTakesEffort(opts.model)) args.push("--effort", effort);
      if (opts.model) args.push("--model", opts.model);
      if (req.jsonSchema) args.push("--json-schema", JSON.stringify(req.jsonSchema));
      const res = await withTempDir((cwd) =>
        runCommand(bin, args, { stdin: flattenMessages(req.messages), cwd, signal: req.signal, timeoutMs: opts.timeoutMs }),
      );
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(res.stdout);
      } catch {
        if (res.code === null || /SIGTERM|SIGKILL|timed out/i.test(res.stderr)) throw new TransientError(`claude timed out or was killed (exit ${res.code})`);
        throw new Error(`claude returned non-JSON (exit ${res.code}): ${tail(res.stderr || res.stdout)}`);
      }
      if (parsed.is_error || (typeof parsed.result !== "string" && parsed.structured_output === undefined)) {
        const msg = typeof parsed.result === "string" ? parsed.result : tail(res.stderr);
        if (/rate limit|overloaded|529|429/i.test(msg)) throw new TransientError(`claude: ${msg}`);
        throw new Error(`claude error: ${msg}`);
      }
      // With --json-schema, Claude Code returns the validated object under structured_output.
      if (req.jsonSchema && parsed.structured_output !== undefined) parsed.result = JSON.stringify(parsed.structured_output);
      const u = parsed.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined;
      // Claude Code reports its own list-price cost (total_cost_usd); prefer it over re-deriving.
      const costUsd = typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : undefined;
      // input_tokens alone is tiny under Claude Code because most of the prompt is cache-written or cache-read.
      return {
        text: parsed.result as string,
        usage: u ? { inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), outputTokens: u.output_tokens ?? 0, cacheReadTokens: u.cache_read_input_tokens ?? 0, costUsd } : undefined,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Codex CLI  (`codex exec`)  — ChatGPT Plus/Pro subscription
// ---------------------------------------------------------------------------
const CODEX_EFFORT: Record<Effort, string> = { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "xhigh" };

export function createCodexCliPanelist(opts: CliPanelistOptions = {}): Panelist {
  const bin = opts.bin ?? "codex";
  return {
    id: `codex${opts.model ? `:${opts.model}` : ""}`,
    provider: "codex",
    model: opts.model ?? "default",
    effort: opts.effort,
    billing: process.env.OPENAI_API_KEY ? "api" : "subscription",
    effortApplied: (e) => CODEX_EFFORT[e],
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const effort = CODEX_EFFORT[opts.effort ?? req.effort ?? "high"];
      return withTempDir(async (cwd) => {
        const out = join(cwd, "last-message.txt");
        // Clean room: ignore ~/.codex/config.toml (approval policy, MCP servers,
        // features) and .rules; read-only sandbox in an empty temp dir; no colour.
        const args = [
          "exec",
          "--skip-git-repo-check",
          "--ephemeral",
          "--ignore-user-config",
          "--ignore-rules",
          "--color", "never",
          "--disable", "shell_tool",
          "--disable", "unified_exec",
          "--disable", "browser_use",
          "--disable", "computer_use",
          "--disable", "apps",
          "--json",
          "-s", "read-only",
          "-c", `model_reasoning_effort="${effort}"`,
          "-c", "mcp_servers={}",
          "-o", out,
        ];
        if (opts.model) args.push("-m", opts.model);
        if (req.jsonSchema) {
          const schemaFile = join(cwd, "schema.json");
          await writeFile(schemaFile, JSON.stringify(req.jsonSchema));
          args.push("--output-schema", schemaFile);
        }
        args.push("-");
        // Codex has no system-prompt flag; the instructions lead the prompt.
        const stdin = `# Instructions\n\n${req.system}\n\n# Request\n\n${flattenMessages(req.messages)}`;
        const res = await runCommand(bin, args, { stdin, cwd, signal: req.signal, timeoutMs: opts.timeoutMs });
        const text = await readFile(out, "utf8").catch(() => "");
        if (!text.trim()) {
          const err = res.stderr.match(/ERROR: (.*)/)?.[1] ?? res.stdout.match(/ERROR: (.*)/)?.[1];
          const msg = err ? tail(err) : tail(res.stderr || res.stdout);
          if (res.code === null || /rate limit|429|overloaded|timed out|SIGTERM/i.test(msg)) throw new TransientError(`codex: ${msg}`);
          const hint = /newer version of Codex/i.test(msg)
            ? " Fix: `npm install -g @openai/codex@latest`, or pick a model this Codex supports (e.g. codex:gpt-5.6-sol)."
            : /not logged in|login/i.test(msg) ? " Fix: `codex login`." : "";
          throw new Error(`codex produced no answer (exit ${res.code}): ${msg}${hint}`);
        }
        // --json emits one JSON object per line; `turn.completed` carries the real usage split.
        let usage: Usage | undefined;
        for (const line of res.stdout.split("\n")) {
          if (!line.startsWith("{")) continue;
          try {
            const ev = JSON.parse(line) as { type?: string; usage?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number; reasoning_output_tokens?: number } };
            if (ev.type === "turn.completed" && ev.usage) {
              const cached = ev.usage.cached_input_tokens ?? 0;
              usage = { inputTokens: Math.max(0, (ev.usage.input_tokens ?? 0) - cached), cacheReadTokens: cached, outputTokens: (ev.usage.output_tokens ?? 0) + (ev.usage.reasoning_output_tokens ?? 0) };
            }
          } catch {
            /* not our line */
          }
        }
        return { text, usage };
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Gemini CLI  (`gemini -p`)  — Google account login or GEMINI_API_KEY
// ---------------------------------------------------------------------------
export function createGeminiCliPanelist(opts: CliPanelistOptions = {}): Panelist {
  const bin = opts.bin ?? "gemini";
  return {
    id: `gemini${opts.model ? `:${opts.model}` : ""}`,
    provider: "gemini",
    model: opts.model ?? "default",
    effort: opts.effort,
    billing: process.env.GEMINI_API_KEY ? "api" : "subscription",
    effortApplied: () => "ignored",
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      // Clean room: plan (read-only) mode, and no MCP servers (an allow-list naming none).
      const args = ["-p", "Respond to the request above.", "-o", "json", "--approval-mode", "plan", "--allowed-mcp-server-names", "__consensus_none__"];
      if (opts.model) args.push("-m", opts.model);
      const stdin = `# Instructions\n\n${req.system}\n\n# Request\n\n${flattenMessages(req.messages)}`;
      const res = await withTempDir((cwd) =>
        runCommand(bin, args, {
          stdin,
          cwd,
          env: { GEMINI_CLI_TRUST_WORKSPACE: "true" },
          signal: req.signal,
          timeoutMs: opts.timeoutMs,
        }),
      );
      let parsed: Record<string, unknown> | undefined;
      try {
        const start = res.stdout.indexOf("{");
        parsed = JSON.parse(res.stdout.slice(start));
      } catch {
        /* handled below */
      }
      const text = pickText(parsed);
      if (!text) {
        const errLine = (res.stderr + res.stdout).match(/Error[^\n]*/)?.[0];
        const msg = tail(errLine ?? res.stderr ?? res.stdout);
        const hint = /Ineligible|no longer supported|authenticat/i.test(msg)
          ? " Fix: Google retired the free individual login for Gemini CLI; use an API key instead (`consensus connect google`)."
          : "";
        throw new Error(`gemini produced no answer (exit ${res.code}): ${msg}${hint}`);
      }
      const stats = (parsed?.stats as { models?: Record<string, { tokens?: { prompt?: number; candidates?: number } }> } | undefined)?.models;
      let usage;
      if (stats) {
        usage = { inputTokens: 0, outputTokens: 0 };
        for (const m of Object.values(stats)) {
          usage.inputTokens += m.tokens?.prompt ?? 0;
          usage.outputTokens += m.tokens?.candidates ?? 0;
        }
      }
      return { text, usage };
    },
  };
}

// ---------------------------------------------------------------------------
// Grok  (`grok -p`)  — X/SuperGrok login or XAI_API_KEY
// ---------------------------------------------------------------------------
const GROK_EFFORT: Record<Effort, string> = { low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" };

export function createGrokCliPanelist(opts: CliPanelistOptions = {}): Panelist {
  const bin = opts.bin ?? "grok";
  return {
    id: `grok${opts.model ? `:${opts.model}` : ""}`,
    provider: "grok",
    model: opts.model ?? "default",
    effort: opts.effort,
    billing: process.env.XAI_API_KEY ? "api" : "subscription",
    effortApplied: (e) => GROK_EFFORT[e],
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const effort = GROK_EFFORT[opts.effort ?? req.effort ?? "high"];
      return withTempDir(async (cwd) => {
        const promptFile = join(cwd, "prompt.md");
        await writeFile(promptFile, flattenMessages(req.messages));
        const args = [
          "--prompt-file", promptFile,
          "--output-format", "json",
          "--tools", "",
          "--system-prompt-override", req.system,
          "--reasoning-effort", effort,
        ];
        if (opts.model) args.push("-m", opts.model);
        const res = await runCommand(bin, args, { cwd, signal: req.signal, timeoutMs: opts.timeoutMs });
        let text: string | undefined;
        // Headless JSON may be a single object or one object per line; take the last with text.
        for (const line of res.stdout.trim().split("\n").reverse()) {
          try {
            const obj = JSON.parse(line) as Record<string, unknown>;
            if (obj.type === "error") throw new Error(String(obj.message ?? "grok error"));
            const t = pickText(obj);
            if (t) {
              text = t;
              break;
            }
          } catch (err) {
            if (err instanceof Error && !(err instanceof SyntaxError)) throw err;
          }
        }
        if (!text) text = res.code === 0 && res.stdout.trim() && !res.stdout.trim().startsWith("{") ? res.stdout.trim() : undefined;
        if (!text) throw new Error(`grok produced no answer (exit ${res.code}): ${tail(res.stderr || res.stdout)}`);
        return { text };
      });
    },
  };
}
