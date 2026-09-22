/** Connection status of each vendor: CLI installed / logged in, API key present, live probe. */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runCommand } from "./providers/cli.js";
import { PROVIDERS, VENDORS, onPath, createPanelist, type Vendor } from "./providers/index.js";
import type { IsolationReceipt, Panelist } from "./types.js";

export interface CliStatus {
  name: string;
  bin: string;
  installed: boolean;
  loggedIn: boolean;
  /** False when login was inferred from files rather than confirmed by the CLI. */
  verified: boolean;
  detail: string;
  /** CLI version when known (used for model compatibility checks). */
  version?: string;
}

export interface VendorStatus {
  vendor: Vendor;
  label: string;
  /** Absent for key-only vendors such as OpenRouter. */
  cli?: CliStatus;
  apiProvider: string;
  apiKey: boolean;
  connected: boolean;
  via?: "cli" | "api";
  /** Spec to use for this vendor (CLI preferred). */
  spec?: string;
}

export async function cliStatus(name: string, env: NodeJS.ProcessEnv = process.env): Promise<CliStatus> {
  const info = PROVIDERS[name]!;
  const bin = info.bin!;
  const base = { name, bin, installed: onPath(bin, env), loggedIn: false, verified: true, detail: "" };
  if (!base.installed) return { ...base, detail: `not installed (${info.installCommand})` };
  try {
    switch (name) {
      case "claude": {
        const r = await runCommand(bin, ["auth", "status"], { timeoutMs: 15000 });
        const j = JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))) as { loggedIn?: boolean; authMethod?: string; subscriptionType?: string };
        return { ...base, loggedIn: !!j.loggedIn, detail: j.loggedIn ? `logged in (${j.subscriptionType ?? j.authMethod ?? "ok"})` : "not logged in: run `claude auth login`" };
      }
      case "codex": {
        const [r, v] = await Promise.all([runCommand(bin, ["login", "status"], { timeoutMs: 15000 }), runCommand(bin, ["--version"], { timeoutMs: 15000 })]);
        const out = r.stdout + r.stderr;
        const ok = r.code === 0 && /logged in/i.test(out) && !/not logged in/i.test(out);
        const version = (v.stdout + v.stderr).match(/(\d+\.\d+\.\d+)/)?.[1];
        return { ...base, loggedIn: ok, version, detail: ok ? `${out.trim().split("\n")[0]!}${version ? `, codex ${version}` : ""}` : "not logged in: run `codex login`" };
      }
      case "gemini": {
        const oauth = existsSync(join(homedir(), ".gemini", "oauth_creds.json"));
        const key = !!env.GEMINI_API_KEY;
        // Google retired the individual free tier for Gemini CLI logins; a
        // login file alone is not a working connection. Only a key counts.
        return { ...base, loggedIn: key, verified: key, detail: key ? "using GEMINI_API_KEY" : oauth ? "Google login file found but that tier no longer serves the CLI; set GEMINI_API_KEY (`consensus connect google`)" : "not connected: set GEMINI_API_KEY (`consensus connect google`)" };
      }
      case "grok": {
        const r = await runCommand(bin, ["models"], { timeoutMs: 15000 });
        const out = r.stdout + r.stderr;
        const ok = !/not authenticated|not signed in/i.test(out) && r.code === 0;
        return { ...base, loggedIn: ok || !!env.XAI_API_KEY, detail: ok ? "logged in" : env.XAI_API_KEY ? "using XAI_API_KEY" : "not logged in: run `grok login`" };
      }
      default:
        return { ...base, detail: "unknown cli" };
    }
  } catch (err) {
    return { ...base, detail: `check failed: ${(err as Error).message}` };
  }
}

export async function scanVendors(env: NodeJS.ProcessEnv = process.env): Promise<VendorStatus[]> {
  return Promise.all(
    VENDORS.map(async (v) => {
      const cli = v.cli ? await cliStatus(v.cli, env) : undefined;
      const apiInfo = PROVIDERS[v.api]!;
      const apiKey = !!(apiInfo.envKey && env[apiInfo.envKey]);
      const via = cli?.installed && cli.loggedIn ? "cli" : apiKey ? "api" : undefined;
      return {
        vendor: v.vendor,
        label: v.label,
        cli,
        apiProvider: v.api,
        apiKey,
        connected: !!via,
        via,
        spec: via === "cli" ? v.cli! : via === "api" ? v.api : undefined,
      };
    }),
  );
}

export interface ProbeResult {
  id: string;
  ok: boolean;
  ms: number;
  sample?: string;
  error?: string;
  isolation?: IsolationReceipt;
}

/** Make one tiny real call through a panelist. */
export async function probe(panelist: Panelist, timeoutMs = 120_000): Promise<ProbeResult> {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await panelist.complete({
      system: "You are a connectivity check. Follow the instruction exactly.",
      messages: [{ role: "user", content: "Reply with exactly the two letters: OK" }],
      effort: "low",
      maxTokens: 8000, // reasoning models spend hidden tokens; a tiny cap can false-fail a healthy key
      signal: ac.signal,
      phase: "probe",
    });
    return { id: panelist.id, ok: true, ms: Date.now() - t0, sample: r.text.trim().slice(0, 40), isolation: r.isolation };
  } catch (err) {
    return { id: panelist.id, ok: false, ms: Date.now() - t0, error: (err as Error).message.split("\n")[0]!.slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeSpecs(specs: string[], env: NodeJS.ProcessEnv = process.env): Promise<ProbeResult[]> {
  return Promise.all(specs.map((s) => probe(createPanelist(s, { env }))));
}

/**
 * Check every seat's route before spending anything: CLI logged in, key
 * present, model driveable by the installed CLI. Returns one line per problem.
 */
export function preflight(panel: Panelist[], statuses: VendorStatus[], env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  for (const p of panel) {
    const info = PROVIDERS[p.provider];
    if (!info) continue; // compat: nothing to check
    if (info.kind === "cli") {
      const v = statuses.find((s) => s.cli?.name === p.provider);
      if (!v?.cli?.installed) problems.push(`${p.id}: ${p.provider} CLI is not installed (${info.installCommand})`);
      else if (!v.cli.loggedIn) problems.push(`${p.id}: ${v.cli.detail}`);
      else if (p.provider === "codex" && v.cli.version && p.model !== "default") {
        const { findCatalogModel, versionLt } = catalogLazy();
        const m = findCatalogModel(p.model);
        if (m?.model.minCodex && versionLt(v.cli.version, m.model.minCodex)) problems.push(`${p.id}: needs Codex >= ${m.model.minCodex}, you have ${v.cli.version} (npm install -g @openai/codex@latest, or use codex:gpt-5.6-sol)`);
      }
    } else if (info.envKey && !env[info.envKey]) {
      problems.push(`${p.id}: ${info.envKey} is not set (consensus connect ${info.vendor === "other" ? p.provider : info.vendor})`);
    }
  }
  return problems;
}

// Avoid a static import cycle (catalog imports doctor types).
function catalogLazy(): { findCatalogModel: typeof import("./catalog.js").findCatalogModel; versionLt: typeof import("./catalog.js").versionLt } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return _catalog;
}
import * as _catalog from "./catalog.js";
