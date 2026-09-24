import type { ConsensusRun } from "./types.js";
/** Persist a run as JSON + markdown under `<dir>/<run id>/`. Returns the run directory. */
export declare function saveRun(run: ConsensusRun, dir?: string): Promise<string>;
export interface RunSummary {
    id: string;
    dir: string;
    startedAt: string;
    prompt: string;
    converged: boolean;
    rounds: number;
    panel: string[];
}
/** Saved runs, newest first. */
export declare function listRuns(dir?: string): Promise<RunSummary[]>;
/**
 * The newest saved run that answered this exact question with this exact panel,
 * within `maxAgeDays`. Used by `--reuse`; never consulted unless asked.
 */
export declare function findReusableRun(key: string, maxAgeDays: number, dir?: string): Promise<{
    run: ConsensusRun;
    dir: string;
    ageDays: number;
} | undefined>;
/** Load one run by id, or the latest when id is "latest" / omitted. */
export declare function loadRun(id: string | undefined, dir?: string): Promise<{
    run: ConsensusRun;
    dir: string;
}>;
/** Very small markdown-to-HTML for a self-contained shareable debate page (no external assets). */
export declare function markdownToHtml(md: string): string;
export declare function renderRunHtml(run: ConsensusRun): string;
