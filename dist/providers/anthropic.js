import Anthropic from "@anthropic-ai/sdk";
import { TransientError } from "../types.js";
const EFFORT = {
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
};
function isTransient(err) {
    return (err instanceof Anthropic.RateLimitError ||
        err instanceof Anthropic.InternalServerError ||
        err instanceof Anthropic.APIConnectionError ||
        (err instanceof Anthropic.APIError && (err.status === 529 || err.status === 503 || err.status === 408)));
}
/** Models that support server-side refusal fallbacks. */
function supportsFallbacks(model) {
    return /^claude-(fable|opus-5|mythos)/.test(model);
}
/** Adaptive thinking + output_config.effort exist on Claude 4.6 and later; older models (Haiku 4.5, Sonnet 4.5, Opus 4.5 …) need budget_tokens and reject effort. */
function supportsAdaptive(model) {
    return /^claude-(fable|mythos|opus-5|sonnet-5|opus-4-[6-9]|sonnet-4-[6-9]|opus-4-\d\d|sonnet-4-\d\d)/.test(model);
}
export function createAnthropicPanelist(opts) {
    const client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
    const model = opts.model;
    return {
        id: `anthropic:${model}`,
        provider: "anthropic",
        model,
        effort: opts.effort,
        async complete(req) {
            const effort = EFFORT[opts.effort ?? req.effort ?? "high"];
            const fallbacks = supportsFallbacks(model);
            const adaptive = supportsAdaptive(model);
            const maxTokens = req.maxTokens ?? 32000;
            const build = (structured) => ({
                model,
                max_tokens: maxTokens,
                // The system prompt is identical for every phase of a run: cache it.
                system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
                messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
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
            let msg;
            try {
                msg = await client.beta.messages.stream(build(true), { signal: req.signal }).finalMessage();
            }
            catch (err) {
                if (isTransient(err))
                    throw new TransientError(err.message, err);
                // A schema the API will not accept must not take the seat down: fall back to prompt-only JSON.
                if (err instanceof Anthropic.BadRequestError && req.jsonSchema && /schema|format|output_config/i.test(err.message)) {
                    try {
                        msg = await client.beta.messages.stream(build(false), { signal: req.signal }).finalMessage();
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
            if (msg.stop_reason === "refusal") {
                const why = msg.stop_details?.type === "refusal" ? msg.stop_details.explanation : "";
                throw new Error(`Anthropic model refused the request${why ? `: ${why}` : ""}`);
            }
            // max_tokens: keep what streamed; the engine's JSON repair or the reader decides what to do with a truncated answer.
            const text = msg.content
                .filter((b) => b.type === "text")
                .map((b) => b.text)
                .join("");
            const reasoning = msg.content
                .filter((b) => b.type === "thinking")
                .map((b) => b.thinking)
                .filter(Boolean)
                .join("\n\n");
            const fallbackRan = (msg.usage.iterations ?? []).some((it) => it.type === "fallback_message");
            if (!text.trim())
                throw new Error(`Anthropic returned no text (stop_reason ${msg.stop_reason})`);
            return {
                text: msg.stop_reason === "max_tokens" ? `${text}\n\n[truncated: max_tokens reached]` : text,
                reasoning: reasoning || undefined,
                servedBy: fallbackRan ? msg.model : undefined,
                usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0 },
            };
        },
    };
}
