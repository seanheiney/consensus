import OpenAI from "openai";
import type { CompletionRequest, CompletionResult, Effort, Panelist } from "../types.js";
import type { ProviderFactoryOptions } from "./types.js";

const EFFORT: Record<Effort, "low" | "medium" | "high"> = {
  low: "low",
  medium: "medium",
  high: "high",
  max: "high",
};

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
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const effort = EFFORT[opts.effort ?? req.effort ?? "high"];
      const res = await client.chat.completions.create(
        {
          model,
          messages: [
            { role: "system", content: req.system },
            ...req.messages.map((m) => ({ role: m.role, content: m.content })),
          ],
          max_completion_tokens: req.maxTokens ?? 32000,
          ...(opts.reasoning ? { reasoning_effort: effort } : {}),
          ...(req.json ? { response_format: { type: "json_object" as const } } : {}),
        },
        { signal: req.signal },
      );
      const choice = res.choices[0];
      if (!choice) throw new Error(`${opts.provider} returned no choices`);
      if (choice.finish_reason === "length") {
        throw new Error(`${opts.provider} response hit the token limit before finishing`);
      }
      return {
        text: choice.message.content ?? "",
        usage: res.usage
          ? { inputTokens: res.usage.prompt_tokens, outputTokens: res.usage.completion_tokens }
          : undefined,
      };
    },
  };
}
