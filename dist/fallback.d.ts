import type { Panelist } from "./types.js";
/**
 * A panelist that hands off to the next candidate when the current one fails for a
 * non-recoverable reason (usage limit reached, model unavailable, auth). The switch is
 * permanent for the rest of the run, and `id`/`model`/`billing` follow the model that is
 * actually answering so usage and cost are attributed correctly. Aborts are never retried.
 */
export declare function withFallbacks(candidates: Panelist[], onSwitch?: (from: Panelist, to: Panelist, error: string) => void): Panelist;
