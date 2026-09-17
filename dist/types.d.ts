/** Shared types for the consensus engine. */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
/** Thrown by providers for failures worth one retry (rate limit, overload, network, timeout). */
export declare class TransientError extends Error {
    readonly cause?: unknown;
    constructor(message: string, cause?: unknown);
}
export interface ChatMessage {
    role: "user" | "assistant";
    content: string;
    /** A leading slice of `content` that is identical across phases (problem + context); providers may cache it. */
    cachedPrefix?: string;
}
export interface CompletionRequest {
    system: string;
    messages: ChatMessage[];
    /** Hint that the response must be a single JSON object. */
    json?: boolean;
    /** JSON Schema the response must satisfy; providers that support structured outputs enforce it. */
    jsonSchema?: Record<string, unknown>;
    maxTokens?: number;
    effort?: Effort;
    signal?: AbortSignal;
    /** Which step of the protocol this call serves. */
    phase?: "propose" | "critique" | "revise" | "moderate" | "synthesize" | "grade" | "probe";
}
export interface Usage {
    inputTokens: number;
    outputTokens: number;
    /** Prompt-cache reads (billed at roughly a tenth of input). */
    cacheReadTokens?: number;
    /** Cost as reported by the provider itself, when it reports one (Claude Code does). */
    costUsd?: number;
    /** Internal: set once any real usage was recorded for this seat. */
    reported?: boolean;
    /** Billed per token (API key) or subscription quota. Set by the engine from the seat. */
    billing?: "api" | "subscription";
}
export interface CompletionResult {
    text: string;
    usage?: Usage;
    /** A summary of the model's reasoning when the provider exposes one. */
    reasoning?: string;
    /** Model that actually served the call when it differs from the one asked for (refusal fallback). */
    servedBy?: string;
}
/** A model that can sit on the panel. Implemented per provider. */
export interface Panelist {
    /** Stable identifier, e.g. "anthropic:claude-fable-5-1" or "claude:claude-opus-5+skeptic". */
    id: string;
    provider: string;
    model: string;
    /** Reasoning effort this seat runs at (undefined = provider default). */
    effort?: Effort;
    /** Persona name when this seat carries a preprompt. */
    persona?: string;
    /** How this seat is paid for. CLI seats are subscription unless the vendor's API key is in the shell. */
    billing?: "api" | "subscription";
    /** The provider's mapping of an effort level to what it actually sends. */
    effortApplied?(effort: Effort): string;
    complete(req: CompletionRequest): Promise<CompletionResult>;
}
export interface Seat {
    id: string;
    label: string;
    provider: string;
    model: string;
    effort?: Effort;
    /** What the provider actually sent for that effort ("high", "xhigh", or "ignored" for routes with no effort knob). */
    effortApplied?: string;
    persona?: string;
    /** Whether this seat's usage is billed per token (API key) or consumes subscription quota. */
    billing?: "api" | "subscription";
}
export interface Dispute {
    claim: string;
    problem: string;
    correction: string;
    severity: "minor" | "major";
}
export interface Review {
    answer: string;
    verdict: "agree" | "disagree";
    strengths: string[];
    disputes: Dispute[];
}
export interface Critique {
    self_review: {
        errors: string[];
        gaps: string[];
    };
    reviews: Review[];
}
/** The captain's brief after a critique round: what is settled, what must be answered, rulings on disputes it can settle. */
export interface Moderation {
    settled: string[];
    key_disputes: {
        topic: string;
        positions: string;
        ruling?: string;
        ask: string;
    }[];
    guidance: string;
    /** Direct questions the captain puts to specific seats to move a stuck dispute. */
    questions_for_seats?: {
        seat: string;
        question: string;
    }[];
    /** The captain may ask for one extra round beyond the profile's maximum when the debate is productive but unresolved. */
    request_extra_round?: boolean;
    /** After round 1: the remaining disputes will not move, so skip further revision and write the report. */
    stop_debate?: boolean;
}
export interface Revision {
    responses: {
        from: string;
        claim: string;
        action: "concede" | "rebut" | "partial";
        reason: string;
    }[];
    position_changed: boolean;
    answer: string;
}
export interface PanelistState {
    panelist: Panelist;
    label: string;
    answer: string;
    reasoning?: string;
    usage: Usage;
    active: boolean;
    error?: string;
}
export interface RoundRecord {
    round: number;
    critiques: Record<string, Critique>;
    converged: boolean;
    /** Captain's brief that drove the revision (absent without a captain or when converged). */
    moderation?: Moderation;
    revisions?: Record<string, Revision>;
}
export interface ConsensusRun {
    /** Bump when the shape of this record changes. */
    schemaVersion: 1;
    id: string;
    startedAt: string;
    finishedAt?: string;
    prompt: string;
    context?: string;
    /** Run-level settings. Per-seat effort lives in `seats`. */
    options: {
        rounds: number;
        defaultEffort: Effort;
        maxCostUsd?: number;
        maxSpendUsd?: number;
        seed?: number;
    };
    labels: Record<string, string>;
    /** What actually sat on the panel: model, effort and persona per seat. */
    seats: Seat[];
    proposals: Record<string, string>;
    rounds: RoundRecord[];
    finalAnswers: Record<string, string>;
    converged: boolean;
    judge: string;
    /** The captain (moderator, referee, reporter) when one ran; it is also the judge unless a separate judge was named. */
    captain?: string;
    synthesis: string;
    usage: Record<string, Usage>;
    /** Cost summary computed at the end of the run (billed vs subscription-equivalent). */
    cost?: {
        billedUsd: number | null;
        subscriptionEquivUsd: number | null;
        unpriced: string[];
        summary: string;
    };
    dropped: Record<string, string>;
}
export type ConsensusEvent = {
    type: "start";
    runId: string;
    labels: Record<string, string>;
    seats?: Seat[];
    prompt: string;
    context?: string;
    rounds: number;
    effort: Effort;
} | {
    type: "phase";
    phase: "propose" | "critique" | "revise" | "synthesize";
    round?: number;
} | {
    type: "proposal";
    label: string;
    panelist: string;
    text: string;
    reasoning?: string;
} | {
    type: "critique";
    label: string;
    panelist: string;
    round: number;
    critique: Critique;
} | {
    type: "revision";
    label: string;
    panelist: string;
    round: number;
    revision: Revision;
} | {
    type: "synthesis";
    panelist: string;
    text: string;
} | {
    type: "moderation";
    panelist: string;
    round: number;
    moderation: Moderation;
} | {
    type: "extra-round";
    panelist: string;
    round: number;
} | {
    type: "stalemate";
    panelist: string;
    round: number;
} | {
    type: "handoff";
    label: string;
    from: string;
    to: string;
    phase: string;
    error: string;
} | {
    type: "panelist:start";
    label: string;
    panelist: string;
    phase: string;
} | {
    type: "panelist:done";
    label: string;
    panelist: string;
    phase: string;
    ms: number;
    usage?: Usage;
} | {
    type: "panelist:error";
    label: string;
    panelist: string;
    phase: string;
    error: string;
    dropped: boolean;
} | {
    type: "served-by";
    label: string;
    panelist: string;
    model: string;
    phase: string;
} | {
    type: "converged";
    round: number;
} | {
    type: "not-converged";
    round: number;
    openDisputes: number;
} | {
    type: "done";
    run: ConsensusRun;
};
export interface ConsensusOptions {
    panel: Panelist[];
    /** Panelist that writes the final synthesis. Defaults to the captain, else panel[0]. */
    judge?: Panelist;
    /** Captain: moderates after each critique round (brief + referee rulings) and, unless a judge is given, writes the synthesis. */
    captain?: Panelist;
    /** Maximum critique/revise rounds. Default 3. */
    rounds?: number;
    effort?: Effort;
    maxTokens?: number;
    /** Abort once spend billed to API keys exceeds this (subscription seats are quota and are not counted). */
    maxCostUsd?: number;
    /** Abort once billed spend plus the list-price equivalent of subscription seats exceeds this. */
    maxSpendUsd?: number;
    /** Retry a seat once on a transient failure (rate limit, overload, timeout). Default true. */
    retry?: boolean;
    /** Seed for label assignment and answer ordering; recorded in run.json so a run's shuffles are reproducible. */
    seed?: number;
    onEvent?: (e: ConsensusEvent) => void;
    signal?: AbortSignal;
}
