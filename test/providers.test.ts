import { describe, expect, it } from "vitest";
import { parseSpec, formatSpec, detectApiProviders } from "../src/providers/index.js";
import { resolveRun } from "../src/config.js";
import { flattenMessages } from "../src/providers/cli.js";

describe("parseSpec", () => {
  it("uses the provider default model for API providers", () => {
    expect(parseSpec("anthropic")).toEqual({ provider: "anthropic", model: "claude-fable-5-1", baseURL: undefined, effort: undefined });
  });
  it("leaves CLI providers on the CLI's default model", () => {
    expect(parseSpec("claude")).toMatchObject({ provider: "claude", model: undefined });
    expect(parseSpec("codex:gpt-5.6-sol")).toMatchObject({ provider: "codex", model: "gpt-5.6-sol" });
  });
  it("accepts explicit models with colons and dots", () => {
    expect(parseSpec("xai:grok-4.6")).toMatchObject({ provider: "xai", model: "grok-4.6" });
    expect(parseSpec("openrouter:anthropic/claude-opus-5")).toMatchObject({ model: "anthropic/claude-opus-5" });
  });
  it("parses per-panelist effort", () => {
    const s = parseSpec("openai:gpt-6-astra#max");
    expect(s).toMatchObject({ provider: "openai", model: "gpt-6-astra", effort: "max" });
    expect(formatSpec(s)).toBe("openai:gpt-6-astra#max");
    expect(() => parseSpec("claude#turbo")).toThrow(/Bad effort/);
  });
  it("parses compat endpoints", () => {
    expect(parseSpec("compat:qwen3@http://localhost:8000/v1")).toMatchObject({ provider: "compat", model: "qwen3", baseURL: "http://localhost:8000/v1" });
  });
  it("rejects unknown providers and incomplete compat specs", () => {
    expect(() => parseSpec("bogus:x")).toThrow(/Unknown provider/);
    expect(() => parseSpec("compat:x")).toThrow(/base URL/);
  });
});

describe("resolveRun", () => {
  const env = { ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k", PATH: "/nonexistent" };
  it("auto-detects from API keys when nothing is configured", async () => {
    expect(detectApiProviders(env).map((p) => p.name)).toEqual(["anthropic", "openai"]);
    const r = await resolveRun({ cfg: {}, env });
    expect(r.source).toBe("auto");
    expect(r.panel.map((p) => p.id)).toEqual(["anthropic:claude-fable-5-1", "openai:gpt-6-astra"]);
    // the captain (best model not on the panel) is the default reporter
    expect(r.captain).toBeDefined();
    expect(r.judge.id).toBe(r.captain!.id);
    expect(r.panel.map((p) => p.id)).not.toContain(r.judge.id);
  });
  it("fails with fewer than two connections", async () => {
    await expect(resolveRun({ cfg: {}, env: { OPENAI_API_KEY: "k", PATH: "/nonexistent" } })).rejects.toThrow(/at least 2/);
  });
  it("uses the active profile, with per-model effort and judge", async () => {
    const cfg = { profile: "x", profiles: { x: { panel: ["openai:gpt-6-astra#max", "anthropic:claude-opus-5"], judge: "anthropic", rounds: 2, effort: "low" as const } } };
    const r = await resolveRun({ cfg, env });
    expect(r.source).toBe("profile");
    expect(r.profile).toBe("x");
    expect(r.rounds).toBe(2);
    expect(r.effort).toBe("low");
    expect(r.panel.map((p) => p.id)).toEqual(["openai:gpt-6-astra", "anthropic:claude-opus-5"]);
    expect(r.judge).toBe(r.panel[1]);
  });
  it("--profile overrides the active one and rejects unknown names", async () => {
    const cfg = { profile: "a", profiles: { a: { panel: ["anthropic", "openai"] }, b: { panel: ["openai", "anthropic"] } } };
    expect((await resolveRun({ cfg, env, profile: "b" })).panel[0]!.provider).toBe("openai");
    await expect(resolveRun({ cfg, env, profile: "zzz" })).rejects.toThrow(/Unknown profile/);
  });
  it("--panel flags beat everything", async () => {
    const cfg = { profile: "a", profiles: { a: { panel: ["anthropic", "openai"] } } };
    const r = await resolveRun({ cfg, env, panel: ["openai:gpt-5.6-sol", "anthropic:claude-sonnet-5"] });
    expect(r.source).toBe("flags");
    expect(r.panel[0]!.model).toBe("gpt-5.6-sol");
  });
  it("rejects duplicate panelists", async () => {
    await expect(resolveRun({ cfg: {}, env, panel: ["anthropic", "anthropic"] })).rejects.toThrow(/Duplicate/);
  });
});

describe("flattenMessages", () => {
  it("keeps a single user message verbatim", () => {
    expect(flattenMessages([{ role: "user", content: "hi" }])).toBe("hi");
  });
  it("inlines prior assistant turns for single-turn CLIs", () => {
    const out = flattenMessages([{ role: "user", content: "q" }, { role: "assistant", content: "bad json" }, { role: "user", content: "fix" }]);
    expect(out).toContain("q");
    expect(out).toContain("Your previous response");
    expect(out).toContain("bad json");
    expect(out.endsWith("fix")).toBe(true);
  });
});
