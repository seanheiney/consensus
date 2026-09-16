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
    captain?: Panelist;
    rounds: number;
    effort: import("./types.js").Effort;
    /** Baseline arm: one model answering once, no debate. `panel`/`judge` are ignored. */
    single?: Panelist;
    /** Self-consistency arm: `single` answers `samples` times independently, then picks/merges its best answer itself (more tokens, no debate). */
    samples?: number;
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
    subscriptionUsd?: number | null;
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
    /** Sample standard deviation of quality / accuracy across graded runs. */
    qualitySd: number | null;
    accuracySd: number | null;
    convergedRate: number;
    avgMs: number;
    totalIn: number;
    totalOut: number;
    totalCostUsd: number | null;
    /** List-price equivalent consumed by subscription seats (quota, not billed). */
    totalSubscriptionUsd: number | null;
    avgAccuracy: number | null;
    avgQuality: number | null;
}
export interface BenchReport {
    startedAt: string;
    suite: string;
    grader: string;
    seed?: number;
    results: CaseResult[];
    summaries: ProfileSummary[];
    /** Profiles that share a model vendor with the grader (self-preference risk). */
    graderOverlap: string[];
}
export { estimateCost, priceFor } from "./cost.js";
/**
 * Grading is two-phase so the reference answer cannot leak into the subjective
 * score: phase "quality" never sees the reference; phase "accuracy" does.
 */
export declare function gradePrompt(c: BenchCase, answers: {
    label: string;
    text: string;
}[], phase?: "quality" | "accuracy"): string;
export declare function gradeCase(grader: Panelist, c: BenchCase, answers: {
    key: string;
    text: string;
}[], rnd?: () => number): Promise<Record<string, {
    accuracy: number | null;
    quality: number | null;
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
    /** Seed for grader shuffles (recorded in the report). */
    seed?: number;
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
/** Grade every case across arms in blind calls; mutates `results`. Exposed so a saved bench can be re-graded by another model. */
export declare function gradeAll(suite: BenchSuite, results: CaseResult[], grader: Panelist, seed: number, onEvent?: BenchOptions["onEvent"]): Promise<void>;
/** Re-grade a saved bench (results.json) with another grader without re-running any arm. */
export declare function regradeBench(report: BenchReport, suite: BenchSuite, grader: Panelist, seed?: number): Promise<BenchReport>;
export declare function summarize(profile: string, rs: CaseResult[]): ProfileSummary;
export declare function renderBench(r: BenchReport): string;
export declare function loadSuite(path: string): Promise<BenchSuite>;
