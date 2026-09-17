import { describe, expect, it } from "vitest";
import { ConsensusEngine } from "../src/protocol/engine.js";
import { renderReport } from "../src/report.js";
import { agreeAll, disagreeAll, fakePanelist, ownLabel, phaseOf, revision } from "./fake.js";
import type { CompletionRequest } from "../src/types.js";

function stdScript(name: string, opts: { agreeFromRound?: number } = {}) {
  let critiqueRound = 0;
  return (req: CompletionRequest): string => {
    switch (phaseOf(req)) {
      case "propose":
        return `${name} proposal`;
      case "critique":
        critiqueRound++;
        return opts.agreeFromRound !== undefined && critiqueRound >= opts.agreeFromRound
          ? agreeAll(req)
          : disagreeAll(req);
      case "revise":
        return revision(`${name} revised ${critiqueRound}`);
      case "synthesize":
        return `# Answer\nsynth by ${name}`;
      default:
        throw new Error("unexpected repair");
    }
  };
}

describe("ConsensusEngine", () => {
  it("converges in round 1 when everyone agrees and skips revision", async () => {
    const a = fakePanelist("a:m", stdScript("A", { agreeFromRound: 1 }));
    const b = fakePanelist("b:m", stdScript("B", { agreeFromRound: 1 }));
    const events: string[] = [];
    const run = await new ConsensusEngine({ panel: [a, b], rounds: 3, onEvent: (e) => events.push(e.type) }).run("q");

    expect(run.converged).toBe(true);
    expect(run.rounds).toHaveLength(1);
    expect(run.rounds[0]!.revisions).toBeUndefined();
    expect(run.judge).toBe("a:m");
    expect(run.synthesis).toContain("synth by A");
    expect(events).toContain("converged");
    // propose + critique + synth (judge only)
    expect(a.calls).toHaveLength(3);
    expect(b.calls).toHaveLength(2);
    expect(Object.values(run.finalAnswers).sort()).toEqual(["A proposal", "B proposal"]);
  });

  it("revises until convergence and records revisions", async () => {
    const a = fakePanelist("a:m", stdScript("A", { agreeFromRound: 2 }));
    const b = fakePanelist("b:m", stdScript("B", { agreeFromRound: 2 }));
    const run = await new ConsensusEngine({ panel: [a, b], rounds: 3 }).run("q");

    expect(run.converged).toBe(true);
    expect(run.rounds).toHaveLength(2);
    expect(run.rounds[0]!.converged).toBe(false);
    expect(Object.keys(run.rounds[0]!.revisions!)).toHaveLength(2);
    expect(Object.values(run.finalAnswers).sort()).toEqual(["A revised 1", "B revised 1"]);
  });

  it("stops at max rounds without converging and does not revise after the last critique", async () => {
    const a = fakePanelist("a:m", stdScript("A"));
    const b = fakePanelist("b:m", stdScript("B"));
    const run = await new ConsensusEngine({ panel: [a, b], rounds: 2 }).run("q");

    expect(run.converged).toBe(false);
    expect(run.rounds).toHaveLength(2);
    expect(run.rounds[0]!.revisions).toBeDefined();
    expect(run.rounds[1]!.revisions).toBeUndefined();
    const synthPrompt = a.calls.at(-1)!.messages[0]!.content;
    expect(synthPrompt).toContain("did NOT fully converge");
    expect(synthPrompt).toContain("X is wrong");
  });

  it("requires unanimous agreement: one dissenter blocks convergence", async () => {
    const a = fakePanelist("a:m", stdScript("A", { agreeFromRound: 1 }));
    const b = fakePanelist("b:m", stdScript("B", { agreeFromRound: 1 }));
    const c = fakePanelist("c:m", stdScript("C"));
    const run = await new ConsensusEngine({ panel: [a, b, c], rounds: 1 }).run("q");
    expect(run.converged).toBe(false);
  });

  it("anonymizes with labels and tells each panelist which answer is theirs", async () => {
    const a = fakePanelist("a:m", stdScript("A", { agreeFromRound: 1 }));
    const b = fakePanelist("b:m", stdScript("B", { agreeFromRound: 1 }));
    const run = await new ConsensusEngine({ panel: [a, b] }).run("q");
    const own = ownLabel(a.calls[1]!);
    expect(run.labels[own]).toBe("a:m");
    expect(a.calls[1]!.messages[0]!.content).not.toContain("a:m");
    expect(a.calls[1]!.system).toContain("anonymous");
  });

  it("drops a panelist that fails and continues with the rest", async () => {
    const a = fakePanelist("a:m", stdScript("A", { agreeFromRound: 1 }));
    const b = fakePanelist("b:m", stdScript("B", { agreeFromRound: 1 }));
    const c = fakePanelist("c:m", () => {
      throw new Error("boom");
    });
    const run = await new ConsensusEngine({ panel: [a, b, c] }).run("q");
    expect(run.converged).toBe(true);
    expect(run.dropped["c:m"]).toContain("boom");
    expect(Object.keys(run.finalAnswers)).toHaveLength(2);
    expect(renderReport(run)).toContain("c:m: propose: boom");
  });

  it("fails when fewer than 2 panelists survive", async () => {
    const a = fakePanelist("a:m", stdScript("A"));
    const b = fakePanelist("b:m", () => {
      throw new Error("down");
    });
    await expect(new ConsensusEngine({ panel: [a, b] }).run("q")).rejects.toThrow(/Fewer than 2/);
  });

  it("repairs malformed JSON once", async () => {
    let critiques = 0;
    const a = fakePanelist("a:m", (req) => {
      const p = phaseOf(req);
      if (p === "critique") return ++critiques === 1 ? "not json at all" : "unreachable";
      if (p === "repair") return agreeAll({ ...req, messages: [req.messages[0]!] });
      return stdScript("A", { agreeFromRound: 1 })(req);
    });
    const b = fakePanelist("b:m", stdScript("B", { agreeFromRound: 1 }));
    const run = await new ConsensusEngine({ panel: [a, b] }).run("q");
    expect(run.converged).toBe(true);
    expect(a.calls.some((c) => phaseOf(c) === "repair")).toBe(true);
  });

  it("falls back to another synthesizer if the judge was dropped", async () => {
    const a = fakePanelist("a:m", () => {
      throw new Error("nope");
    });
    const b = fakePanelist("b:m", stdScript("B", { agreeFromRound: 1 }));
    const c = fakePanelist("c:m", stdScript("C", { agreeFromRound: 1 }));
    const run = await new ConsensusEngine({ panel: [a, b, c], judge: a }).run("q");
    expect(run.judge).not.toBe("a:m");
    expect(run.synthesis).toMatch(/synth by [BC]/);
  });

  it("rejects a panel of one", () => {
    expect(() => new ConsensusEngine({ panel: [fakePanelist("a:m", () => "")] })).toThrow(/at least 2/);
  });
});

