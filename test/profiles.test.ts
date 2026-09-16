import { describe, expect, it } from "vitest";
import { materializePreset, starterProfiles } from "../src/profiles.js";
import { PRESETS } from "../src/catalog.js";
import type { VendorStatus } from "../src/doctor.js";

function status(vendor: VendorStatus["vendor"], spec: string | undefined, via?: "cli" | "api"): VendorStatus {
  return { vendor, label: vendor, cli: { name: "x", bin: "x", installed: false, loggedIn: false, verified: true, detail: "" }, apiProvider: "x", apiKey: via === "api", connected: !!spec, via, spec };
}

describe("presets", () => {
  const two = [status("anthropic", "claude", "cli"), status("openai", "codex", "cli"), status("google", undefined), status("xai", "xai", "api"), status("openrouter", undefined)];

  it("materializes per-vendor presets with the connected provider and effort", () => {
    const frontier = materializePreset(PRESETS.find((p) => p.name === "frontier")!, two)!;
    expect(frontier.panel).toEqual(["claude:claude-fable-5-1#max", "codex:gpt-6-astra#max", "xai:grok-4.6#max"]);
    expect(frontier.captain).toBe("auto");
    expect(frontier.judge).toBeUndefined();
    const budget = materializePreset(PRESETS.find((p) => p.name === "budget")!, two)!;
    expect(budget.panel).toEqual(["claude:claude-haiku-4-5#medium", "codex:gpt-5.6-luna#medium", "xai:grok-4.3#medium"]);
    expect(budget.rounds).toBe(2);
  });

  it("family presets need only one vendor and skip unconnected ones", () => {
    const only = [status("anthropic", "anthropic", "api"), status("openai", undefined), status("google", undefined), status("xai", undefined), status("openrouter", undefined)];
    const profs = starterProfiles(only);
    // per-vendor presets need 2 vendors; persona presets and the vendor's family work with one
    expect(Object.keys(profs).sort()).toEqual(["claude-family", "perspectives", "red-team"]);
    expect(profs["perspectives"]!.panel).toEqual([
      "anthropic:claude-fable-5-1#high+first-principles",
      "anthropic:claude-fable-5-1#high+skeptic",
      "anthropic:claude-fable-5-1#high+pragmatist",
      "anthropic:claude-fable-5-1#high+security",
      "anthropic:claude-fable-5-1#high+user-advocate",
    ]);
    expect(profs["red-team"]!.panel).toEqual(["anthropic:claude-opus-5#high", "anthropic:claude-opus-5#high+skeptic", "anthropic:claude-opus-5#high+contrarian"]);
    expect(profs["claude-family"]!.panel).toHaveLength(4);
    expect(profs["claude-family"]!.panel[0]).toBe("anthropic:claude-fable-5-1#high");
  });

  it("per-vendor presets need at least two connected vendors", () => {
    const one = [status("anthropic", "claude", "cli"), status("openai", undefined), status("google", undefined), status("xai", undefined), status("openrouter", undefined)];
    expect(materializePreset(PRESETS.find((p) => p.name === "frontier")!, one)).toBeUndefined();
  });

  it("with all four connected every preset materializes", () => {
    const all = [status("anthropic", "claude", "cli"), status("openai", "codex", "cli"), status("google", "google", "api"), status("xai", "grok", "cli"), status("openrouter", undefined)];
    expect(Object.keys(starterProfiles(all)).sort()).toEqual(PRESETS.map((p) => p.name).sort());
  });
});

describe("openrouter fallback", () => {
  it("fills vendors that are not connected directly, using verified OpenRouter ids", () => {
    const st = [status("anthropic", "claude", "cli"), status("openai", undefined), status("google", undefined), status("xai", undefined), status("openrouter", "openrouter", "api")];
    const frontier = materializePreset(PRESETS.find((p) => p.name === "frontier")!, st)!;
    expect(frontier.panel).toEqual([
      "claude:claude-fable-5-1#max",
      "openrouter:openai/gpt-6-astra#max",
      "openrouter:google/gemini-3.1-pro-preview#max",
      "openrouter:x-ai/grok-4.6#max",
    ]);
    const grokFam = materializePreset(PRESETS.find((p) => p.name === "grok-family")!, st)!;
    expect(grokFam.panel[0]).toBe("openrouter:x-ai/grok-4.6#high");
  });
  it("an OpenRouter key alone staffs every preset", () => {
    const st = [status("anthropic", undefined), status("openai", undefined), status("google", undefined), status("xai", undefined), status("openrouter", "openrouter", "api")];
    expect(Object.keys(starterProfiles(st)).sort()).toEqual(PRESETS.map((p) => p.name).sort());
  });
  it("direct connections are preferred over OpenRouter", () => {
    const st = [status("anthropic", "anthropic", "api"), status("openai", undefined), status("google", undefined), status("xai", undefined), status("openrouter", "openrouter", "api")];
    const budget = materializePreset(PRESETS.find((p) => p.name === "budget")!, st)!;
    expect(budget.panel[0]).toBe("anthropic:claude-haiku-4-5#medium");
    expect(budget.panel[1]).toBe("openrouter:openai/gpt-5.6-luna#medium");
  });
});
