/**
 * Escalation: answer with a cheap, fast panel first and promote to a stronger
 * one only when the first pass leaves something unsettled.
 *
 * Opt-in. Nothing escalates unless `--escalate <profile>` (CLI), `escalate_to`
 * (MCP) or `escalateTo` (config / profile) asks for it, and the first-pass
 * panel is whatever you already chose: escalation never downgrades a run.
 */
import type { ConsensusRun } from "./types.js";
import type { ResolvedRun } from "./config.js";
/** When a first pass is considered unsettled enough to promote. */
export type EscalateWhen = "unsettled" | "disputed" | "always";
export interface EscalationDecision {
    escalate: boolean;
    reason: string;
}
/** The judge's own confidence word, when the report states one. */
export declare function statedConfidence(synthesis: string): "low" | "medium" | "high" | undefined;
/** Disputes still open in the last round: what the panel argued about and never settled. */
export declare function openDisputes(run: ConsensusRun): string[];
/** Should this first pass be promoted to the stronger panel? */
export declare function shouldEscalate(run: ConsensusRun, when?: EscalateWhen): EscalationDecision;
/** What the strong panel is told about the first pass. A draft to check, never an authority. */
export declare function escalationContext(run: ConsensusRun, context?: string): string;
export interface EscalationOptions {
    /** The panel that answers first (the one already resolved from flags/profile). */
    first: ResolvedRun;
    /** Builds the stronger panel, only called if the first pass is unsettled. */
    resolveTarget: () => Promise<ResolvedRun>;
    when?: EscalateWhen;
    prompt: string;
    context?: string;
    /** Runs one debate. `tier` is 1 for the first pass, 2 for the promoted one. */
    runOnce: (resolved: ResolvedRun, prompt: string, context: string | undefined, tier: 1 | 2) => Promise<ConsensusRun>;
    /** Called after the first pass with the decision, before any promotion. */
    onDecision?: (decision: EscalationDecision, first: ConsensusRun) => void;
    /** Called with the first-pass run once it is final, so callers can persist it. */
    onFirstPass?: (run: ConsensusRun) => Promise<void> | void;
}
/**
 * Run the cheap panel, then the strong one only if needed. The returned run is
 * whichever answered last; when it escalated it carries `escalation`.
 */
export declare function runWithEscalation(o: EscalationOptions): Promise<ConsensusRun>;
