/**
 * `consensus check`: disagreement as a cheap uncertainty signal.
 *
 * Every seat answers once, independently and in parallel, with a short final
 * answer and a one-line rationale. One cheap comparison step (the captain or
 * judge when there is one, plain normalized comparison otherwise) groups the
 * answers into positions. No critique, no revision, no synthesis: the output is
 * how much the models agree and whether a human should look.
 *
 * Exit codes (see checkExitCode): 0 unanimous, 1 not unanimous (a human should
 * look), 2 no signal (fewer than two seats answered, or the check failed).
 */
import { z } from "zod";
import type { Effort, Panelist, Usage } from "./types.js";
export declare const CheckAnswerSchema: z.ZodObject<{
    answer: z.ZodString;
    rationale: z.ZodString;
}, z.core.$strip>;
export declare const CheckGroupingSchema: z.ZodObject<{
    positions: z.ZodArray<z.ZodObject<{
        answer: z.ZodString;
        members: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type Agreement = "unanimous" | "majority" | "split" | "insufficient";
export interface CheckSeatAnswer {
    seat: string;
    answer: string;
    rationale: string;
}
export interface CheckPosition {
    /** The position in a few words (the comparer's wording, or the first seat's answer under plain comparison). */
    answer: string;
    /** Seat ids holding it. */
    seats: string[];
}
export interface CheckResult {
    kind: "check";
    schemaVersion: 1;
    startedAt: string;
    finishedAt: string;
    prompt: string;
    context?: string;
    /** Every seat asked, answered or not. */
    seats: string[];
    answers: CheckSeatAnswer[];
    /** Seats that failed: seat id -> error. Never counted towards any position. */
    dropped: Record<string, string>;
    /** Largest first. */
    positions: CheckPosition[];
    agreement: Agreement;
    needsHuman: boolean;
    /** "plain" for normalized string comparison, else the id of the model that grouped the answers. */
    comparedBy: string;
    /** Why the comparison fell back to plain, when it did. */
    comparisonNote?: string;
    usage: Record<string, Usage>;
    cost: {
        billedUsd: number | null;
        subscriptionEquivUsd: number | null;
        unpriced: string[];
        summary: string;
    };
}
export type CheckEvent = {
    type: "seat:done";
    seat: string;
    ms: number;
} | {
    type: "seat:error";
    seat: string;
    error: string;
} | {
    type: "compare";
    by: string;
};
export interface CheckOptions {
    panel: Panelist[];
    /** Model that groups the answers (the captain, else the judge). Omit for plain comparison only. */
    comparer?: Panelist;
    /** "auto" (default): plain comparison first, the comparer only when plain comparison does not find one position. "plain": never call a model to compare. */
    compare?: "auto" | "plain";
    effort?: Effort;
    maxTokens?: number;
    /** Skip the comparer call once spend billed to API keys exceeds this. */
    maxCostUsd?: number;
    /** Retry a seat once on a transient failure. Default true. */
    retry?: boolean;
    /** Wait before that retry (tests set 0). */
    retryDelayMs?: number;
    onEvent?: (e: CheckEvent) => void;
    signal?: AbortSignal;
}
export declare function checkPrompt(prompt: string, context?: string): string;
export declare function comparePrompt(prompt: string, answers: {
    label: string;
    answer: string;
    rationale: string;
}[]): string;
/** Lowercase, strip accents, punctuation, articles and filler so trivially different spellings compare equal. */
export declare function normalizeAnswer(text: string): string;
/** Short enough that exact comparison after normalization is meaningful (a word, a number, a choice). */
export declare function isCategorical(answers: string[]): boolean;
/** Group by normalized text. Order: largest first, ties in the order seats answered. */
export declare function groupPlain(answers: CheckSeatAnswer[]): CheckPosition[];
/** unanimous: one position. majority: the largest holds more than half the seats that answered. split: otherwise. */
export declare function agreementOf(positions: CheckPosition[], answered: number): Agreement;
/** 0 unanimous; 1 majority or split (a human should look); 2 no signal (fewer than two seats answered). */
export declare function checkExitCode(r: Pick<CheckResult, "agreement">): 0 | 1 | 2;
/** Ask every seat once, compare, and report agreement. Seat failures drop that seat; they never count as a position. */
export declare function runCheck(prompt: string, context: string | undefined, o: CheckOptions): Promise<CheckResult>;
/** Plain-text report: agreement, verdict, positions with their seats and rationales, dropped seats. */
export declare function renderCheck(r: CheckResult): string;
