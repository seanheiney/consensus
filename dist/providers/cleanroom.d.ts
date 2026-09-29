/**
 * Verified clean rooms: raise a seat's isolation evidence from "we passed the
 * lockdown flags" to "the CLI itself reported what it loaded", and turn the
 * per-seat receipts into one run-level trust line a reader can check.
 *
 * Grok has no startup event listing its surface, but `grok inspect --json`
 * reports the configuration it discovers for a directory (instructions,
 * skills, plugins, MCP servers, hooks) without making a model call. Run once
 * per process in a sandbox built exactly like a seat's, it is observed
 * evidence for every grok seat that follows. See docs/isolation.md.
 */
import type { CleanRooms, IsolationReceipt, SeatIsolation } from "../types.js";
/** What `grok inspect --json` says a seat would load. */
export interface GrokSurface {
    version?: string;
    /** Agents.md / project-rule files, by path. */
    instructions: string[];
    /** Skill names; the ones grok ships inside its own install are suffixed "@bundled". */
    skills: string[];
    plugins: string[];
    mcpServers: string[];
    /** "<event> (<source>)", e.g. "PreToolUse (user)". */
    hooks: string[];
    /** Anything else inspect found that a sandbox should not have: user agents, LSP servers, remote settings. */
    other: string[];
}
/** How a grok receipt was observed; shown in reports and doctor --isolation. */
export declare const GROK_OBSERVED_VIA = "grok inspect --json in an identical sandbox";
/**
 * Parse `grok inspect --json` output. Returns undefined when the output is not
 * an inspect report (an older grok without the subcommand, an error, a fake),
 * so the caller keeps the weaker "configured" evidence instead of guessing.
 */
export declare function parseGrokInspect(stdout: string | unknown): GrokSurface | undefined;
/** Fold a parsed inspect report into a grok seat's receipt. */
export declare function observedGrokReceipt(base: IsolationReceipt, s: GrokSurface): IsolationReceipt;
/**
 * The run-level verdict: how many seats were observed clean, how many are
 * clean only by configuration, and which (if any) were observed not clean.
 */
export declare function cleanRooms(isolation?: Record<string, SeatIsolation>): CleanRooms | undefined;
/** Machine-readable output of `consensus doctor --isolation --json`: one entry per subscription seat checked. */
export interface IsolationCheck {
    id: string;
    ok: boolean;
    clean: boolean;
    receipt?: SeatIsolation;
    error?: string;
}
/** Turn doctor's live probes into checks; a probe that failed or returned no receipt could not be checked, so it fails. */
export declare function isolationChecks(results: {
    id: string;
    ok: boolean;
    error?: string;
    isolation?: IsolationReceipt;
}[]): IsolationCheck[];
export declare function isolationReport(checks: IsolationCheck[], withheld: string[]): {
    ok: boolean;
    seats: IsolationCheck[];
    cleanRooms?: CleanRooms;
    unchecked: string[];
    withheld: string[];
};