describe("debate log events", () => {
  it("emits start, proposal, critique, revision and synthesis events with content", async () => {
    const a = fakePanelist("a:m", stdScript("A", { agreeFromRound: 2 }));
    const b = fakePanelist("b:m", stdScript("B", { agreeFromRound: 2 }));
    const events: import("../src/types.js").ConsensusEvent[] = [];
    await new ConsensusEngine({ panel: [a, b], rounds: 3, onEvent: (e) => events.push(e) }).run("q");
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("start");
    expect(types.filter((t) => t === "proposal")).toHaveLength(2);
    expect(types.filter((t) => t === "critique")).toHaveLength(4);
    expect(types.filter((t) => t === "revision")).toHaveLength(2);
    expect(types.filter((t) => t === "synthesis")).toHaveLength(1);
    const { eventToMarkdown } = await import("../src/debatelog.js");
    const md = events.map(eventToMarkdown).filter(Boolean).join("");
    expect(md).toContain("# Debate ");
    expect(md).toContain("## Round 1 — critiques");
    expect(md).toContain("X is wrong");
    expect(md).toContain("## Round 1 — revisions");
    expect(md).toContain("Converged in round 2");
    expect(md).toContain("## Synthesis");
  });
});

describe("follow-up critique rounds", () => {
  it("round 2 shows each critic its own earlier disputes and the author's responses, and converges when no major dispute remains", async () => {
    const { phaseOf, disagreeAll, otherLabels } = await import("./fake.js");
    const prompts: string[] = [];
    const mk = (id: string) => ({
      id, provider: id.split(":")[0]!, model: "m",
      async complete(req: import("../src/types.js").CompletionRequest) {
        const p = phaseOf(req);
        const text = req.messages.at(-1)!.content;
        if (p === "critique") {
          prompts.push(text);
          if (!text.includes("follow-up round")) return { text: disagreeAll(req, "cache TTL is wrong"), usage: { inputTokens: 1, outputTokens: 1 } };
          // follow-up: only a minor point remains
          return { text: JSON.stringify({ self_review: { errors: [], gaps: [] }, reviews: otherLabels(req).map((answer) => ({ answer, verdict: "disagree", strengths: [], disputes: [{ claim: "wording", problem: "nit", correction: "", severity: "minor" }] })) }), usage: { inputTokens: 1, outputTokens: 1 } };
        }
        if (p === "revise") {
          const from = [...text.matchAll(/### From panelist (\w)/g)].map((m) => m[1]);
          return { text: JSON.stringify({ responses: from.map((f) => ({ from: f, claim: "cache TTL is wrong", action: "concede", reason: "fixed" })), position_changed: true, answer: `${id} revised` }), usage: { inputTokens: 1, outputTokens: 1 } };
        }
        return { text: p === "synthesize" ? "# Answer\nok" : `${id} proposal`, usage: { inputTokens: 1, outputTokens: 1 } };
      },
    });
    const run = await new ConsensusEngine({ panel: [mk("a:m"), mk("b:m")], rounds: 3 }).run("q");
    expect(run.converged).toBe(true);
    expect(run.rounds).toHaveLength(2);
    const followUp = prompts.find((t) => t.includes("follow-up round"))!;
    expect(followUp).toContain("You raised:");
    expect(followUp).toContain("[major] cache TTL is wrong");
    expect(followUp).toContain("concede: cache TTL is wrong (fixed)");
  });
});

describe("standalone answer guard", () => {
  it("detects debate references only inside the Answer section", async () => {
    const { debateLeak } = await import("../src/protocol/prompts.js");
    expect(debateLeak("# Answer\nUse A's script with B's fallback.\n\n# Confidence\nhigh")).toBe("A's script");
    expect(debateLeak("# Answer\nAs B argues, fail open.\n# Confidence\nx")).toBe("B argues");
    expect(debateLeak("# Answer\nUse a token bucket. Plan A is fine.\n\n# What changed during review\nAnswer B conceded.")).toBeUndefined();
  });
  it("rewrites a leaking report once and keeps the clean rewrite", async () => {
    const { phaseOf, agreeAll } = await import("./fake.js");
    let synth = 0;
    const mk = (id: string) => ({
      id, provider: id.split(":")[0]!, model: "m",
      async complete(req: import("../src/types.js").CompletionRequest) {
        const p = req.phase ?? phaseOf(req);
        if (p === "critique") return { text: agreeAll(req), usage: { inputTokens: 1, outputTokens: 1 } };
        if (p === "synthesize") return { text: ++synth === 1 ? "# Answer\nAdopt A's design.\n\n# Confidence\nhigh" : "# Answer\nAdopt a token bucket.\n\n# Confidence\nhigh", usage: { inputTokens: 1, outputTokens: 1 } };
        return { text: `${id} proposal`, usage: { inputTokens: 1, outputTokens: 1 } };
      },
    });
    const run = await new ConsensusEngine({ panel: [mk("a:m"), mk("b:m")], rounds: 1 }).run("q");
    expect(synth).toBe(2);
    expect(run.synthesis).toContain("Adopt a token bucket.");
  });
});
