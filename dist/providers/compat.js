import OpenAI from "openai";
import { TransientError } from "../types.js";
const EFFORT = {
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "high",
    max: "high",
};
function isTransient(err) {
    return (err instanceof OpenAI.RateLimitError ||
        err instanceof OpenAI.InternalServerError ||
        err instanceof OpenAI.APIConnectionError ||
        (err instanceof OpenAI.APIError && (err.status === 503 || err.status === 408)));
}
/** Whether a gateway model takes a reasoning effort knob, and which values. */
function reasoningFor(provider, model, effort) {
    if (provider === "openrouter")
        return { reasoning: { effort } };
    if (provider === "xai")
        return /mini/.test(model) ? { reasoning_effort: effort } : undefined;
    if (provider === "groq") {
        // gpt-oss takes low/medium/high; Qwen 3.x takes "default"/"none"; other Groq models reject the field.
        if (/gpt-oss/.test(model))
            return { reasoning_effort: effort };
        if (/qwen3/i.test(model))
            return { reasoning_effort: "default", reasoning_format: "hidden" };
        return undefined;
    }
    return { reasoning_effort: effort };
}
/**
 * Any OpenAI-compatible chat-completions endpoint: xAI (Grok), OpenRouter,
 * Ollama, vLLM, LM Studio, etc.
 */
export function createCompatPanelist(opts) {
    const client = new OpenAI({ apiKey: opts.apiKey ?? "not-needed", baseURL: opts.baseURL, ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}) });
    const model = opts.model;
    return {
        id: `${opts.provider}:${model}`,
        provider: opts.provider,
        model,
        effort: opts.effort,
        billing: "api",
        effortApplied: (e) => {
            if (!opts.reasoning)
                return "ignored";
            const r = reasoningFor(opts.provider, model, EFFORT[e]);
            return r ? String(r.reasoning_effort ?? r.reasoning.effort) : "ignored";
        },
        async complete(req) {
            const effort = EFFORT[opts.effort ?? req.effort ?? "high"];
            const reasoningParams = (opts.reasoning && reasoningFor(opts.provider, model, effort)) || {};
            const build = (structured) => ({
                model,
                messages: [
                    { role: "system", content: req.system },
                    ...req.messages.map((m) => ({ role: m.role, content: m.content })),
                ],
                max_completion_tokens: Math.min(req.maxTokens ?? 32000, opts.maxOutput ?? Number.POSITIVE_INFINITY),
                ...reasoningParams,
                ...(req.json
                    ? structured && req.jsonSchema
                        ? { response_format: { type: "json_schema", json_schema: { name: "consensus_phase", schema: req.jsonSchema, strict: true } } }
                        : { response_format: { type: "json_object" } }
                    : {}),
            });
            let res;
            try {
                res = await client.chat.completions.create(build(true), { signal: req.signal });
            }
            catch (err) {
                if (isTransient(err))
                    throw new TransientError(err.message, err);
                // Gateways that don't take json_schema (or reject this one) fall back to json_object + prompt.
                if (err instanceof OpenAI.BadRequestError && req.jsonSchema) {
                    try {
                        res = await client.chat.completions.create(build(false), { signal: req.signal });
                    }
                    catch (err2) {
                        if (isTransient(err2))
                            throw new TransientError(err2.message, err2);
                        throw err2;
                    }
                }
                else
                    throw err;
            }
            const choice = res.choices[0];
            if (!choice)
                throw new Error(`${opts.provider} returned no choices`);
            if (!choice.message.content?.trim())
                throw new Error(`${opts.provider} returned an empty answer (finish_reason ${choice.finish_reason})`);
            return {
                text: choice.finish_reason === "length" ? `${choice.message.content}\n\n[truncated: token limit reached]` : choice.message.content,
                usage: res.usage
                    ? { inputTokens: res.usage.prompt_tokens, outputTokens: res.usage.completion_tokens }
                    : undefined,
            };
        },
    };
}
