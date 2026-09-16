import type { Usage } from "./types.js";
export declare function priceFor(panelistId: string): {
    input: number;
    output: number;
} | undefined;
export declare function isSubscriptionSeat(panelistId: string, usage?: Usage): boolean;
export interface CostEstimate {
    /** What API-key seats will actually bill (list price). null when no API seat reported usage. */
    usd: number | null;
    /** List-price equivalent of subscription (CLI) seats: quota, not a bill. null when none reported usage. */
    subscriptionEquivUsd: number | null;
    /** Seats that reported no usage or have no list price. */
    unpriced: string[];
}
export declare function estimateCost(usage: Record<string, Usage>): CostEstimate;
/** One line for humans. */
export declare function describeCost(c: CostEstimate): string;
export declare class CostLimitError extends Error {
    readonly spentUsd: number;
    readonly limitUsd: number;
    readonly phase: string;
    readonly kind: "billed" | "total";
    /** The run so far (no synthesis), when the engine could capture it. */
    partial?: import("./types.js").ConsensusRun;
    constructor(spentUsd: number, limitUsd: number, phase: string, kind?: "billed" | "total");
}
