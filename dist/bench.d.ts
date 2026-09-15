import { z } from "zod";
import type { ConsensusEvent, Panelist, Usage } from "./types.js";
export declare const BenchCaseSchema: z.ZodObject<{
    id: z.ZodString;
    prompt: z.ZodString;
    context: z.ZodOptional<z.ZodString>;
    expected: z.ZodOptional<z.ZodString>;
    rubric: z.ZodOptional<z.ZodString>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export declare const BenchSuiteSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    cases: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        prompt: z.ZodString;
        context: z.ZodOptional<z.ZodString>;
        expected: z.ZodOptional<z.ZodString>;
        rubric: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type BenchCase = z.infer<typeof BenchCaseSchema>;
export type BenchSuite = z.infer<typeof BenchSuiteSchema>;
export declare const SAMPLE_SUITE: BenchSuite;
export interface BenchProfileTarget {
    name: string;
    panel: Panelist[];
    judge: Panelist;
    rounds: number;
    effort: "low" | "medium" | "high" | "max";
    /** Baseline arm: one model answering once, no debate. `panel`/`judge` are ignored. */
    single?: Panelist;
}
export interface CaseResult {
    profile: string;
    caseId: string;
    trial: number;
    ok: boolean;
    error?: string;
    ms: number;
    converged: boolean;
    rounds: number;
    usage: Usage;
    costUsd: number | null;
    unpriced: string[];
    dropped: string[];
    answer: string;
    accuracy: number | null;
    quality: number | null;
    notes?: string;
    runId?: string;
}
export interface ProfileSummary {
    profile: string;
    cases: number;
    failures: number;
    convergedRate: number;
    avgMs: number;
    totalIn: number;
    totalOut: number;
    totalCostUsd: number | null;
    avgAccuracy: number | null;
    avgQuality: number | null;
}
export interface BenchReport {
    startedAt: string;
    suite: string;
    grader: string;
    results: CaseResult[];
    summaries: ProfileSummary[];
    /** Profiles that share a model vendor with the grader (self-preference risk). */
    graderOverlap: string[];
}
export { estimateCost, priceFor } from "./cost.js";
export declare function gradePrompt(c: BenchCase, answers: {
    label: string;
    text: string;
}[]): string;
export declare function gradeCase(grader: Panelist, c: BenchCase, answers: {
    key: string;
    text: string;
}[]): Promise<Record<string, {
    accuracy: number | null;
    quality: number;
    notes: string;
}>>;
/** The "# Answer" section of a synthesis, without the confidence/agreement framing. */
export declare function answerSection(synthesis: string): string;
export interface BenchOptions {
    suite: BenchSuite;
    profiles: BenchProfileTarget[];
    grader: Panelist;
    /** Repeat every case this many times per profile and average (default 1). */
    trials?: number;
    /** Run profiles concurrently (each profile's cases stay sequential). */
    parallel?: boolean;
    outDir?: string;
    onEvent?: (e: {
        type: "case:start" | "case:done" | "grade:done";
        profile?: string;
        caseId: string;
        result?: CaseResult;
    }) => void;
    engineEvents?: (profile: string, caseId: string, e: ConsensusEvent) => void;
}
export declare function runBench(o: BenchOptions): Promise<BenchReport>;
export declare function summarize(profile: string, rs: CaseResult[]): ProfileSummary;
export declare function renderBench(r: BenchReport): string;
export declare function loadSuite(path: string): Promise<BenchSuite>;
