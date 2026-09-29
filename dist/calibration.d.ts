import type { ConsensusRun } from "./types.js";
export declare const OUTCOMES: readonly ["right", "wrong", "partial"];
export type Outcome = (typeof OUTCOMES)[number];
/** Score per outcome: partial counts as half right. */
export declare const OUTCOME_SCORE: Record<Outcome, number>;
/** Below this many outcomes a bucket's accuracy is noise. */
export declare const MIN_N = 5;
export declare const OUTCOME_FILE = "outcome.json";
export interface OutcomeEntry {
    outcome: Outcome;
    note?: string;
    recordedAt: string;
}
/** outcome.json: the current verdict on top, every verdict ever recorded (oldest first) in `history`. */
export interface OutcomeRecord extends OutcomeEntry {
    runId: string;
    history: OutcomeEntry[];
}
export declare function parseOutcome(v: string): Outcome;
/**
 * The recorded outcome of a run directory, if one was recorded. The file
 * travels with the run and may be written by hand, so a record without a usable
 * verdict counts as none, and a missing history is rebuilt from the verdict.
 */
export declare function readOutcome(runDir: string): Promise<OutcomeRecord | undefined>;
/**
 * Record what happened for a saved run. Re-recording replaces the current
 * verdict and appends to the history, so a change of mind stays visible.
 */
export declare function recordOutcome(id: string | undefined, outcome: Outcome, o?: {
    note?: string;
    dir?: string;
    now?: Date;
}): Promise<{
    record: OutcomeRecord;
    previous?: OutcomeEntry;
    file: string;
    run: ConsensusRun;
}>;
/**
 * The profile a finished run is filed under for calibration: the escalation
 * target when the run was promoted to it, otherwise the profile it was resolved from.
 */
export declare function runProfile(run: ConsensusRun, resolved: string | undefined, escalateTo?: string): string | undefined;
/** One run with a recorded outcome, reduced to what calibration buckets on. */
export interface CalibrationRow {
    runId: string;
    when: string;
    outcome: Outcome;
    confidence: "high" | "medium" | "low" | "unstated";
    converged: boolean;
    openDisputes: number;
    /** The profile the run used when it recorded one, else its seat list. */
    panel: string;
    profile?: string;
}
export declare function rowFor(run: ConsensusRun, outcome: OutcomeRecord): CalibrationRow;
/** Every saved run with a recorded outcome, optionally narrowed to a profile and a recent window. */
export declare function collectOutcomes(dir?: string, o?: {
    profile?: string;
    sinceDays?: number;
    now?: Date;
}): Promise<CalibrationRow[]>;
export interface Bucket {
    label: string;
    n: number;
    right: number;
    partial: number;
    wrong: number;
    /** Mean score (partial = 0.5), 0..1; null when the bucket is empty. */
    accuracy: number | null;
    /** True when n is below MIN_N and the accuracy should not be read as a rate. */
    thin: boolean;
}
export interface CalibrationReport {
    total: Bucket;
    byConfidence: Bucket[];
    byConvergence: Bucket[];
    byDisputes: Bucket[];
    byPanel: Bucket[];
}
export declare function bucket(label: string, rows: CalibrationRow[]): Bucket;
export declare function calibrate(rows: CalibrationRow[]): CalibrationReport;
export declare function renderCalibration(r: CalibrationReport, o?: {
    profile?: string;
    sinceDays?: number;
}): string;
