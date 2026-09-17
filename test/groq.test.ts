import { describe, expect, it } from "vitest";
import { createPanelist, parseSpec } from "../src/providers/index.js";
import { estimateCost, priceFor } from "../src/cost.js";

describe("groq provider", () => {
  it("parses groq specs with slashed model ids and personas", () => {
    expect(parseSpec("groq:openai/gpt-oss-120b#high")).toMatchObject({ provider: "groq", model: "openai/gpt-oss-120b", effort: "high" });
  });
  it("sends reasoning effort only where the Groq model takes it", () => {
    const oss = createPanelist("groq:openai/gpt-oss-120b", { effort: "max", env: { GROQ_API_KEY: "k" } });
    expect(oss.effortApplied?.("max")).toBe("high");
    const llama = createPanelist("groq:llama-3.3-70b-versatile", { effort: "high", env: { GROQ_API_KEY: "k" } });
    expect(llama.effortApplied?.("high")).toBe("ignored");
    expect(oss.billing).toBe("api");
  });
  it("prices gpt-oss seats at Groq list price and bills them as API spend", () => {
    expect(priceFor("groq:openai/gpt-oss-120b+skeptic")).toEqual({ input: 0.15, output: 0.6 });
    const c = estimateCost({ "groq:openai/gpt-oss-120b": { inputTokens: 1_000_000, outputTokens: 1_000_000, billing: "api" } });
    expect(c.usd).toBeCloseTo(0.75);
    expect(c.subscriptionEquivUsd).toBeNull();
    expect(priceFor("groq:llama-3.3-70b-versatile")).toBeUndefined();
  });
});
