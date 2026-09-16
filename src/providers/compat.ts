import OpenAI from "openai";
import { TransientError, type CompletionRequest, type CompletionResult, type Effort, type Panelist } from "../types.js";
import type { ProviderFactoryOptions } from "./types.js";

const EFFORT: Record<Effort, "low" | "medium" | "high"> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "high",
  max: "high",
};

function isTransient(err: unknown): boolean {
  return (
    err instanceof OpenAI.RateLimitError ||
    err instanceof OpenAI.InternalServerError ||
    err instanceof OpenAI.APIConnectionError ||
    (err instanceof OpenAI.APIError && (err.status === 503 || err.status === 408))
  );
}

export interface CompatOptions extends ProviderFactoryOptions {
  provider: string;
  baseURL: string;
  /** Send `reasoning_effort` (xAI, OpenRouter reasoning models). */
  reasoning?: boolean;
}

/**
 * Any OpenAI-compatible chat-completions endpoint: xAI (Grok), OpenRouter,
 * Ollama, vLLM, LM Studio, etc.
 */
export function createCompatPanelist(opts: CompatOptions): Panelist {
  const client = new OpenAI({ apiKey: opts.apiKey ?? "not-needed", baseURL: opts.baseURL });
  const model = opts.model;

  return {
    id: `${opts.provider}:${model}`,
    provider: opts.provider,
    model,
    effort: opts.effort,
    billing: "api",
    effortApplied: (e) => (!opts.reasoning ? "ignored" : opts.provider === "xai" && !/mini/.test(model) ? "ignored" : EFFORT[e]),
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const effort = EFFORT[opts.effort ?? req.effort ?? "high"];
      // Reasoning knobs differ per gateway: xAI accepts `reasoning_effort` only on its mini models,
      // OpenRouter takes a `reasoning: { effort }` object, others get nothing.
      const reasoningParams: Record<string, unknown> = !opts.reasoning
        ? {}
        : opts.provider === "openrouter"
          ? { reasoning: { effort } }
          : opts.provider === "xai"
            ? /mini/.test(model)
              ? { reasoning_effort: effort }
              : {}
            : { reasoning_effort: effort };
      let res: OpenAI.Chat.Completions.ChatCompletion;
      try {
        res = await client.chat.completions.create(
          {
            model,
            messages: [
              { role: "system", content: req.system },
              ...req.messages.map((m) => ({ role: m.role, content: m.content })),
            ],
            max_completion_tokens: req.maxTokens ?? 32000,
            ...(reasoningParams as object),
            ...(req.json ? { response_format: { type: "json_object" as const } } : {}),
          },
          { signal: req.signal },
        );
      } catch (err) {
        if (isTransient(err)) throw new TransientError((err as Error).message, err);
        throw err;
      }
      const choice = res.choices[0];
      if (!choice) throw new Error(`${opts.provider} returned no choices`);
      if (!choice.message.content?.trim()) throw new Error(`${opts.provider} returned an empty answer (finish_reason ${choice.finish_reason})`);
      return {
        text: choice.finish_reason === "length" ? `${choice.message.content}\n\n[truncated: token limit reached]` : choice.message.content,
        usage: res.usage
          ? { inputTokens: res.usage.prompt_tokens, outputTokens: res.usage.completion_tokens }
          : undefined,
      };
    },
  };
}
