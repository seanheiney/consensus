import Anthropic from "@anthropic-ai/sdk";
const EFFORT = {
    low: "low",
    medium: "medium",
    high: "high",
    max: "max",
};
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
            const stream = client.beta.messages.stream({
                model,
                max_tokens: maxTokens,
                system: req.system,
                messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
                ...(adaptive
                    ? { thinking: { type: "adaptive", display: "summarized" }, output_config: { effort } }
                    : { thinking: { type: "enabled", budget_tokens: Math.min(8000, Math.max(1024, maxTokens - 1024)) } }),
                ...(fallbacks
                    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
                    : {}),
            }, { signal: req.signal });
            const msg = await stream.finalMessage();
            if (msg.stop_reason === "refusal") {
                const why = msg.stop_details?.type === "refusal" ? msg.stop_details.explanation : "";
                throw new Error(`Anthropic model refused the request${why ? `: ${why}` : ""}`);
            }
            if (msg.stop_reason === "max_tokens") {
                throw new Error("Anthropic response hit max_tokens before finishing");
            }
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
            return {
                text,
                reasoning: reasoning || undefined,
                servedBy: fallbackRan ? msg.model : undefined,
                usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0 },
            };
        },
    };
}
