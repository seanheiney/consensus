import { describe, expect, it } from "vitest";
import { ConsensusEngine } from "../src/protocol/engine.js";
import { agreeAll, disagreeAll, fakePanelist, phaseOf } from "./fake.js";
import type { CompletionRequest, ConsensusEvent } from "../src/types.js";
import { resolveRun } from "../src/config.js";

function isModerate(req: CompletionRequest): boolean {
  return req.messages[0]!.content.includes("Your task as captain");
}
const seat = (name: string, agreeFrom: number) => {
  let n = 0;
  return (req: CompletionRequest) => {
    const p = phaseOf(req);
    if (p === "critique") return ++n >= agreeFrom ? agreeAll(req) : disagreeAll(req);
    if (p === "revise") return JSON.stringify({ responses: [{ from: "B", claim: "X is wrong", action: "concede", reason: "ok" }], position_changed: true, answer: `${name} revised` });
    if (p === "synthesize") return `synth by ${name}`;
    return `${name} answer`;
  };
};
const brief = (extra = false, questionSeat?: string) =>
  JSON.stringify({ settled: ["S1"], key_disputes: [{ topic: "T", positions: "A says x, B says y", ruling: "A is right because z", ask: "address z" }], guidance: "focus", questions_for_seats: questionSeat ? [{ seat: questionSeat, question: "Q?" }] : [], request_extra_round: extra });

describe("captain", () => {
  it("moderates after a disputed round, its brief reaches the revise prompt, and it writes the synthesis by default", async () => {
    const a = fakePanelist("a:m", seat("A", 2));
    const b = fakePanelist("b:m", seat("B", 2));
    const cap = fakePanelist("cap:m", (req) => (isModerate(req) ? brief() : "captain report"));
    const events: ConsensusEvent[] = [];
    const run = await new ConsensusEngine({ panel: [a, b], captain: cap, rounds: 3, onEvent: (e) => events.push(e) }).run("q");
    expect(run.captain).toBe("cap:m");
    expect(run.judge).toBe("cap:m");
    expect(run.synthesis).toBe("captain report");
    expect(events.some((e) => e.type === "moderation")).toBe(true);
    expect(run.rounds[0]!.moderation?.key_disputes[0]!.ruling).toContain("A is right");
    const revise = a.calls.find((c) => phaseOf(c) === "revise")!;
    expect(revise.messages[0]!.content).toContain("Captain's brief");
    expect(revise.messages[0]!.content).toContain("A is right because z");
    expect(cap.calls[0]!.phase).toBe("moderate");
    expect(cap.calls[0]!.system).toContain("captain of a panel");
    expect(cap.calls.at(-1)!.phase).toBe("synthesize");
    expect(run.usage["cap:m"]).toBeDefined();
  });

  it("puts direct questions to the addressed seat only", async () => {
    const a = fakePanelist("a:m", seat("A", 2));
    const b = fakePanelist("b:m", seat("B", 2));
    const cap = fakePanelist("cap:m", (req) => (isModerate(req) ? brief(false, "__LABEL__") : "r"));
    // We don't know labels ahead; make the captain address whichever label A gets by peeking at the moderator prompt.
    cap.complete = async (req) => {
      if (isModerate(req)) {
        const first = req.messages[0]!.content.match(/### Answer (\w)/)![1]!;
        return { text: brief(false, first) };
      }
      return { text: "r" };
    };
    const run = await new ConsensusEngine({ panel: [a, b], captain: cap, rounds: 2 }).run("q");
    const asked = Object.entries(run.labels).find(([l]) => l === run.rounds[0]!.moderation!.questions_for_seats![0]!.seat)![1];
    const askedSeat = asked === "a:m" ? a : b;
    const other = asked === "a:m" ? b : a;
    expect(askedSeat.calls.find((c) => phaseOf(c) === "revise")!.messages[0]!.content).toContain("The captain asks YOU directly");
    expect(other.calls.find((c) => phaseOf(c) === "revise")!.messages[0]!.content).not.toContain("asks YOU directly");
  });

  it("may grant exactly one extra round on the last scheduled round", async () => {
    const a = fakePanelist("a:m", seat("A", 99));
    const b = fakePanelist("b:m", seat("B", 99));
    const cap = fakePanelist("cap:m", (req) => (isModerate(req) ? brief(true) : "r"));
    const events: ConsensusEvent[] = [];
    const run = await new ConsensusEngine({ panel: [a, b], captain: cap, rounds: 2, onEvent: (e) => events.push(e) }).run("q");
    expect(events.filter((e) => e.type === "extra-round")).toHaveLength(1);
    expect(run.rounds).toHaveLength(3);
    expect(run.converged).toBe(false);
  });

  it("a named judge still writes the report while the captain moderates", async () => {
    const a = fakePanelist("a:m", seat("A", 2));
    const b = fakePanelist("b:m", seat("B", 2));
    const cap = fakePanelist("cap:m", (req) => (isModerate(req) ? brief() : "captain report"));
    const run = await new ConsensusEngine({ panel: [a, b], captain: cap, judge: b, rounds: 2 }).run("q");
    expect(run.judge).toBe("b:m");
    expect(run.synthesis).toBe("synth by B");
    expect(run.captain).toBe("cap:m");
  });

  it("resolveRun defaults to captain auto and honours captain none", async () => {
    const env = { ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k", PATH: "/nonexistent" };
    const r = await resolveRun({ cfg: {}, env, panel: ["anthropic:claude-opus-5", "openai:gpt-5.6-sol"] });
    expect(r.captain).toBeDefined();
    expect(r.judge.id).toBe(r.captain!.id);
    const none = await resolveRun({ cfg: {}, env, panel: ["anthropic:claude-opus-5", "openai:gpt-5.6-sol"], captain: "none" });
    expect(none.captain).toBeUndefined();
    expect(none.judge.id).toBe("anthropic:claude-opus-5");
  });
});

describe("captain stalemate", () => {
  it("ends the debate after a follow-up round when the captain sets stop_debate", async () => {
    const { phaseOf, disagreeAll, revision } = await import("./fake.js");
    const seat = (id: string) => ({
      id, provider: id.split(":")[0]!, model: "m",
      async complete(req: import("../src/types.js").CompletionRequest) {
        const p = phaseOf(req);
        const text = p === "critique" ? disagreeAll(req) : p === "revise" ? revision(`${id} revised`) : p === "synthesize" ? "# Answer\nok" : `${id} proposal`;
        return { text, usage: { inputTokens: 1, outputTokens: 1 } };
      },
    });
    let briefs = 0;
    const captain = {
      id: "cap:m", provider: "cap", model: "m",
      async complete(req: import("../src/types.js").CompletionRequest) {
        if (req.phase === "moderate") { briefs++; return { text: JSON.stringify({ settled: [], key_disputes: [], guidance: "", questions_for_seats: [], request_extra_round: false, stop_debate: briefs >= 2 }), usage: { inputTokens: 1, outputTokens: 1 } }; }
        return { text: "# Answer\nreport", usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    const events: string[] = [];
    const run = await new (await import("../src/protocol/engine.js")).ConsensusEngine({ panel: [seat("a:m"), seat("b:m")], captain, rounds: 5, onEvent: (e) => events.push(e.type) }).run("q");
    expect(run.rounds).toHaveLength(2);
    expect(run.converged).toBe(false);
    expect(events).toContain("stalemate");
    expect(run.synthesis).toContain("report");
  });
});
