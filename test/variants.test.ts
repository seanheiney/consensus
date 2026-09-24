import { describe, expect, it } from "vitest";
import { ConsensusEngine } from "../src/protocol/engine.js";
import { escalationContext, openDisputes, runWithEscalation, shouldEscalate, statedConfidence } from "../src/escalate.js";
import { expandTask, expandVariants, TASKS } from "../src/variants.js";
import { renderReport } from "../src/report.js";
import { agreeAll, disagreeAll, fakePanelist, phaseOf, revision } from "./fake.js";
import type { CompletionRequest, ConsensusRun } from "../src/types.js";

describe("expandVariants", () => {
  it("seats one model once per angle", () => {
    expect(expandVariants(["claude"], 3)).toEqual(["claude+first-principles", "claude+skeptic", "claude+pragmatist"]);
  });

  it("gives every model each angle when there are several", () => {
    expect(expandVariants(["claude", "codex"], 4)).toEqual(["claude+first-principles", "codex+first-principles", "claude+skeptic", "codex+skeptic"]);
  });

  it("leaves seats that already carry a persona alone", () => {
    expect(expandVariants(["claude", "codex:x+security"], 3)).toEqual(["codex:x+security", "claude+first-principles", "claude+skeptic"]);
  });

  it("refuses more seats than there are (model, angle) pairs", () => {
    expect(() => expandVariants(["a"], 99)).toThrow(/at most 8/);
    expect(() => expandVariants(["a"], 1)).toThrow(/at least 2/);
  });

  it("keeps object members, carrying the angle as the persona", () => {
    expect(expandVariants([{ model: "groq:m" }], 2)).toEqual([
      { model: "groq:m", persona: "first-principles", name: "first-principles" },
      { model: "groq:m", persona: "skeptic", name: "skeptic" },
    ]);
  });
});

describe("expandTask", () => {
  it("seats the angles that suit the work", () => {
    const { members, preset } = expandTask(["groq:m"], "debug");
    expect(members).toEqual(["groq:m+enumerator", "groq:m+skeptic", "groq:m+alternate-method"]);
    expect(preset.rounds).toBe(TASKS.debug!.rounds);
  });

  it("rejects an unknown task by name", () => {
    expect(() => expandTask(["a"], "vibes")).toThrow(/Unknown task "vibes"/);
  });
});

function runWith(over: Partial<ConsensusRun> = {}): ConsensusRun {
  return {
    schemaVersion: 1,
    id: "r1",
    startedAt: "2026-09-24T00:00:00Z",
    prompt: "q",
    options: { rounds: 1, defaultEffort: "high" },
    labels: { A: "a:m", B: "b:m" },
    seats: [
      { id: "a:m", label: "A", provider: "a", model: "m" },
      { id: "b:m", label: "B", provider: "b", model: "m" },
    ],
    proposals: {},
    rounds: [],
    finalAnswers: {},
    converged: true,
    judge: "a:m",
    synthesis: "# Answer\n\nUse a queue.\n\n# Confidence\n\nHigh — both seats agreed.\n",
    usage: {},
    dropped: {},
    ...over,
  };
}

const roundWithDispute = (severity: "major" | "minor") => ({
  round: 1,
  converged: false,
  critiques: {
    A: { self_review: { errors: [], gaps: [] }, reviews: [{ answer: "B", verdict: "disagree" as const, strengths: [], disputes: [{ claim: "locks scale", problem: "not past 10k writes", correction: "shard", severity }] }] },
  },
});

describe("escalation decisions", () => {
  it("does not escalate a converged, high-confidence, undisputed run", () => {
    expect(shouldEscalate(runWith())).toMatchObject({ escalate: false });
  });

  it("escalates when the panel did not converge", () => {
    expect(shouldEscalate(runWith({ converged: false }))).toMatchObject({ escalate: true, reason: expect.stringContaining("did not converge") });
  });

  it("escalates on low or medium stated confidence, and on none at all", () => {
    expect(shouldEscalate(runWith({ synthesis: "# Answer\n\nx\n\n# Confidence\n\nMedium: thin evidence.\n" }))).toMatchObject({ escalate: true, reason: expect.stringContaining("medium confidence") });
    expect(shouldEscalate(runWith({ synthesis: "# Answer\n\nx\n" }))).toMatchObject({ escalate: true, reason: "the first panel stated no confidence" });
  });

  it("escalates when a major dispute is left open, but not a minor one", () => {
    expect(shouldEscalate(runWith({ rounds: [roundWithDispute("major")] }))).toMatchObject({ escalate: true });
    expect(shouldEscalate(runWith({ rounds: [roundWithDispute("minor")] }))).toMatchObject({ escalate: false });
  });

  it("honours escalate-when: disputed ignores confidence, always promotes regardless", () => {
    const lowConfidence = runWith({ synthesis: "# Answer\n\nx\n\n# Confidence\n\nLow.\n" });
    expect(shouldEscalate(lowConfidence, "disputed")).toMatchObject({ escalate: false });
    expect(shouldEscalate(runWith(), "always")).toMatchObject({ escalate: true });
  });

  it("escalates when the panel shrank below two seats", () => {
    expect(shouldEscalate(runWith({ dropped: { "b:m": "timeout" } }))).toMatchObject({ escalate: true, reason: "only 1 seat answered" });
  });

  it("reads the judge's confidence word and the open disputes", () => {
    expect(statedConfidence("# Confidence\n\nModerate, because...")).toBe("medium");
    expect(statedConfidence("no sections here")).toBeUndefined();
    expect(openDisputes(runWith({ rounds: [roundWithDispute("major")] }))).toEqual(["locks scale — not past 10k writes"]);
  });
});

