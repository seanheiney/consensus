/** Shared types for the consensus engine. */

export type Effort = "low" | "medium" | "high" | "max";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  system: string;
  messages: ChatMessage[];
  /** Hint that the response must be a single JSON object. */
  json?: boolean;
  maxTokens?: number;
  effort?: Effort;
  signal?: AbortSignal;
  /** Which step of the protocol this call serves. */
  phase?: "propose" | "critique" | "revise" | "synthesize" | "grade" | "probe";
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Prompt-cache reads (billed at roughly a tenth of input). */
  cacheReadTokens?: number;
  /** Cost as reported by the provider itself, when it reports one (Claude Code does). */
  costUsd?: number;
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
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export interface Seat {
  id: string;
  label: string;
  provider: string;
  model: string;
  effort?: Effort;
  persona?: string;
}

export interface Dispute {
  claim: string;
  problem: string;
  correction: string;
  severity: "minor" | "major";
}

export interface Review {
  answer: string; // label of the answer reviewed, e.g. "B"
  verdict: "agree" | "disagree";
  strengths: string[];
  disputes: Dispute[];
}

export interface Critique {
  self_review: { errors: string[]; gaps: string[] };
  reviews: Review[];
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
  label: string; // anonymized label, "A".."Z"
  answer: string;
  reasoning?: string;
  usage: Usage;
  active: boolean;
  error?: string;
}

export interface RoundRecord {
  round: number;
  critiques: Record<string, Critique>; // keyed by label
  converged: boolean;
  revisions?: Record<string, Revision>; // keyed by label
}

export interface ConsensusRun {
  id: string;
  startedAt: string;
  finishedAt?: string;
  prompt: string;
  context?: string;
  /** Run-level settings. Per-seat effort lives in `seats`. */
  options: { rounds: number; defaultEffort: Effort; maxCostUsd?: number };
  labels: Record<string, string>; // label -> panelist id
  /** What actually sat on the panel: model, effort and persona per seat. */
  seats: Seat[];
  proposals: Record<string, string>; // label -> initial answer
  rounds: RoundRecord[];
  finalAnswers: Record<string, string>; // label -> answer at end
  converged: boolean;
  judge: string; // panelist id
  synthesis: string;
  usage: Record<string, Usage>; // panelist id -> usage
  dropped: Record<string, string>; // panelist id -> error
}

export type ConsensusEvent =
  | { type: "start"; runId: string; labels: Record<string, string>; prompt: string; context?: string; rounds: number; effort: Effort }
  | { type: "phase"; phase: "propose" | "critique" | "revise" | "synthesize"; round?: number }
  | { type: "proposal"; label: string; panelist: string; text: string; reasoning?: string }
  | { type: "critique"; label: string; panelist: string; round: number; critique: Critique }
  | { type: "revision"; label: string; panelist: string; round: number; revision: Revision }
  | { type: "synthesis"; panelist: string; text: string }
  | { type: "panelist:start"; label: string; panelist: string; phase: string }
  | { type: "panelist:done"; label: string; panelist: string; phase: string; ms: number; usage?: Usage }
  | { type: "panelist:error"; label: string; panelist: string; phase: string; error: string; dropped: boolean }
  | { type: "served-by"; label: string; panelist: string; model: string; phase: string }
  | { type: "converged"; round: number }
  | { type: "not-converged"; round: number; openDisputes: number }
  | { type: "done"; run: ConsensusRun };

export interface ConsensusOptions {
  panel: Panelist[];
  /** Panelist that writes the final synthesis. Defaults to panel[0]. */
  judge?: Panelist;
  /** Maximum critique/revise rounds. Default 3. */
  rounds?: number;
  effort?: Effort;
  maxTokens?: number;
  /** Abort the run once the estimated list-price spend exceeds this (unpriced seats excluded). */
  maxCostUsd?: number;
  /** Retry a seat once on a transient failure (rate limit, overload, timeout). Default true. */
  retry?: boolean;
  onEvent?: (e: ConsensusEvent) => void;
  signal?: AbortSignal;
}
