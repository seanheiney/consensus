import { describe, expect, it } from "vitest";
import { withFallbacks } from "../src/fallback.js";
import { ConsensusEngine } from "../src/protocol/engine.js";
import type { CompletionRequest, ConsensusEvent, Panelist } from "../src/types.js";

function fake(id: string, reply: (req: CompletionRequest) => string | Error, billing: "api" | "subscription" = "subscription"): Panelist & { calls: number } {
  const p = {
    id, provider: id.split(":")[0]!, model: id.split(":")[1]!, billing, calls: 0,
    async complete(req: CompletionRequest) {
      p.calls++;
      const r = reply(req);
      if (r instanceof Error) throw r;
      return { text: r, usage: { inputTokens: 10, outputTokens: 5 } };
    },
  };
  return p;
}
const limit = () => new Error("claude error: You've reached your Fable limit.");
const agreeAll = (req: CompletionRequest) => {
  const labels = [...req.messages.at(-1)!.content.matchAll(/### Answer (\w)/g)].map((m) => m[1]);
  return JSON.stringify({ reviews: labels.map((l) => ({ label: l, verdict: "agree", strongest_objection: "none", disputes: [] })) });
};
const seat = (id: string) => fake(id, (req) => (req.phase === "critique" ? agreeAll(req) : "Use a queue."));

describe("captain handoff", () => {
  it("switches to the next candidate on a usage-limit error and stays switched", async () => {
    const a = fake("claude:claude-fable-5-1", limit);
    const b = fake("claude:claude-opus-5", () => "ok");
    const w = withFallbacks([a, b]);
    expect(w.id).toBe("claude:claude-fable-5-1");
    expect((await w.complete({ system: "", messages: [{ role: "user", content: "q" }] })).text).toBe("ok");
    expect(w.id).toBe("claude:claude-opus-5");
    await w.complete({ system: "", messages: [{ role: "user", content: "q" }] });
    expect(a.calls).toBe(1);
    expect(b.calls).toBe(2);
  });

  it("a debate survives an exhausted captain: stand-in reports, handoff is logged, usage attributed", async () => {
    const dead = fake("claude:claude-fable-5-1", limit);
    const standIn = fake("codex:gpt-6-astra", (req) => (req.phase === "synthesize" ? "## Answer\nUse a queue." : "{}"));
    const events: ConsensusEvent[] = [];
    const engine = new ConsensusEngine({ panel: [seat("claude:claude-opus-5"), seat("codex:gpt-5.6-sol")], captain: withFallbacks([dead, standIn]), rounds: 1, onEvent: (e) => events.push(e) });
    const run = await engine.run("Queue or cron?");
    expect(run.synthesis).toContain("Use a queue");
    expect(run.judge).toBe("codex:gpt-6-astra");
    expect(run.captain).toBe("codex:gpt-6-astra");
    expect(events.some((e) => e.type === "handoff" && e.from === "claude:claude-fable-5-1" && e.to === "codex:gpt-6-astra")).toBe(true);
    expect(run.usage["codex:gpt-6-astra"]).toBeDefined();
  });

  it("if the captain and every stand-in fail, a seat writes the report", async () => {
    const events: ConsensusEvent[] = [];
    const engine = new ConsensusEngine({ panel: [seat("claude:claude-opus-5"), seat("codex:gpt-5.6-sol")], captain: fake("claude:claude-fable-5-1", limit), rounds: 1, onEvent: (e) => events.push(e) });
    const run = await engine.run("Queue or cron?");
    expect(run.synthesis).toContain("Use a queue");
    expect(["claude:claude-opus-5", "codex:gpt-5.6-sol"]).toContain(run.judge);
    expect(events.some((e) => e.type === "panelist:error" && e.phase === "synthesize" && /writes the report instead/.test(e.error))).toBe(true);
  });
});
