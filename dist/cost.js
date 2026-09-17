/** Cost estimation shared by the engine (spend ceiling), CLI, MCP, and bench. */
import { CATALOG } from "./catalog.js";
import { parseSpec } from "./providers/index.js";
/** Groq list prices per 1M tokens (console.groq.com/docs/models, checked 2026-09-17). Models priced "contact sales" are left out. */
export const GROQ_PRICES = {
    "openai/gpt-oss-120b": { input: 0.15, output: 0.6 },
    "openai/gpt-oss-20b": { input: 0.075, output: 0.3 },
    "qwen/qwen3.8-27b": { input: 0.8, output: 4 },
};
export function priceFor(panelistId) {
    const base = panelistId.split("+")[0];
    let model;
    try {
        model = parseSpec(base).model;
    }
    catch {
        return undefined;
    }
    if (!model)
        return undefined; // CLI default model: unknown
    if (base.startsWith("groq:") && GROQ_PRICES[model])
        return GROQ_PRICES[model];
    for (const models of Object.values(CATALOG)) {
        const m = models.find((x) => x.id === model || x.openrouter === model);
        if (m && m.input !== undefined && m.output !== undefined)
            return { input: m.input, output: m.output };
    }
    return undefined;
}
/**
 * Estimated list-price cost of a run. Subscription-backed seats don't bill per
 * token; this is the equivalent API price. A seat that reported no usage at all
 * (Codex only prints a combined total) is listed as unpriced, never as $0.
 */
const SUBSCRIPTION_PROVIDERS = new Set(["claude", "codex", "gemini", "grok"]);
export function isSubscriptionSeat(panelistId, usage) {
    if (usage?.billing)
        return usage.billing === "subscription";
    return SUBSCRIPTION_PROVIDERS.has(panelistId.split(":")[0].split("+")[0]);
}
function seatCost(id, u) {
    if (u.costUsd !== undefined)
        return u.costUsd;
    const p = priceFor(id);
    const reported = u.inputTokens || u.outputTokens || u.cacheReadTokens;
    if (!p || !reported)
        return undefined;
    return (u.inputTokens / 1e6) * p.input + ((u.cacheReadTokens ?? 0) / 1e6) * p.input * 0.1 + (u.outputTokens / 1e6) * p.output;
}
export function estimateCost(usage) {
    let usd = 0;
    let sub = 0;
    let anyApi = false;
    let anySub = false;
    const unpriced = [];
    for (const [id, u] of Object.entries(usage)) {
        const c = seatCost(id, u);
        if (c === undefined) {
            unpriced.push(id);
            continue;
        }
        if (isSubscriptionSeat(id, u)) {
            sub += c;
            anySub = true;
        }
        else {
            usd += c;
            anyApi = true;
        }
    }
    return { usd: anyApi ? usd : null, subscriptionEquivUsd: anySub ? sub : null, unpriced };
}
/** One line for humans. */
export function describeCost(c) {
    const parts = [];
    parts.push(c.usd !== null ? `billed to API keys: ~$${c.usd.toFixed(2)} at list price` : "billed to API keys: $0 (no API seats)");
    if (c.subscriptionEquivUsd !== null)
        parts.push(`subscription seats: quota, not a bill (~$${c.subscriptionEquivUsd.toFixed(2)} list-price equivalent)`);
    if (c.unpriced.length)
        parts.push(`no usage reported: ${c.unpriced.join(", ")}`);
    return parts.join("; ");
}
export class CostLimitError extends Error {
    spentUsd;
    limitUsd;
    phase;
    kind;
    /** The run so far (no synthesis), when the engine could capture it. */
    partial;
    constructor(spentUsd, limitUsd, phase, kind = "billed") {
        super(kind === "billed"
            ? `Spend ceiling reached: ~$${spentUsd.toFixed(2)} billed to API keys after ${phase}, limit $${limitUsd.toFixed(2)} (--max-cost). Subscription seats are quota and are not counted.`
            : `Spend ceiling reached: ~$${spentUsd.toFixed(2)} at list price (billed + subscription-equivalent) after ${phase}, limit $${limitUsd.toFixed(2)} (--max-spend).`);
        this.spentUsd = spentUsd;
        this.limitUsd = limitUsd;
        this.phase = phase;
        this.kind = kind;
        this.name = "CostLimitError";
    }
}
