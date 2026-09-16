import { describe, expect, it } from "vitest";
import { ConsensusEngine, toStrictJsonSchema } from "../src/protocol/engine.js";
import { CritiqueSchema, RevisionSchema } from "../src/protocol/schemas.js";
import { autoExternalJudge } from "../src/config.js";
import { starterProfiles } from "../src/profiles.js";
import { gradePrompt } from "../src/bench.js";
import { agreeAll, fakePanelist, phaseOf } from "./fake.js";
import type { VendorStatus } from "../src/doctor.js";
import type { CompletionRequest } from "../src/types.js";

const std = (name: string) => (req: CompletionRequest) => (phaseOf(req) === "critique" ? agreeAll(req) : phaseOf(req) === "synthesize" ? `synth ${name}` : `${name} answer`);
function status(vendor: VendorStatus["vendor"], spec: string | undefined, via?: "cli" | "api", version?: string): VendorStatus {
  return { vendor, label: vendor, cli: { name: spec ?? "x", bin: "x", installed: !!spec, loggedIn: !!spec, verified: true, detail: "", version }, apiProvider: "x", apiKey: via === "api", connected: !!spec, via, spec };
}

describe("structured outputs", () => {
  it("produces strict JSON schemas without defaults", () => {
    for (const s of [CritiqueSchema, RevisionSchema]) {
      const js = toStrictJsonSchema(s) as { type: string; additionalProperties?: boolean; required?: string[]; properties: Record<string, unknown> };
      expect(js.type).toBe("object");
      expect(js.additionalProperties).toBe(false);
      expect(js.required).toEqual(Object.keys(js.properties));
      expect(JSON.stringify(js)).not.toContain('"default"');
    }
  });
  it("hands the schema to seats on critique and revise, not propose", async () => {
    const a = fakePanelist("a:m", std("A"));
    const b = fakePanelist("b:m", std("B"));
    await new ConsensusEngine({ panel: [a, b], rounds: 1 }).run("q");
    expect(a.calls[0]!.jsonSchema).toBeUndefined();
    expect(a.calls[1]!.jsonSchema).toBeDefined();
    expect(a.calls[1]!.json).toBe(true);
  });
});

describe("seeded shuffles", () => {
  it("same seed gives the same labels and records the seed", async () => {
    const mk = () => [fakePanelist("a:m", std("A")), fakePanelist("b:m", std("B")), fakePanelist("c:m", std("C"))];
    const r1 = await new ConsensusEngine({ panel: mk(), seed: 42, rounds: 1 }).run("q");
    const r2 = await new ConsensusEngine({ panel: mk(), seed: 42, rounds: 1 }).run("q");
    expect(r1.labels).toEqual(r2.labels);
    expect(r1.options.seed).toBe(42);
  });
  it("critics see the answers in their own order", async () => {
    const seen: string[] = [];
    const mk = (n: string) => fakePanelist(n, (req) => { if (phaseOf(req) === "critique") seen.push(req.messages[0]!.content.match(/### Answer (\w)/g)!.join("")); return std(n)(req); });
    await new ConsensusEngine({ panel: [mk("a:m"), mk("b:m"), mk("c:m"), mk("d:m")], seed: 7, rounds: 1 }).run("q");
    expect(new Set(seen).size).toBeGreaterThan(1);
  });
});

describe("judges", () => {
  it("external:auto prefers a vendor that is not on the panel", async () => {
    const st = [status("anthropic", "claude", "cli"), status("openai", "codex", "cli", "0.160.0"), status("google", undefined), status("xai", undefined), status("openrouter", "openrouter", "api")];
    const j = await autoExternalJudge(["claude:claude-opus-5", "codex:gpt-5.6-sol"], st);
    expect(j).toMatch(/^openrouter:google\//);
    const only = [status("anthropic", "claude", "cli"), status("openai", undefined), status("google", undefined), status("xai", undefined), status("openrouter", undefined)];
    const j2 = await autoExternalJudge(["claude:claude-opus-5+skeptic", "claude:claude-opus-5+teacher"], only);
    expect(j2).toMatch(/^claude:claude-(fable-5-1|sonnet-5|haiku-4-5)/);
    await expect(autoExternalJudge(["claude:claude-fable-5-1", "claude:claude-opus-5", "claude:claude-sonnet-5", "claude:claude-haiku-4-5"], only)).rejects.toThrow(/external judge/);
  });
  it("preset judges rotate across vendors instead of always the first seat", () => {
    const st = [status("anthropic", "claude", "cli"), status("openai", "codex", "cli", "0.160.0"), status("google", "google", "api"), status("xai", "grok", "cli"), status("openrouter", undefined)];
    const profs = starterProfiles(st);
    const judges = ["frontier", "balanced", "budget", "fast"].map((n) => profs[n]!.judge!.split(":")[0]);
    expect(new Set(judges).size).toBeGreaterThan(1);
  });
});

describe("two-phase grading", () => {
  it("quality prompt never contains the reference; accuracy prompt does", () => {
    const c = { id: "x", prompt: "q", expected: "THE-REFERENCE-42" };
    expect(gradePrompt(c, [{ label: "A", text: "a" }], "quality")).not.toContain("THE-REFERENCE-42");
    expect(gradePrompt(c, [{ label: "A", text: "a" }], "accuracy")).toContain("THE-REFERENCE-42");
  });
});

describe("external:auto through resolveRun", () => {
  it("resolves to a concrete external judge spec", async () => {
    const { resolveRun } = await import("../src/config.js");
    const env = { ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k", PATH: "/nonexistent" };
    const r = await resolveRun({ cfg: {}, env, panel: ["anthropic:claude-opus-5", "openai:gpt-5.6-sol"], judge: "external:auto" });
    expect(r.panel.map((p) => p.id)).not.toContain(r.judge.id);
    expect(r.judge.id).toMatch(/^(anthropic|openai):/);
  });
});
