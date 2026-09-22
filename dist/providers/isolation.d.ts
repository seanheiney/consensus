/**
 * What a subscription seat is allowed to inherit, and the receipt each call
 * returns so a run can show (not just claim) that its seats were isolated.
 */
import type { IsolationReceipt, SeatIsolation } from "../types.js";
/**
 * The environment a seat's CLI is spawned with: an allow-list, not the parent
 * environment. CONSENSUS_SEAT_ENV="NAME1,NAME2" passes extra names through.
 */
export declare function seatEnv(vendor: string, env?: NodeJS.ProcessEnv): {
    env: NodeJS.ProcessEnv;
    passed: string[];
    dropped: number;
};
/**
 * The isolation-relevant flags of a CLI invocation. `valueFlags` names the
 * flags whose value is prompt, schema, path or model (they differ per CLI:
 * `-p` is a bare switch for Claude Code but carries the prompt for Gemini),
 * and those values are left out of the receipt.
 */
export declare function receiptFlags(args: string[], valueFlags: string[]): string[];
/** Fold one call's receipt into a seat's running record. */
export declare function foldIsolation(prev: SeatIsolation | undefined, r: IsolationReceipt): SeatIsolation;
/** One line per seat for reports and the MCP summary. */
export declare function describeIsolation(id: string, s: SeatIsolation): string;
/** A one-line verdict for a whole run, or undefined when no receipts were recorded. */
export declare function isolationSummary(isolation?: Record<string, SeatIsolation>): string | undefined;
