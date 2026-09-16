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
  it("captain auto is the best available model even if a seat uses it; neutral avoids panel vendors", async () => {
    const { autoCaptain } = await import("../src/config.js");
    const st = [status("anthropic", "claude", "cli"), status("openai", "codex", "cli", "0.160.0"), status("google", undefined), status("xai", undefined), status("openrouter", "openrouter", "api")];
    expect(await autoCaptain(["claude:claude-fable-5-1", "codex:gpt-6-astra"], st)).toBe("claude:claude-fable-5-1#high");
    expect(await autoCaptain(["claude:claude-fable-5-1", "codex:gpt-6-astra"], st, "neutral")).toMatch(/^openrouter:google\//);
  });
  it("auto captain carries ordered stand-ins across vendors", async () => {
    const { captainCandidates } = await import("../src/config.js");
    const st = [status("anthropic", "claude", "cli"), status("openai", "codex", "cli", "0.160.0"), status("google", undefined), status("xai", undefined), status("openrouter", undefined)];
    const c = await captainCandidates(["claude:claude-opus-5", "codex:gpt-5.6-sol"], st);
    expect(c[0]).toBe("claude:claude-fable-5-1#high");
    expect(c[1]).toMatch(/^codex:gpt-6-astra/);
    expect(c).toContain("claude:claude-opus-5#high");
    expect(new Set(c).size).toBe(c.length);
  });
  it("external:auto prefers a vendor that is not on the panel", async () => {
    const st = [status("anthropic", "claude", "cli"), status("openai", "codex", "cli", "0.160.0"), status("google", undefined), status("xai", undefined), status("openrouter", "openrouter", "api")];
    const j = await autoExternalJudge(["claude:claude-opus-5", "codex:gpt-5.6-sol"], st);
    expect(j).toMatch(/^openrouter:google\//);
    const only = [status("anthropic", "claude", "cli"), status("openai", undefined), status("google", undefined), status("xai", undefined), status("openrouter", undefined)];
    const j2 = await autoExternalJudge(["claude:claude-opus-5+skeptic", "claude:claude-opus-5+teacher"], only);
    expect(j2).toMatch(/^claude:claude-(fable-5-1|sonnet-5|haiku-4-5)/);

  });
  it("presets default to an automatic captain", () => {
    const st = [status("anthropic", "claude", "cli"), status("openai", "codex", "cli", "0.160.0"), status("google", "google", "api"), status("xai", "grok", "cli"), status("openrouter", undefined)];
    const profs = starterProfiles(st);
    for (const n of ["frontier", "balanced", "budget", "fast"]) expect(profs[n]!.captain).toBe("auto");
  });
  it("external:auto falls back to the first seat only when nothing else can be seated", async () => {
    const only = [status("anthropic", "claude", "cli"), status("openai", undefined), status("google", undefined), status("xai", undefined), status("openrouter", undefined)];
    const j = await autoExternalJudge(["claude:claude-fable-5-1", "claude:claude-opus-5", "claude:claude-sonnet-5", "claude:claude-haiku-4-5"], only);
    expect(j).toBe("claude:claude-fable-5-1");
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


describe("revision fires whenever anything was disputed", () => {
  it("round 1 with only minor disputes still revises, then converges in round 2", async () => {
    let n = 0;
    const minor = (req: CompletionRequest) => {
      if (phaseOf(req) === "critique") {
        n++;
        const others = [...req.messages[0]!.content.matchAll(/### Answer (\w)/g)].map((m) => m[1]!).filter((l) => !req.messages[0]!.content.includes(`### Answer ${l} (this is YOUR answer)`));
        return JSON.stringify({ self_review: { errors: [], gaps: [] }, reviews: others.map((answer) => ({ answer, verdict: "agree", strengths: ["ok"], disputes: n <= 2 ? [{ claim: "nit", problem: "typo", correction: "fix", severity: "minor" }] : [] })) });
      }
      if (phaseOf(req) === "revise") return JSON.stringify({ responses: [{ from: "B", claim: "nit", action: "concede", reason: "fair" }], position_changed: false, answer: "revised" });
      return phaseOf(req) === "synthesize" ? "s" : "a";
    };
    const run = await new ConsensusEngine({ panel: [fakePanelist("a:m", minor), fakePanelist("b:m", minor)], rounds: 3 }).run("q");
    expect(run.rounds).toHaveLength(2);
    expect(run.rounds[0]!.converged).toBe(false);
    expect(run.rounds[0]!.revisions).toBeDefined();
    expect(run.converged).toBe(true);
  });
  it("a clean sheet (no disputes at all) still converges in round 1", async () => {
    const run = await new ConsensusEngine({ panel: [fakePanelist("a:m", std("A")), fakePanelist("b:m", std("B"))], rounds: 3 }).run("q");
    expect(run.rounds).toHaveLength(1);
    expect(run.converged).toBe(true);
  });
});

describe("spend ceilings", () => {
  it("--max-spend counts subscription-equivalent spend; --max-cost does not", async () => {
    const { CostLimitError } = await import("../src/cost.js");
    const sub = (id: string) => {
      const p = fakePanelist(id, std(id));
      const inner = p.complete.bind(p);
      p.complete = async (req) => ({ ...(await inner(req)), usage: { inputTokens: 1_000_000, outputTokens: 0 } });
      return p;
    };
    await expect(new ConsensusEngine({ panel: [sub("claude:claude-opus-5"), sub("codex:gpt-5.6-sol")], maxCostUsd: 1 }).run("q")).resolves.toBeDefined();
    await expect(new ConsensusEngine({ panel: [sub("claude:claude-opus-5"), sub("codex:gpt-5.6-sol")], maxSpendUsd: 1 }).run("q")).rejects.toBeInstanceOf(CostLimitError);
  });
});
