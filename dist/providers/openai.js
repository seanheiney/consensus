import OpenAI from "openai";
import { TransientError } from "../types.js";
const EFFORT = {
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
};
function isTransient(err) {
    return (err instanceof OpenAI.RateLimitError ||
        err instanceof OpenAI.InternalServerError ||
        err instanceof OpenAI.APIConnectionError ||
        (err instanceof OpenAI.APIError && (err.status === 503 || err.status === 408)));
}
/** Reasoning-capable model families that accept the `reasoning` parameter. */
function isReasoningModel(model) {
    return /^(gpt-5|gpt-6|o\d)/.test(model);
}
/** OpenAI via the Responses API. */
export function createOpenAIPanelist(opts) {
    // A missing key must not throw at construction: pre-flight reports it with the fix instead.
    const client = new OpenAI({
        apiKey: opts.apiKey ?? process.env.OPENAI_API_KEY ?? "missing",
        ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    });
    const model = opts.model;
    return {
        id: `openai:${model}`,
        provider: "openai",
        model,
        effort: opts.effort,
        billing: "api",
        effortApplied: (e) => (isReasoningModel(model) ? String(EFFORT[e]) : "ignored"),
        async complete(req) {
            const effort = EFFORT[opts.effort ?? req.effort ?? "high"];
            const build = (structured) => ({
                model,
                instructions: req.system,
                input: req.messages.map((m) => ({ role: m.role, content: m.content })),
                max_output_tokens: req.maxTokens ?? 32000,
                store: false,
                ...(isReasoningModel(model) ? { reasoning: { effort } } : {}),
                ...(req.json
                    ? structured && req.jsonSchema
                        ? { text: { format: { type: "json_schema", name: "consensus_phase", schema: req.jsonSchema, strict: true } } }
                        : { text: { format: { type: "json_object" } } }
                    : {}),
            });
            let res;
            try {
                res = await client.responses.create(build(true), { signal: req.signal });
            }
            catch (err) {
                if (isTransient(err))
                    throw new TransientError(err.message, err);
                if (err instanceof OpenAI.BadRequestError && req.jsonSchema && /schema|format/i.test(err.message)) {
                    try {
                        res = await client.responses.create(build(false), { signal: req.signal });
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
            if (res.status === "incomplete") {
                throw new Error(`OpenAI response incomplete (${res.incomplete_details?.reason ?? "unknown"}); partial output discarded: ${res.output_text.slice(0, 120)}…`);
            }
            if (res.status && res.status !== "completed") {
                throw new Error(`OpenAI response status ${res.status}${res.error ? `: ${res.error.message}` : ""}`);
            }
            if (!res.output_text.trim())
                throw new Error("OpenAI returned an empty answer");
            const u = res.usage;
            return {
                text: res.output_text,
                usage: u
                    ? {
                        inputTokens: Math.max(0, u.input_tokens - (u.input_tokens_details?.cached_tokens ?? 0)),
                        cacheReadTokens: u.input_tokens_details?.cached_tokens ?? 0,
                        outputTokens: u.output_tokens, // includes reasoning tokens, which OpenAI bills as output
                    }
                    : undefined,
            };
        },
    };
}
