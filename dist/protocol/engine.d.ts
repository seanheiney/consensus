import type { ConsensusOptions, ConsensusRun, Panelist } from "../types.js";
import { type ZodType } from "zod";
/** Strip zod's `default` annotations and close objects so the schema is acceptable to strict structured-output APIs. */
export declare function toStrictJsonSchema(schema: ZodType): Record<string, unknown>;
export declare class ConsensusEngine {
    private readonly opts;
    private readonly emit;
    constructor(opts: ConsensusOptions);
    run(prompt: string, context?: string): Promise<ConsensusRun>;
    private rnd;
    /** Same answers, shuffled order, labels intact. */
    private reorder;
    private active;
    private answers;
    private requireQuorum;
    /** All panelists agreed with every other live answer. */
    private isConverged;
    /** Run `fn` for every active panelist concurrently; a failure (after one retry on transient errors) drops that panelist. */
    private forEachActive;
    private checkCost;
    private current?;
    private call;
    /** Call, parse JSON, validate; on failure ask the model once to repair. */
    private callJson;
}
export declare function runConsensus(prompt: string, opts: ConsensusOptions & {
    context?: string;
}): Promise<ConsensusRun>;
export type { Panelist };
