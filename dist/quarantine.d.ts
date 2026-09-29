export interface UntrustedDoc {
    /** Display name (file basename); used as the location prefix seats cite. */
    name: string;
    content: string;
}
/** One instruction-like passage a seat noticed inside the untrusted material. */
export interface InjectionReport {
    quote: string;
    location: string;
    note?: string;
}
/** Merged across seats. */
export interface InjectionFinding {
    quote: string;
    location: string;
    note?: string;
    /** Labels of the seats that flagged it. */
    flaggedBy: string[];
    /** Labels of the seats that reported a list but did not flag it. */
    notFlaggedBy: string[];
    /** "agreed": every reporting seat flagged it. "unresolved": only some did. */
    status: "agreed" | "unresolved";
    /** Whether the quote occurs in the untrusted material (whitespace-insensitive); false suggests a paraphrase or an invented quote. */
    inSource: boolean;
}
/** What run.json records about a quarantined run. */
export interface QuarantineRecord {
    nonce: string;
    canary: string;
    docs: {
        name: string;
        bytes: number;
        sha256: string;
        escapedMarkers: number;
    }[];
    /** Per seat label: the injection list it reported, or null when it never included one. */
    reports: Record<string, InjectionReport[] | null>;
    findings: InjectionFinding[];
    /** Where the canary showed up. Compromised seats are dropped and excluded from synthesis. */
    compromised: {
        id: string;
        role: "seat" | "captain" | "judge";
        label?: string;
        phase: string;
    }[];
}
/** Thrown when an output contains the canary; never retried. */
export declare class CompromisedError extends Error {
    readonly phase: string;
    constructor(phase: string);
}
export declare class Quarantine {
    readonly nonce: string;
    readonly canary: string;
    readonly docs: UntrustedDoc[];
    readonly escaped: number[];
    constructor(docs: UntrustedDoc[], opts?: {
        nonce?: string;
        canary?: string;
    });
    get open(): string;
    get close(): string;
    /** Short rule appended to every system prompt in the run. */
    systemRule(): string;
    /** The quarantined section appended after the user's question. */
    block(): string;
    /** The question as the panel sees it: the user's prompt followed by the quarantined section. */
    frame(prompt: string): string;
    /** Deterministic material for the run key (content, not nonce or canary), so --reuse still matches. */
    keyContext(context: string | undefined): string;
    /** True when `text` contains the canary. Case-insensitive and ignores separators so trivial re-spellings still trip. */
    leaked(text: string): boolean;
    record(): QuarantineRecord;
}
/**
 * Neutralize delimiter spoofing: anything shaped like our open/close markers,
 * plus any literal occurrence of the run's nonce or canary, is rewritten so it
 * can no longer be mistaken for (or close) the real quarantine.
 */
export declare function escapeUntrusted(text: string, secrets?: string[]): {
    text: string;
    count: number;
};
export declare function loadUntrusted(paths: string[]): Promise<UntrustedDoc[]>;
/**
 * Pull the `injections` block(s) out of an answer. Returns the answer with the
 * blocks removed and the parsed list (null when the seat included no parsable block).
 */
export declare function extractInjections(answer: string): {
    answer: string;
    reports: InjectionReport[] | null;
};
/** Union of two report lists, dropping repeats of the same quote. */
export declare function unionReports(a: InjectionReport[] | null | undefined, b: InjectionReport[] | null): InjectionReport[] | null;
/**
 * Merge per-seat lists into findings. Two quotes are the same finding when one
 * contains the other (seats excerpt different lengths). A seat that reported
 * a list but did not flag a finding counts as disagreeing, which makes it
 * unresolved; a seat that reported nothing at all is not counted either way.
 */
export declare function mergeInjections(reports: Record<string, InjectionReport[] | null>, docs?: UntrustedDoc[]): InjectionFinding[];
/**
 * Appended to the synthesis prompt so the judge accounts for the merged list.
 * The quotes are the attacker's text, so the list sits inside the run's delimiters like the material itself.
 */
export declare function injectionsForJudge(findings: InjectionFinding[], q: Quarantine): string;
/** The report's "Injection attempts observed" section. */
export declare function renderQuarantine(q: QuarantineRecord, labels: Record<string, string>): string[];