describe("escalation context", () => {
  it("hands the strong panel the draft, the open disputes and the user's own context", () => {
    const text = escalationContext(runWith({ converged: false, rounds: [roundWithDispute("major")] }), "ORIGINAL CONTEXT");
    expect(text).toContain("ORIGINAL CONTEXT");
    expect(text).toContain("Use a queue.");
    expect(text).toContain("- locks scale — not past 10k writes");
    expect(text).toMatch(/draft to verify, not as an authority/);
  });
});

describe("runWithEscalation", () => {
  const settled = (name: string) => (req: CompletionRequest) =>
    phaseOf(req) === "critique" ? agreeAll(req) : phaseOf(req) === "synthesize" ? "# Answer\n\nx\n\n# Confidence\n\nHigh.\n" : `${name} answer`;
  const unsettled = (name: string) => (req: CompletionRequest) =>
    phaseOf(req) === "critique" ? disagreeAll(req) : phaseOf(req) === "revise" ? revision(`${name} revised`) : phaseOf(req) === "synthesize" ? "# Answer\n\nx\n\n# Confidence\n\nLow.\n" : `${name} answer`;

  const resolved = (script: (n: string) => (req: CompletionRequest) => string, tag: string) =>
    ({ panel: [fakePanelist(`${tag}:1`, script("A")), fakePanelist(`${tag}:2`, script("B"))], judge: fakePanelist(`${tag}:1`, script("A")), rounds: 1, effort: "high", source: "flags" }) as never;

  it("stops after the first pass when it settles the question", async () => {
    const tiers: string[] = [];
    const run = await runWithEscalation({
      first: resolved(settled, "cheap"),
      resolveTarget: async () => {
        throw new Error("must not resolve the strong panel");
      },
      prompt: "q",
      runOnce: async (r, p, c, tier) => {
        tiers.push(`tier${tier}`);
        return new ConsensusEngine({ panel: (r as { panel: never[] }).panel, rounds: 1 }).run(p, c);
      },
    });
    expect(tiers).toEqual(["tier1"]);
    expect(run.escalation).toBeUndefined();
  });

  it("promotes an unsettled first pass and records where it came from", async () => {
    const contexts: (string | undefined)[] = [];
    const run = await runWithEscalation({
      first: resolved(unsettled, "cheap"),
      resolveTarget: async () => resolved(settled, "strong"),
      prompt: "q",
      context: "USER CONTEXT",
      runOnce: async (r, p, c) => {
        contexts.push(c);
        return new ConsensusEngine({ panel: (r as { panel: never[] }).panel, rounds: 1 }).run(p, c);
      },
    });
    // Seat order is shuffled for anonymity, so compare as a set.
    expect([...run.escalation!.fromSeats].sort()).toEqual(["cheap:1", "cheap:2"]);
    expect(run.escalation).toMatchObject({ firstPassConverged: false });
    expect(run.escalation!.reason).toMatch(/did not converge/);
    expect(contexts[0]).toBe("USER CONTEXT");
    expect(contexts[1]).toContain("A faster panel's first pass");
    expect(contexts[1]).toContain("USER CONTEXT");
  });
});

describe("grounding check (--verify)", () => {
  const script = (req: CompletionRequest): string => {
    switch (phaseOf(req)) {
      case "critique":
        return agreeAll(req);
      case "verify":
        return JSON.stringify({
          claims: [
            { claim: "Postgres advisory locks are session-scoped", support: "supported", evidence: "the pasted docs say so" },
            { claim: "throughput is 10k writes/s", support: "unsupported", evidence: "" },
          ],
          note: "",
        });
      case "synthesize":
        return "# Answer\n\nUse advisory locks.\n\n# Confidence\n\nHigh.\n";
      default:
        return "answer";
    }
  };

  it("records what the given material establishes and flags what it does not", async () => {
    const run = await new ConsensusEngine({ panel: [fakePanelist("a:m", script), fakePanelist("b:m", script)], rounds: 1, verify: true }).run("q", "PASTED DOCS");
    expect(run.verification).toMatchObject({ by: "a:m", claims: [{ support: "supported" }, { claim: "throughput is 10k writes/s", support: "unsupported" }] });
    const report = renderReport(run);
    expect(report).toContain("2 load-bearing claims checked");
    expect(report).toContain("**unsupported**: throughput is 10k writes/s");
    expect(report).not.toContain("**supported**: Postgres advisory locks");
  });

  it("does not run unless asked, and never costs the panel its answer when it fails", async () => {
    const noVerify = await new ConsensusEngine({ panel: [fakePanelist("a:m", script), fakePanelist("b:m", script)], rounds: 1 }).run("q");
    expect(noVerify.verification).toBeUndefined();

    const broken = (req: CompletionRequest) => (phaseOf(req) === "verify" ? "not json at all" : script(req));
    const run = await new ConsensusEngine({ panel: [fakePanelist("a:m", broken), fakePanelist("b:m", broken)], rounds: 1, verify: true }).run("q");
    expect(run.synthesis).toContain("# Answer");
    expect(run.verification!.note).toMatch(/verification did not complete/);
    expect(run.verification!.claims).toEqual([]);
  });
});
