import type { Usage } from "./types.js";
export declare function priceFor(panelistId: string): {
    input: number;
    output: number;
} | undefined;
/**
 * Estimated list-price cost of a run. Subscription-backed seats don't bill per
 * token; this is the equivalent API price. A seat that reported no usage at all
 * (Codex only prints a combined total) is listed as unpriced, never as $0.
 */
export declare function estimateCost(usage: Record<string, Usage>): {
    usd: number | null;
    unpriced: string[];
};
export declare class CostLimitError extends Error {
    readonly spentUsd: number;
    readonly limitUsd: number;
    readonly phase: string;
    constructor(spentUsd: number, limitUsd: number, phase: string);
}
