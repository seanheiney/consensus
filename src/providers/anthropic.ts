import Anthropic from "@anthropic-ai/sdk";
import { TransientError, type CompletionRequest, type CompletionResult, type Effort, type Panelist } from "../types.js";
import type { ProviderFactoryOptions } from "./types.js";

const EFFORT: Record<Effort, "low" | "medium" | "high" | "xhigh" | "max"> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

function isTransient(err: unknown): boolean {
  return (
    err instanceof Anthropic.RateLimitError ||
    err instanceof Anthropic.InternalServerError ||
    err instanceof Anthropic.APIConnectionError ||
    (err instanceof Anthropic.APIError && (err.status === 529 || err.status === 503 || err.status === 408))
  );
}

/** Models that support server-side refusal fallbacks. */
function supportsFallbacks(model: string): boolean {
  return /^claude-(fable|opus-5|mythos)/.test(model);
}

/**
 * Adaptive thinking + output_config.effort exist on Claude 4.6 and later. Only the known
 * pre-4.6 models (Haiku 4.5, Sonnet 4.5, Opus 4.5, 4.1, 3.x) need budget_tokens; anything
 * unrecognised is assumed newer, so a model released after this code still gets the current API.
 */
function supportsAdaptive(model: string): boolean {
  return !/^claude-(haiku-4-5|sonnet-4-5|opus-4-5|opus-4-1|sonnet-4-1|3-|.*-3-)/.test(model);
}

export function createAnthropicPanelist(opts: ProviderFactoryOptions & { client?: Anthropic }): Panelist {
  const client = opts.client ?? new Anthropic({ apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "missing" });
  const model = opts.model;

  return {
    id: `anthropic:${model}`,
    provider: "anthropic",
    model,
    effort: opts.effort,
    billing: "api",
    effortApplied: (e) => (supportsAdaptive(model) ? EFFORT[e] : "ignored"),
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const effort = EFFORT[opts.effort ?? req.effort ?? "high"];
      const fallbacks = supportsFallbacks(model);
      const adaptive = supportsAdaptive(model);
      const maxTokens = req.maxTokens ?? 32000;
      const build = (structured: boolean): Anthropic.Beta.MessageCreateParamsStreaming => ({
        model,
        max_tokens: maxTokens,
        system: req.system,
        // The problem + context prefix is identical across every phase and seat of a run: that is the block worth caching.
        messages: req.messages.map((m) =>
          m.role === "user" && m.cachedPrefix && m.content.startsWith(m.cachedPrefix)
            ? { role: m.role, content: [{ type: "text" as const, text: m.cachedPrefix, cache_control: { type: "ephemeral" as const } }, { type: "text" as const, text: m.content.slice(m.cachedPrefix.length) }] }
            : { role: m.role, content: m.content },
        ),
        stream: true,
        ...(adaptive
          ? {
              thinking: { type: "adaptive", display: "summarized" },
              output_config: {
                effort,
                // Structured outputs: the critique/revision JSON is validated server-side.
                ...(structured && req.jsonSchema ? { format: { type: "json_schema", schema: req.jsonSchema } } : {}),
              },
            }
          : { thinking: { type: "enabled", budget_tokens: Math.min(8000, Math.max(1024, maxTokens - 1024)) } }),
        ...(fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
      });
      let msg: Anthropic.Beta.BetaMessage;
      try {
        msg = await client.beta.messages.stream(build(true), { signal: req.signal }).finalMessage();
      } catch (err) {
        if (isTransient(err)) throw new TransientError((err as Error).message, err);
        // A schema the API will not accept must not take the seat down: fall back to prompt-only JSON.
        if (err instanceof Anthropic.BadRequestError && req.jsonSchema && /schema|format|output_config/i.test(err.message)) {
          try {
            msg = await client.beta.messages.stream(build(false), { signal: req.signal }).finalMessage();
          } catch (err2) {
            if (isTransient(err2)) throw new TransientError((err2 as Error).message, err2);
            throw err2;
          }
        } else throw err;
      }

      if (msg.stop_reason === "refusal") {
        const why = msg.stop_details?.type === "refusal" ? msg.stop_details.explanation : "";
        throw new Error(`Anthropic model refused the request${why ? `: ${why}` : ""}`);
      }
      // max_tokens: keep what streamed; the engine's JSON repair or the reader decides what to do with a truncated answer.
      const text = msg.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      const reasoning = msg.content
        .filter((b): b is Anthropic.Beta.BetaThinkingBlock => b.type === "thinking")
        .map((b) => b.thinking)
        .filter(Boolean)
        .join("\n\n");
      const fallbackRan = (msg.usage.iterations ?? []).some((it) => it.type === "fallback_message");
      if (!text.trim()) throw new Error(`Anthropic returned no text (stop_reason ${msg.stop_reason})`);
      return {
        text: msg.stop_reason === "max_tokens" ? `${text}\n\n[truncated: max_tokens reached]` : text,
        reasoning: reasoning || undefined,
        servedBy: fallbackRan ? msg.model : undefined,
        usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0 },
      };
    },
  };
}
