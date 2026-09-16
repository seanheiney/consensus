import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicPanelist } from "../src/providers/anthropic.js";
import { TransientError } from "../src/types.js";

/** A stand-in for the SDK client: `script` decides what each call returns or throws. */
function fakeClient(script: (params: Record<string, unknown>, call: number) => unknown) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        stream: (params: Record<string, unknown>) => {
          calls.push(params);
          const out = script(params, calls.length);
          return {
            finalMessage: async () => {
              if (out instanceof Error) throw out;
              return out;
            },
          };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}
const msg = (over: Record<string, unknown> = {}) => ({
  model: "claude-opus-5",
  stop_reason: "end_turn",
  content: [{ type: "text", text: "OK" }],
  usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 0, iterations: [] },
  ...over,
});
const req = { system: "s", messages: [{ role: "user" as const, content: "q" }], phase: "propose" as const };

describe("Anthropic API provider (recorded fixtures)", () => {
  it("sends adaptive thinking + effort + structured output and caches the problem prefix", async () => {
    const { client, calls } = fakeClient(() => msg());
    const p = createAnthropicPanelist({ model: "claude-opus-5", effort: "xhigh", client });
    const r = await p.complete({ ...req, json: true, jsonSchema: { type: "object" }, messages: [{ role: "user", content: "PREFIX rest", cachedPrefix: "PREFIX" }] });
    expect(r.text).toBe("OK");
    const params = calls[0] as { thinking: unknown; output_config: { effort: string; format?: unknown }; messages: { content: unknown }[] };
    expect(params.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(params.output_config.effort).toBe("xhigh");
    expect(params.output_config.format).toEqual({ type: "json_schema", schema: { type: "object" } });
    const content = params.messages[0]!.content as { text: string; cache_control?: unknown }[];
    expect(content[0]).toMatchObject({ text: "PREFIX", cache_control: { type: "ephemeral" } });
    expect(content[1]).toMatchObject({ text: " rest" });
  });

  it("gates Haiku 4.5 onto budget_tokens with no effort", async () => {
    const { client, calls } = fakeClient(() => msg({ model: "claude-haiku-4-5" }));
    await createAnthropicPanelist({ model: "claude-haiku-4-5", effort: "high", client }).complete(req);
    const params = calls[0] as { thinking: { type: string }; output_config?: unknown };
    expect(params.thinking.type).toBe("enabled");
    expect(params.output_config).toBeUndefined();
  });

  it("surfaces a refusal as an error with the category", async () => {
    const { client } = fakeClient(() => msg({ stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: "no" }, content: [] }));
    await expect(createAnthropicPanelist({ model: "claude-opus-5", client }).complete(req)).rejects.toThrow(/refused/);
  });

  it("reports the model that served a refusal fallback", async () => {
    const { client } = fakeClient(() => msg({ model: "claude-opus-4-8", usage: { input_tokens: 5, output_tokens: 1, iterations: [{ type: "fallback_message" }] } }));
    const r = await createAnthropicPanelist({ model: "claude-fable-5-1", client }).complete(req);
    expect(r.servedBy).toBe("claude-opus-4-8");
  });

  it("falls back to prompt-only JSON when the API rejects the schema", async () => {
    const { client, calls } = fakeClient((_p, n) => (n === 1 ? new Anthropic.BadRequestError(400, { error: { message: "output_config.format: schema invalid" } }, "output_config.format: schema invalid", new Headers()) : msg({ content: [{ type: "text", text: '{"ok":true}' }] })));
    const r = await createAnthropicPanelist({ model: "claude-opus-5", client }).complete({ ...req, json: true, jsonSchema: { type: "object" } });
    expect(r.text).toBe('{"ok":true}');
    expect(calls).toHaveLength(2);
    expect((calls[1] as { output_config: { format?: unknown } }).output_config.format).toBeUndefined();
  });

  it("keeps a max_tokens-truncated answer instead of dropping the seat, and marks it", async () => {
    const { client } = fakeClient(() => msg({ stop_reason: "max_tokens", content: [{ type: "text", text: "partial" }] }));
    const r = await createAnthropicPanelist({ model: "claude-opus-5", client }).complete(req);
    expect(r.text).toContain("partial");
    expect(r.text).toContain("[truncated");
  });

  it("classifies rate limits as transient", async () => {
    const { client } = fakeClient(() => new Anthropic.RateLimitError(429, { error: { message: "slow down" } }, "slow down", new Headers()));
    await expect(createAnthropicPanelist({ model: "claude-opus-5", client }).complete(req)).rejects.toBeInstanceOf(TransientError);
  });
});
