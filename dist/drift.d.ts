import { z } from "zod";
import type { ConsensusRun, Effort, Panelist } from "./types.js";
import type { Config, ResolvedRun } from "./config.js";
import type { VendorStatus } from "./doctor.js";
export declare const ADR_MARKER = "consensus-adr";
/** What `consensus adr` records for a later recheck, in an HTML comment at the end of the record. */
export interface AdrMeta {
    v: 1;
    run: string;
    profile?: string;
    /** Seat specs (`provider:model#effort+persona`) as they sat on the panel. */
    panel: string[];
    rounds?: number;
    effort?: Effort;
    /** Whether the panel was given context beyond the question. The context itself stays out of the repo. */
    context: "none" | "given";
    /** The file the context was read from, when it came from `-c <file>`. */
    contextFile?: string;
}
/** A seat as a member spec that resolveRun can seat again. */
export declare function seatSpec(seat: ConsensusRun["seats"][number]): string;
/**
 * The context the user supplied. An escalated run's saved context also carries the
 * cheaper panel's draft; that draft is not part of the question and is cut off here.
 */
export declare function userContext(run: Pick<ConsensusRun, "context" | "escalation">): string | undefined;
export declare function adrMeta(run: ConsensusRun): AdrMeta;
/** The marker line: JSON in an HTML comment, invisible when rendered. `>` is escaped so the comment cannot close early. */
export declare function adrMarker(run: ConsensusRun): string;
export interface ParsedAdr {
    title: string;
    question: string;
    /** The decision as recorded. Rechecks compare against this, never against an earlier recheck. */
    decision: string;
    runId: string;
    panel: string[];
    meta?: AdrMeta;
    /** Rechecks already appended, oldest first. */
    rechecks: {
        date: string;
        verdict: string;
        run: string;
    }[];
}
/**
 * Read a record written by `consensus adr`. Returns undefined for anything else:
 * records written by hand or by another tool are not ours to recheck.
 */
export declare function parseAdr(text: string): ParsedAdr | undefined;
/** Markdown files in an ADR directory, in record order. */
export declare function listAdrFiles(dir: string): Promise<string[]>;
export declare const DriftVerdictSchema: z.ZodObject<{
    verdict: z.ZodEnum<{
        changed: "changed";
        refined: "refined";
        unchanged: "unchanged";
    }>;
    delta: z.ZodString;
}, z.core.$strip>;
export type DriftVerdict = z.infer<typeof DriftVerdictSchema>;
export declare function driftPrompt(question: string, decision: string, answer: string): string;
/** One judge call with a strict structured output. No repair round: a verdict that does not parse is an error, not a guess. */
export declare function judgeDrift(judge: Panelist, question: string, decision: string, answer: string, signal?: AbortSignal): Promise<DriftVerdict>;
/** The panel a record will be rechecked with, and in plain words why that one. */
export interface PanelChoice {
    resolved: ResolvedRun;
    /** e.g. `recorded profile "balanced"`, `recorded panel`, `active profile "fast"`. */
    source: string;
    /** Set when the recorded panel could not be seated and something else was used. */
    note?: string;
}
export interface RecheckDeps {
    /** Pick the panel for one record. Makes no model calls. */
    choosePanel(adr: ParsedAdr): Promise<PanelChoice>;
    /** Debate the question with that panel. */
    runPanel(resolved: ResolvedRun, prompt: string, context: string | undefined): Promise<ConsensusRun>;
    /** The saved run a record points at, if this machine still has it. */
    loadSavedRun(id: string): Promise<ConsensusRun | undefined>;
    /** Persist the new run so its id can be replayed. Returns where it went. */
    saveRun?(run: ConsensusRun): Promise<string | undefined>;
    readFile?(path: string): Promise<string>;
    now?(): Date;
    signal?: AbortSignal;
    onProgress?(message: string): void;
}
export type RecheckStatus = "unchanged" | "refined" | "changed" | "skipped" | "planned" | "error";
export interface RecheckResult {
    file: string;
    status: RecheckStatus;
    /** Why a record was skipped, or what went wrong. */
    reason?: string;
    title?: string;
    panel?: string[];
    panelSource?: string;
    panelNote?: string;
    /** How the original context was (or was not) recovered. */
    contextNote?: string;
    delta?: string;
    confidence?: string;
    runId?: string;
    runDir?: string;
    /** Seats that dropped out of the new run. */
    dropped?: string[];
}
/** Where the question and context come from, most faithful first. */
export declare function recoverInput(adr: ParsedAdr, deps: Pick<RecheckDeps, "loadSavedRun" | "readFile">): Promise<{
    prompt: string;
    context?: string;
    note?: string;
}>;
/** The dated section appended to a record. */
export declare function renderRecheck(r: {
    date: string;
    verdict: DriftVerdict;
    panel: string[];
    captain?: string;
    judge: string;
    panelSource: string;
    panelNote?: string;
    contextNote?: string;
    confidence: string;
    runId: string;
    /** Seats that dropped out of the new run, with why. */
    dropped?: Record<string, string>;
}): string;
/**
 * Recheck each record in turn. Records not written by `consensus adr` are
 * skipped; a failure on one record is reported and the rest still run.
 */
export declare function recheckAdrs(files: string[], o: {
    dryRun?: boolean;
    deps: RecheckDeps;
}): Promise<RecheckResult[]>;
/** 1 if any decision changed (a scheduled job can open an issue on it), 3 if any recheck failed, else 0. */
export declare function recheckExitCode(results: RecheckResult[]): number;
/**
 * The CLI's panel choice: --profile if given; else the profile the record names,
 * if it still exists; else the recorded seats; and when those no longer resolve,
 * the active profile (or whatever `consensus` would seat today), saying so.
 */
export declare function panelChooser(o: {
    cfg: Config;
    profile?: string;
    env: NodeJS.ProcessEnv;
    statuses: () => Promise<VendorStatus[]>;
}): (adr: ParsedAdr) => Promise<PanelChoice>;
/** One line per record for the terminal; the full verdict is in the record itself. */
export declare function describeRecheck(results: RecheckResult[], dryRun?: boolean): string;
/** The same record named twice (./a.md and a.md, or by name and again by --all) is rechecked once. */
export declare function uniquePaths(paths: string[]): string[];
export interface RecheckCliOptions {
    paths: string[];
    all?: boolean;
    dir: string;
    profile?: string;
    dryRun?: boolean;
    json?: boolean;
    maxCost?: number;
    quiet?: boolean;
}
/** `consensus adr --recheck`: wires the real panel, store and terminal. Returns the exit code. */
export declare function recheckCommand(o: RecheckCliOptions): Promise<number>;
