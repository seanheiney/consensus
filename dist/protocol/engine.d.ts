import type { ConsensusOptions, ConsensusRun, Panelist } from "../types.js";
import { type ZodType } from "zod";
/** Strip zod's `default` annotations and close objects so the schema is acceptable to strict structured-output APIs. */
export declare function toStrictJsonSchema(schema: ZodType): Record<string, unknown>;
export declare class ConsensusEngine {
    private readonly opts;
    private readonly emit;
    constructor(opts: ConsensusOptions);
    /**
     * Run a debate. Seat failures are per seat: a failed turn (after one retry on transient errors) drops that seat,
     * every other seat's turn in the phase still completes and is recorded, and the debate continues while two seats
     * remain. If the run cannot continue (quorum lost, spend ceiling, abort), the error carries `partial`: the run
     * record up to that point (proposals, completed rounds, usage, dropped seats) so callers can persist it.
     */
    run(prompt: string, context?: string): Promise<ConsensusRun>;
    private liveStates?;
    private runInner;
    private rnd;
    /** Same answers, shuffled order, labels intact. */
    private reorder;
    private active;
    private answers;
    private requireQuorum;
    /** For a follow-up critique: what `label` disputed last round in each other answer, and that author's responses to it. */
    private priorFor;
    /** All panelists agreed with every other live answer. */
    private isConverged;
    /** Run `fn` for every active panelist concurrently; a failure (after one retry on transient errors) drops that panelist. */
    private forEachActive;
    private checkCost;
    private current?;
    private call;
    /** Call a non-seat panelist (the captain) and account its usage under its own id. */
    private captainState?;
    private callJsonWith;
    private retiredUsage;
    private completeFor;
    private callWith;
    /** Call, parse JSON, validate; on failure ask the model once to repair. */
    private callJson;
}
export declare function runConsensus(prompt: string, opts: ConsensusOptions & {
    context?: string;
}): Promise<ConsensusRun>;
export type { Panelist };
