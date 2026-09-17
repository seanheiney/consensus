import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import type { Effort, Panelist } from "../types.js";
import { createAnthropicPanelist } from "./anthropic.js";
import { createOpenAIPanelist } from "./openai.js";
import { createGooglePanelist } from "./google.js";
import { createCompatPanelist } from "./compat.js";
import {
  createClaudeCliPanelist,
  createCodexCliPanelist,
  createGeminiCliPanelist,
  createGrokCliPanelist,
} from "./cli.js";

export type Vendor = "anthropic" | "openai" | "google" | "xai" | "openrouter" | "other";

export interface ProviderInfo {
  name: string;
  kind: "api" | "cli";
  vendor: Vendor;
  description: string;
  /** API providers: env var holding the key. */
  envKey?: string;
  /** API providers: default model. CLI providers use the CLI's own default unless a model is given. */
  defaultModel?: string;
  baseURL?: string;
  reasoning?: boolean;
  /** CLI providers: binary name, how to install it, how to log in. */
  bin?: string;
  installCommand?: string;
  loginCommand?: string;
  /** Human name of the subscription this CLI uses. */
  subscription?: string;
}

/**
 * Built-in providers. API default models verified against each vendor's docs
 * on 2026-09-15. CLI providers ride the vendor's own logged-in CLI, so a
 * consumer subscription works with no API key.
 */
export const PROVIDERS: Record<string, ProviderInfo> = {
  // --- subscription / CLI-backed -------------------------------------------
  claude: {
    name: "claude",
    kind: "cli",
    vendor: "anthropic",
    bin: "claude",
    installCommand: "npm install -g @anthropic-ai/claude-code",
    loginCommand: "claude auth login",
    subscription: "Claude Pro/Max (or Console login)",
    description: "Claude via Claude Code CLI",
  },
  codex: {
    name: "codex",
    kind: "cli",
    vendor: "openai",
    bin: "codex",
    installCommand: "npm install -g @openai/codex",
    loginCommand: "codex login",
    subscription: "ChatGPT Plus/Pro",
    description: "GPT via Codex CLI",
  },
  gemini: {
    name: "gemini",
    kind: "cli",
    vendor: "google",
    bin: "gemini",
    installCommand: "npm install -g @google/gemini-cli",
    loginCommand: "gemini",
    subscription: "Google account / Gemini Code Assist",
    description: "Gemini via Gemini CLI",
  },
  grok: {
    name: "grok",
    kind: "cli",
    vendor: "xai",
    bin: "grok",
    installCommand: "see https://docs.x.ai (Grok Build CLI)",
    loginCommand: "grok login",
    subscription: "X Premium / SuperGrok",
    description: "Grok via Grok CLI",
  },
  // --- API key ---------------------------------------------------------------
  anthropic: {
    name: "anthropic",
    kind: "api",
    vendor: "anthropic",
    envKey: "ANTHROPIC_API_KEY",
    defaultModel: "claude-fable-5-1",
    description: "Anthropic API (Messages)",
  },
  openai: {
    name: "openai",
    kind: "api",
    vendor: "openai",
    envKey: "OPENAI_API_KEY",
    defaultModel: "gpt-6-astra",
    description: "OpenAI API (Responses)",
  },
  xai: {
    name: "xai",
    kind: "api",
    vendor: "xai",
    envKey: "XAI_API_KEY",
    defaultModel: "grok-4.6",
    baseURL: "https://api.x.ai/v1",
    reasoning: true,
    description: "xAI API (OpenAI-compatible)",
  },
  google: {
    name: "google",
    kind: "api",
    vendor: "google",
    envKey: "GEMINI_API_KEY",
    defaultModel: "gemini-3.1-pro-preview",
    description: "Google Gemini API",
  },
  openrouter: {
    name: "openrouter",
    kind: "api",
    vendor: "openrouter",
    envKey: "OPENROUTER_API_KEY",
    defaultModel: "anthropic/claude-opus-5",
    baseURL: "https://openrouter.ai/api/v1",
    reasoning: true,
    description: "OpenRouter (any hosted model)",
  },
  groq: {
    name: "groq",
    kind: "api",
    vendor: "other",
    envKey: "GROQ_API_KEY",
    defaultModel: "openai/gpt-oss-120b",
    baseURL: "https://api.groq.com/openai/v1",
    reasoning: true,
    description: "Groq (fast open-weight models; GROQ_BASE_URL points it at any Groq-backed OpenAI-compatible gateway)",
  },
  ollama: {
    name: "ollama",
    kind: "api",
    vendor: "other",
    defaultModel: "llama3.3",
    baseURL: "http://localhost:11434/v1",
    description: "Local Ollama (no key)",
  },
};

export const VENDORS: { vendor: Vendor; label: string; cli?: string; api: string }[] = [
  { vendor: "anthropic", label: "Anthropic / Claude", cli: "claude", api: "anthropic" },
  { vendor: "openai", label: "OpenAI / ChatGPT", cli: "codex", api: "openai" },
  { vendor: "google", label: "Google / Gemini", cli: "gemini", api: "google" },
  { vendor: "xai", label: "xAI / Grok", cli: "grok", api: "xai" },
  { vendor: "openrouter", label: "OpenRouter", api: "openrouter" },
];

/** True if `bin` is executable somewhere on PATH. */
export function onPath(bin: string, env: NodeJS.ProcessEnv = process.env): boolean {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    try {
      accessSync(join(dir, bin), constants.X_OK);
      return true;
    } catch {
      /* next */
    }
  }
  return false;
}

