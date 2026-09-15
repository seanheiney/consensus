/** Cost estimation shared by the engine (spend ceiling), CLI, MCP, and bench. */
import { CATALOG } from "./catalog.js";
import { parseSpec } from "./providers/index.js";
import type { Usage } from "./types.js";

export function priceFor(panelistId: string): { input: number; output: number } | undefined {
  const base = panelistId.split("+")[0]!;
  let model: string | undefined;
  try {
    model = parseSpec(base).model;
  } catch {
    return undefined;
  }
  if (!model) return undefined; // CLI default model: unknown
  for (const models of Object.values(CATALOG)) {
    const m = models.find((x) => x.id === model || x.openrouter === model);
    if (m && m.input !== undefined && m.output !== undefined) return { input: m.input, output: m.output };
  }
  return undefined;
}

/**
 * Estimated list-price cost of a run. Subscription-backed seats don't bill per
 * token; this is the equivalent API price. A seat that reported no usage at all
 * (Codex only prints a combined total) is listed as unpriced, never as $0.
 */
export function estimateCost(usage: Record<string, Usage>): { usd: number | null; unpriced: string[] } {
  let usd = 0;
  let any = false;
  const unpriced: string[] = [];
  for (const [id, u] of Object.entries(usage)) {
    if (u.costUsd !== undefined) {
      usd += u.costUsd;
      any = true;
      continue;
    }
    const p = priceFor(id);
    const reported = u.inputTokens || u.outputTokens || u.cacheReadTokens;
    if (!p || !reported) {
      unpriced.push(id);
      continue;
    }
    usd += (u.inputTokens / 1e6) * p.input + ((u.cacheReadTokens ?? 0) / 1e6) * p.input * 0.1 + (u.outputTokens / 1e6) * p.output;
    any = true;
  }
  return { usd: any ? usd : null, unpriced };
}

export class CostLimitError extends Error {
  constructor(public readonly spentUsd: number, public readonly limitUsd: number, public readonly phase: string) {
    super(`Spend ceiling reached: ~$${spentUsd.toFixed(2)} at API list price after ${phase}, limit $${limitUsd.toFixed(2)} (--max-cost). Unpriced subscription seats are not counted.`);
    this.name = "CostLimitError";
  }
}
