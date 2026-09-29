import type { ConsensusRun } from "./types.js";
export declare const DEFAULT_ADR_DIR = "docs/decisions";
/** A short kebab-case slug from the question. */
export declare function adrSlug(prompt: string): string;
/** A one-line title: the question itself, trimmed to something readable. */
export declare function adrTitle(prompt: string): string;
/** The next free number in an ADR directory (0001, 0002, ...). */
export declare function nextAdrNumber(dir: string): Promise<number>;
export interface AdrOptions {
    number: number;
    status?: string;
    /** Where the debate lives, for the reader who wants the argument. */
    runDir?: string;
    date?: string;
}
/** Render a run as an architecture decision record. */
export declare function renderAdr(run: ConsensusRun, o: AdrOptions): string;
