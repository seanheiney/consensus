import type { ConsensusRun } from "./types.js";
/** Render a run as a self-contained markdown report. */
export declare function renderReport(run: ConsensusRun, opts?: {
    transcript?: boolean;
}): string;
/** Full debate transcript: proposals, each round's critiques and revisions. */
export declare function renderTranscript(run: ConsensusRun): string;
