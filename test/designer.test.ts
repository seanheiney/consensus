import { describe, expect, it } from "vitest";
import { askDesigner, materializeDesign, templateDesign, DesignSchema } from "../src/designer.js";
import { fakePanelist } from "./fake.js";
import { buildPanel } from "../src/config.js";
import type { VendorStatus } from "../src/doctor.js";

function status(vendor: VendorStatus["vendor"], spec: string | undefined, via?: "cli" | "api"): VendorStatus {
  return { vendor, label: vendor, cli: { name: spec ?? "x", bin: "x", installed: !!spec, loggedIn: !!spec, verified: true, detail: "", version: "0.160.0" }, apiProvider: "x", apiKey: via === "api", connected: !!spec, via, spec };
}
const two = [status("anthropic", "claude", "cli"), status("openai", "codex", "cli"), status("google", undefined), status("xai", undefined), status("openrouter", undefined)];

describe("panel designer", () => {
  it("template designs seat every expertise and reuse built-ins", () => {
    const d = templateDesign("security review", 3, ["security", "performance", "distributed systems"], "standard", 2);
    expect(d.seats).toHaveLength(3);
    expect(d.seats[0]!.persona_name).toBe("security");
    expect(d.seats[0]!.persona_prompt).toBe("");
    expect(d.seats[2]!.persona_prompt).toContain("distributed systems");
    expect(() => DesignSchema.parse(d)).not.toThrow();
  });

  it("materializes across connected vendors, keeps ids unique, and honours the judge choice", () => {
    const d = templateDesign("x", 4, ["security", "performance", "product manager", "skeptic"], "frontier", 3);
    const m = materializeDesign(d, two);
    expect(m.profile.panel).toHaveLength(4);
    expect(m.profile.panel[0]).toMatch(/^claude:claude-fable-5-1#max\+security$/);
    expect(m.profile.panel[1]).toMatch(/^codex:gpt-6-astra#max\+performance$/);
    expect(m.profile.judge).toBe("external:auto");
    expect(Object.keys(m.personas)).toContain("product-manager");
    const { panel } = buildPanel(m.profile.panel, "high", undefined, { PATH: "/nonexistent" }, m.personas);
    expect(new Set(panel.map((p) => p.id)).size).toBe(4);
  });

  it("a model-drafted design is validated and seated", async () => {
    const designer = fakePanelist("d:m", () =>
      JSON.stringify({ name: "api-council", description: "d", seats: [{ expertise: "auth", persona_name: "auth-reviewer", persona_prompt: "You review authentication designs.", tier: "standard" }, { expertise: "skeptic", persona_name: "skeptic", persona_prompt: "", tier: "budget" }], rounds: 2, judge: "seat", rationale: "r" }),
    );
    const d = await askDesigner(designer, "brief", two);
    expect(designer.calls[0]!.jsonSchema).toBeDefined();
    const m = materializeDesign(d, two);
    expect(m.profile.panel).toEqual(["claude:claude-opus-5#high+auth-reviewer", "codex:gpt-5.6-luna#medium+skeptic"]);
    expect(m.profile.judge).toBe("claude:claude-opus-5+auth-reviewer");
    expect(m.personas["auth-reviewer"]).toContain("authentication");
  });

  it("reports seats no connection can fill instead of silently dropping them", () => {
    const d = templateDesign("x", 2, ["a", "b"], "frontier", 1);
    const none = [status("anthropic", undefined), status("openai", undefined), status("google", undefined), status("xai", undefined), status("openrouter", undefined)];
    const m = materializeDesign(d, none);
    expect(m.profile.panel).toHaveLength(0);
    expect(m.unseated).toHaveLength(2);
  });
});
