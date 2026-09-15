import type { Effort, Panelist } from "../types.js";
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
export declare const PROVIDERS: Record<string, ProviderInfo>;
export declare const VENDORS: {
    vendor: Vendor;
    label: string;
    cli?: string;
    api: string;
}[];
/** True if `bin` is executable somewhere on PATH. */
export declare function onPath(bin: string, env?: NodeJS.ProcessEnv): boolean;
/** API providers with a key in the environment. */
export declare function detectApiProviders(env?: NodeJS.ProcessEnv): ProviderInfo[];
/** CLI providers whose binary is installed (login is checked separately). */
export declare function detectCliProviders(env?: NodeJS.ProcessEnv): ProviderInfo[];
/** @deprecated use detectApiProviders */
export declare const detectProviders: typeof detectApiProviders;
export interface ParsedSpec {
    provider: string;
    model?: string;
    baseURL?: string;
    /** Per-panelist reasoning effort from a `#effort` suffix. */
    effort?: Effort;
}
/**
 * Parse a panelist spec.
 *   "claude"                             -> Claude Code CLI, its default model
 *   "codex:gpt-5.6-sol"                  -> Codex CLI with an explicit model
 *   "anthropic"                          -> API provider, default model
 *   "openai:gpt-6-astra"                 -> API provider, explicit model
 *   "compat:my-model@https://host/v1"    -> arbitrary OpenAI-compatible endpoint
 *   "openai:gpt-6-astra#max"             -> with per-panelist reasoning effort
 */
export declare function parseSpec(spec: string): ParsedSpec;
export declare function specId(p: ParsedSpec): string;
/** Spec string with model and effort, e.g. "claude:claude-opus-5#high". */
export declare function formatSpec(p: ParsedSpec): string;
export declare function createPanelist(spec: string | ParsedSpec, opts?: {
    effort?: Effort;
    env?: NodeJS.ProcessEnv;
}): Panelist;
