import OpenAI from "openai";
import type { CompletionRequest, CompletionResult, Effort, Panelist } from "../types.js";
import type { ProviderFactoryOptions } from "./types.js";

const EFFORT: Record<Effort, OpenAI.ReasoningEffort> = {
  low: "low",
  medium: "medium",
  high: "high",
  max: "max",
};

/** Reasoning-capable model families that accept the `reasoning` parameter. */
function isReasoningModel(model: string): boolean {
  return /^(gpt-5|gpt-6|o\d)/.test(model);
}

/** OpenAI via the Responses API. */
export function createOpenAIPanelist(opts: ProviderFactoryOptions): Panelist {
  const client = new OpenAI({
    ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
    ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
  });
  const model = opts.model;

  return {
    id: `openai:${model}`,
    provider: "openai",
    model,
    effort: opts.effort,
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const effort = EFFORT[opts.effort ?? req.effort ?? "high"];
      const res = await client.responses.create(
        {
          model,
          instructions: req.system,
          input: req.messages.map((m) => ({ role: m.role, content: m.content })),
          max_output_tokens: req.maxTokens ?? 32000,
          store: false,
          ...(isReasoningModel(model) ? { reasoning: { effort } } : {}),
          ...(req.json ? { text: { format: { type: "json_object" as const } } } : {}),
        },
        { signal: req.signal },
      );
      if (res.status === "incomplete") {
        throw new Error(`OpenAI response incomplete (${res.incomplete_details?.reason ?? "unknown"}); partial output discarded: ${res.output_text.slice(0, 120)}…`);
      }
      if (res.status && res.status !== "completed") {
        throw new Error(`OpenAI response status ${res.status}${res.error ? `: ${res.error.message}` : ""}`);
      }
      if (!res.output_text.trim()) throw new Error("OpenAI returned an empty answer");
      return {
        text: res.output_text,
        usage: res.usage
          ? { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens }
          : undefined,
      };
    },
  };
}
