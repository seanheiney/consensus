import { formatSpec } from "./providers/index.js";
export const CATALOG = {
    anthropic: [
        { id: "claude-fable-5-1", label: "Claude Fable 5.1", tier: "frontier", input: 10, output: 50, openrouter: "anthropic/claude-fable-5.1" },
        { id: "claude-opus-5", label: "Claude Opus 5", tier: "standard", input: 5, output: 25, openrouter: "anthropic/claude-opus-5" },
        { id: "claude-sonnet-5", label: "Claude Sonnet 5", tier: "standard", input: 2, output: 10, openrouter: "anthropic/claude-sonnet-5" },
        { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", tier: "budget", input: 1, output: 5, openrouter: "anthropic/claude-haiku-4.5" },
    ],
    openai: [
        { id: "gpt-6-astra", label: "GPT-6 Astra", tier: "frontier", input: 10, output: 50, note: "needs Codex CLI >= 0.154 when used via codex", openrouter: "openai/gpt-6-astra", minCodex: "0.154.0" },
        { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", tier: "standard", input: 4, output: 20, openrouter: "openai/gpt-5.6-sol" },
        { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", tier: "standard", input: 2, output: 12, openrouter: "openai/gpt-5.6-terra" },
        { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", tier: "budget", input: 0.2, output: 1.2, openrouter: "openai/gpt-5.6-luna" },
        { id: "gpt-5.4-mini", label: "GPT-5.4 mini", tier: "budget", input: 0.75, output: 4.5, openrouter: "openai/gpt-5.4-mini" },
    ],
    google: [
        { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)", tier: "frontier", input: 2, output: 12, openrouter: "google/gemini-3.1-pro-preview" },
        { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", tier: "standard", input: 0.75, output: 3.75, openrouter: "google/gemini-3.8-flash" },
        { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite", tier: "budget", input: 0.3, output: 2.5, openrouter: "google/gemini-3.5-flash-lite" },
    ],
    xai: [
        { id: "grok-4.6", label: "Grok 4.6", tier: "frontier", input: 2, output: 6, openrouter: "x-ai/grok-4.6" },
        { id: "grok-4.5", label: "Grok 4.5", tier: "standard", input: 2, output: 6, openrouter: "x-ai/grok-4.5" },
        { id: "grok-4.3", label: "Grok 4.3", tier: "budget", input: 1.25, output: 2.5, openrouter: "x-ai/grok-4.3" },
    ],
};
export function priceLabel(m) {
    return m.input !== undefined && m.output !== undefined ? `$${m.input}/$${m.output} per M` : "";
}
/** Built-in presets. `consensus setup` materializes the ones your connections can satisfy. */
export const PRESETS = [
    { name: "frontier", description: "Most capable model from each vendor at max effort. Slow, expensive, best.", shape: "per-vendor", tier: "frontier", effort: "max", rounds: 3 },
    { name: "balanced", description: "Strong mid-tier models (Opus 5, Sol, Grok 4.5, 3.8 Flash) at high effort.", shape: "per-vendor", tier: "standard", effort: "high", rounds: 3 },
    { name: "budget", description: "Cheapest capable model per vendor, medium effort, 2 rounds.", shape: "per-vendor", tier: "budget", effort: "medium", rounds: 2 },
    { name: "fast", description: "Quick sanity check: cheap models, low effort, one critique round.", shape: "per-vendor", tier: "budget", effort: "low", rounds: 1 },
    { name: "deep", description: "Frontier models, max effort, up to 5 rounds. For decisions that really matter.", shape: "per-vendor", tier: "frontier", effort: "max", rounds: 5 },
    { name: "perspectives", description: "One frontier model seated five times as first-principles, skeptic, pragmatist, security, and user-advocate.", shape: "personas", tier: "frontier", personas: ["first-principles", "skeptic", "pragmatist", "security", "user-advocate"], effort: "high", rounds: 3 },
    { name: "red-team", description: "Each vendor's standard model, plus a skeptic and a contrarian on the strongest one.", shape: "personas", tier: "standard", personas: ["skeptic", "contrarian"], effort: "high", rounds: 3 },
    { name: "claude-family", description: "Fable, Opus, Sonnet and Haiku debating each other. Works with only a Claude subscription.", shape: "family", vendor: "anthropic", effort: "high", rounds: 3 },
    { name: "gpt-family", description: "Astra, Sol, Terra and Luna debating each other. Works with only a ChatGPT subscription.", shape: "family", vendor: "openai", effort: "high", rounds: 3 },
    { name: "gemini-family", description: "Gemini Pro, Flash and Flash Lite debating each other.", shape: "family", vendor: "google", effort: "high", rounds: 3 },
    { name: "grok-family", description: "Grok 4.6, 4.5 and 4.3 debating each other.", shape: "family", vendor: "xai", effort: "high", rounds: 3 },
];
/** @deprecated use PRESETS */
export const STARTER_PROFILES = PRESETS;
/** First catalog model of the tier, falling back to the next tier down then up. */
export function pickForTier(vendor, tier) {
    const models = CATALOG[vendor];
    const order = tier === "frontier" ? ["frontier", "standard", "budget"] : tier === "standard" ? ["standard", "frontier", "budget"] : ["budget", "standard", "frontier"];
    for (const t of order) {
        const m = models.find((x) => x.tier === t);
        if (m)
            return m;
    }
    return undefined;
}
export const CATALOG_VENDORS = Object.keys(CATALOG);
/**
 * How to reach a vendor's model given the current connections: directly
 * (its CLI or API key) or, failing that, through OpenRouter.
 */
export function versionLt(a, b) {
    const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
    const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] ?? 0;
        const y = pb[i] ?? 0;
        if (x !== y)
            return x < y;
    }
    return false;
}
/** Why a direct route cannot seat this model, if it cannot. */
export function directRouteBlocker(vendor, model, statuses) {
    const direct = statuses.find((s) => s.vendor === vendor && s.connected && s.spec);
    if (!direct)
        return undefined;
    if (direct.via === "cli" && direct.spec === "codex" && model.minCodex && direct.cli?.version && versionLt(direct.cli.version, model.minCodex)) {
        return `codex ${direct.cli.version} < ${model.minCodex} required for ${model.id} (npm install -g @openai/codex@latest)`;
    }
    return undefined;
}
export function routeFor(vendor, model, statuses) {
    const direct = statuses.find((s) => s.vendor === vendor && s.connected && s.spec);
    if (direct && !directRouteBlocker(vendor, model, statuses))
        return { provider: direct.spec, model: model.id, viaOpenRouter: false };
    const or = statuses.find((s) => s.vendor === "openrouter" && s.connected);
    if (or && model.openrouter)
        return { provider: "openrouter", model: model.openrouter, viaOpenRouter: true };
    return undefined;
}
export function specFor(vendor, model, statuses, effort) {
    const r = routeFor(vendor, model, statuses);
    return r ? formatSpec({ provider: r.provider, model: r.model, effort }) : undefined;
}
/** Best model of the tier that can actually be seated here (skips e.g. gpt-6-astra on an old Codex). */
export function pickSeatable(vendor, tier, statuses) {
    const order = tier === "frontier" ? ["frontier", "standard", "budget"] : tier === "standard" ? ["standard", "frontier", "budget"] : ["budget", "standard", "frontier"];
    const preferred = pickForTier(vendor, tier);
    for (const t of order) {
        for (const m of CATALOG[vendor].filter((x) => x.tier === t)) {
            if (routeFor(vendor, m, statuses)) {
                return { model: m, spec: (effort) => specFor(vendor, m, statuses, effort), substituted: preferred && preferred.id !== m.id ? `${preferred.id}: ${directRouteBlocker(vendor, preferred, statuses) ?? "not seatable"}` : undefined };
            }
        }
    }
    return undefined;
}
/** Look a catalog model up by its vendor id or OpenRouter id. */
export function findCatalogModel(id) {
    for (const vendor of CATALOG_VENDORS) {
        const model = CATALOG[vendor].find((m) => m.id === id || m.openrouter === id);
        if (model)
            return { vendor, model };
    }
    return undefined;
}