/** API providers with a key in the environment. */
export function detectApiProviders(env: NodeJS.ProcessEnv = process.env): ProviderInfo[] {
  return Object.values(PROVIDERS).filter((p) => p.kind === "api" && p.envKey && env[p.envKey]);
}

/** CLI providers whose binary is installed (login is checked separately). */
export function detectCliProviders(env: NodeJS.ProcessEnv = process.env): ProviderInfo[] {
  return Object.values(PROVIDERS).filter((p) => p.kind === "cli" && onPath(p.bin!, env));
}

/** @deprecated use detectApiProviders */
export const detectProviders = detectApiProviders;

export interface ParsedSpec {
  provider: string;
  model?: string;
  baseURL?: string;
  /** Per-panelist reasoning effort from a `#effort` suffix. */
  effort?: Effort;
}

const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

/**
 * Parse a panelist spec.
 *   "claude"                             -> Claude Code CLI, its default model
 *   "codex:gpt-5.6-sol"                  -> Codex CLI with an explicit model
 *   "anthropic"                          -> API provider, default model
 *   "openai:gpt-6-astra"                 -> API provider, explicit model
 *   "compat:my-model@https://host/v1"    -> arbitrary OpenAI-compatible endpoint
 *   "openai:gpt-6-astra#max"             -> with per-panelist reasoning effort
 */
export function parseSpec(spec: string): ParsedSpec {
  let trimmed = spec.trim();
  let effort: Effort | undefined;
  const hash = trimmed.lastIndexOf("#");
  if (hash !== -1) {
    const e = trimmed.slice(hash + 1);
    if (!EFFORTS.has(e)) throw new Error(`Bad effort "${e}" in "${spec}". Use #low, #medium, #high, #xhigh or #max.`);
    effort = e as Effort;
    trimmed = trimmed.slice(0, hash);
  }
  const colon = trimmed.indexOf(":");
  const provider = colon === -1 ? trimmed : trimmed.slice(0, colon);
  let model: string | undefined = colon === -1 ? undefined : trimmed.slice(colon + 1);
  let baseURL: string | undefined;
  if (model) {
    const at = model.lastIndexOf("@");
    if (at !== -1 && /^https?:\/\//.test(model.slice(at + 1))) {
      baseURL = model.slice(at + 1);
      model = model.slice(0, at);
    }
  }
  const info = PROVIDERS[provider];
  if (provider !== "compat" && provider !== "any" && !info) {
    throw new Error(`Unknown provider "${provider}". Known: ${Object.keys(PROVIDERS).join(", ")}, compat, any`);
  }
  if (provider === "any") {
    // Portable seat: "any:<catalog model id>" is routed at run time to whatever
    // connection the user has for that model's vendor (CLI, API key, or OpenRouter).
    if (!model) throw new Error("any: spec needs a model, e.g. any:claude-opus-5");
    return { provider, model, baseURL, effort };
  }
  if (provider === "compat") {
    if (!model) throw new Error("compat spec needs a model: compat:<model>@<baseURL>");
    if (!baseURL) throw new Error("compat spec needs a base URL: compat:<model>@<baseURL>");
  } else if (!model && info!.kind === "api") {
    model = info!.defaultModel;
  }
  return { provider, model, baseURL, effort };
}

export function specId(p: ParsedSpec): string {
  return p.model ? `${p.provider}:${p.model}` : p.provider;
}

/** Spec string with model and effort, e.g. "claude:claude-opus-5#high". */
export function formatSpec(p: ParsedSpec): string {
  return specId(p) + (p.effort ? `#${p.effort}` : "");
}

export function createPanelist(
  spec: string | ParsedSpec,
  opts: { effort?: Effort; env?: NodeJS.ProcessEnv } = {},
): Panelist {
  const parsed = typeof spec === "string" ? parseSpec(spec) : spec;
  const env = opts.env ?? process.env;
  const { provider, model } = parsed;
  const effort = parsed.effort ?? opts.effort;

  switch (provider) {
    case "any":
      throw new Error(`Portable seat "any:${model}" was not resolved; resolveRun() must route it first.`);
    case "claude":
      return createClaudeCliPanelist({ model, effort });
    case "codex":
      return createCodexCliPanelist({ model, effort });
    case "gemini":
      return createGeminiCliPanelist({ model, effort });
    case "grok":
      return createGrokCliPanelist({ model, effort });
    case "anthropic":
      return createAnthropicPanelist({ model: model!, effort, apiKey: env.ANTHROPIC_API_KEY });
    case "openai":
      return createOpenAIPanelist({ model: model!, effort, apiKey: env.OPENAI_API_KEY, baseURL: parsed.baseURL });
    case "google":
      return createGooglePanelist({ model: model!, effort, apiKey: env.GEMINI_API_KEY });
    case "compat":
      return createCompatPanelist({ provider: "compat", model: model!, effort, baseURL: parsed.baseURL!, apiKey: env.COMPAT_API_KEY });
    default: {
      const info = PROVIDERS[provider]!;
      return createCompatPanelist({
        provider,
        model: model!,
        effort,
        baseURL: parsed.baseURL ?? (provider === "groq" ? env.GROQ_BASE_URL : undefined) ?? info.baseURL!,
        apiKey: info.envKey ? env[info.envKey] : undefined,
        reasoning: info.reasoning,
        maxRetries: provider === "groq" ? 6 : undefined,
      });
    }
  }
}
