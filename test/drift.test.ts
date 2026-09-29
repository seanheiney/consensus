import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderAdr } from "../src/adr.js";
import type { Config, ResolvedRun } from "../src/config.js";
import { panelChooser, parseAdr, recheckAdrs, recheckExitCode, seatSpec, type RecheckDeps } from "../src/drift.js";
import { ConsensusEngine } from "../src/protocol/engine.js";
import type { CompletionRequest, ConsensusRun, Panelist } from "../src/types.js";
import { agreeAll, fakePanelist, phaseOf } from "./fake.js";

function run(over: Partial<ConsensusRun> = {}): ConsensusRun {
  return {
    schemaVersion: 1,
    id: "20260101T120000Z-orig01",
    startedAt: "2026-01-01T12:00:00Z",
    finishedAt: "2026-01-01T12:20:00Z",
    prompt: "Should we use optimistic locking or a distributed lock for inventory holds?",
    context: "We run Postgres 17 and hold carts for 10 minutes.",
    options: { rounds: 2, defaultEffort: "high" },
    labels: { A: "claude:opus", B: "codex:sol+skeptic" },
    seats: [
      { id: "claude:opus", label: "A", provider: "claude", model: "opus", effort: "high" },
      { id: "codex:sol+skeptic", label: "B", provider: "codex", model: "sol", effort: "max", persona: "skeptic" },
    ],
    proposals: {},
    rounds: [{ round: 1, critiques: {}, converged: true }],
    finalAnswers: {},
    converged: true,
    judge: "claude:opus",
    synthesis: "# Answer\n\nOptimistic locking with a version column.\n\n# Confidence\n\nHigh.\n",
    usage: {},
    dropped: {},
    profile: "balanced",
    ...over,
  };
}

/** A two-seat fake panel whose synthesis says `answer`, and a judge that returns `verdict` for the drift call. */
function panel(answer: string, verdict: "unchanged" | "refined" | "changed") {
  const script = (req: CompletionRequest): string => {
    if (req.phase === "grade") return JSON.stringify({ verdict, delta: `The new answer is ${verdict} relative to the record.` });
    switch (phaseOf(req)) {
      case "propose":
        return answer;
      case "critique":
        return agreeAll(req);
      case "synthesize":
        return `# Answer\n\n${answer}\n\n# Confidence\n\nMedium.\n`;
      default:
        throw new Error(`unexpected ${phaseOf(req)}`);
    }
  };
  const a = fakePanelist("a:m", script);
  const b = fakePanelist("b:m", script);
  const resolved: ResolvedRun = { panel: [a, b], judge: a, rounds: 1, effort: "high", source: "profile", profile: "balanced" };
  return { a, b, resolved, calls: () => a.calls.length + b.calls.length };
}

function deps(resolved: ResolvedRun, saved?: ConsensusRun, prompts: { prompt: string; context?: string }[] = []): RecheckDeps {
  return {
    choosePanel: async () => ({ resolved, source: 'recorded profile "balanced"' }),
    runPanel: (r, prompt, context) => {
      prompts.push({ prompt, context });
      return new ConsensusEngine({ panel: r.panel, judge: r.judge, rounds: r.rounds, effort: r.effort }).run(prompt, context);
    },
    loadSavedRun: async (id) => (saved && saved.id === id ? saved : undefined),
    now: () => new Date("2026-09-28T09:00:00Z"),
  };
}

async function adrFile(text: string, name = "0001-locking.md"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "consensus-drift-"));
  const file = join(dir, name);
  await writeFile(file, text);
  return file;
}

describe("adr marker", () => {
  it("records what a recheck needs, and not the context itself", () => {
    const md = renderAdr(run({ contextFile: "docs/inventory.md" }), { number: 1 });
    const adr = parseAdr(md)!;
    expect(adr.runId).toBe("20260101T120000Z-orig01");
    expect(adr.meta).toMatchObject({ profile: "balanced", panel: ["claude:opus#high", "codex:sol#max+skeptic"], rounds: 2, context: "given", contextFile: "docs/inventory.md" });
    expect(md).not.toContain("Postgres 17");
    expect(adr.question).toBe(run().prompt);
    expect(adr.decision).toBe("Optimistic locking with a version column.");
  });

  it("reads records written before the marker existed", () => {
    const md = renderAdr(run(), { number: 1 }).replace(/<!-- consensus-adr .* -->\n/, "");
    const adr = parseAdr(md)!;
    expect(adr.meta).toBeUndefined();
    expect(adr.runId).toBe("20260101T120000Z-orig01");
    expect(adr.panel).toEqual(["claude:opus", "codex:sol+skeptic"]);
  });

  it("seat specs round-trip effort and persona", () => {
    expect(seatSpec({ id: "groq:openai/gpt-oss-120b+risk", label: "A", provider: "groq", model: "openai/gpt-oss-120b", effort: "low", persona: "risk" })).toBe("groq:openai/gpt-oss-120b#low+risk");
  });
});

describe("adr --recheck", () => {
  it("unchanged: appends a dated section, keeps the original as a byte prefix, exits 0", async () => {
    const original = renderAdr(run(), { number: 1 });
    const file = await adrFile(original);
    const p = panel("Optimistic locking still.", "unchanged");
    const seen: { prompt: string; context?: string }[] = [];
    const results = await recheckAdrs([file], { deps: deps(p.resolved, run(), seen) });

    expect(results[0]).toMatchObject({ status: "unchanged", confidence: "medium", panelSource: 'recorded profile "balanced"' });
    expect(recheckExitCode(results)).toBe(0);
    // The saved run supplied the original question and context.
    expect(seen[0]).toEqual({ prompt: run().prompt, context: run().context });
    // One judge call, strict structured output, comparing against the recorded decision.
    const judged = p.a.calls.filter((c) => c.phase === "grade");
    expect(judged).toHaveLength(1);
    expect(judged[0]!.jsonSchema).toBeDefined();
    expect(judged[0]!.messages[0]!.content).toContain("Optimistic locking with a version column.");

    const after = await readFile(file, "utf8");
    expect(after.startsWith(original)).toBe(true);
    const added = after.slice(original.length);
    expect(added).toContain("## Rechecked 2026-09-28");
    expect(added).toContain("- **Verdict:** unchanged");
    expect(added).toContain("- **Panel:** a:m, b:m (recorded profile \"balanced\")");
    expect(added).toContain("- **New confidence:** medium");
    expect(added).toContain(`consensus log ${results[0]!.runId}`);
    expect(added).not.toContain("**Context:**");
  });

  it("changed: exits 1, and a second recheck still compares against the original decision", async () => {
    const original = renderAdr(run(), { number: 1 });
    const file = await adrFile(original);
    const p = panel("Use a distributed lock in Redis.", "changed");
    const results = await recheckAdrs([file], { deps: deps(p.resolved, run()) });
    expect(results[0]!.status).toBe("changed");
    expect(recheckExitCode(results)).toBe(1);

    const once = await readFile(file, "utf8");
    const adr = parseAdr(once)!;
    expect(adr.decision).toBe("Optimistic locking with a version column.");
    expect(adr.rechecks).toEqual([{ date: "2026-09-28", verdict: "changed", run: results[0]!.runId }]);

    const q = panel("Optimistic locking.", "refined");
    const again = await recheckAdrs([file], { deps: deps(q.resolved, run()) });
    expect(recheckExitCode(again)).toBe(0);
    const twice = await readFile(file, "utf8");
    expect(twice.startsWith(once)).toBe(true);
    expect(twice.startsWith(original)).toBe(true);
    expect(q.a.calls.find((c) => c.phase === "grade")!.messages[0]!.content).toContain("Optimistic locking with a version column.");
  });

  it("skips records consensus did not write, without touching them or calling a model", async () => {
    const text = "# 0002. Use Postgres\n\n## Decision\n\nWe use Postgres.\n";
    const file = await adrFile(text, "0002-postgres.md");
    const p = panel("x", "unchanged");
    const results = await recheckAdrs([file], { deps: deps(p.resolved) });
    expect(results[0]).toMatchObject({ status: "skipped" });
    expect(results[0]!.reason).toContain("not written by `consensus adr`");
    expect(recheckExitCode(results)).toBe(0);
    expect(await readFile(file, "utf8")).toBe(text);
    expect(p.calls()).toBe(0);
  });

  it("dry run lists the record and its panel and makes zero model calls", async () => {
    const original = renderAdr(run(), { number: 1 });
    const file = await adrFile(original);
    const p = panel("x", "changed");
    let ran = 0;
    const d = deps(p.resolved, run());
    const results = await recheckAdrs([file], { dryRun: true, deps: { ...d, runPanel: (...a) => (ran++, d.runPanel(...a)) } });
    expect(results[0]).toMatchObject({ status: "planned", panel: ["a:m", "b:m"], panelSource: 'recorded profile "balanced"' });
    expect(ran).toBe(0);
    expect(p.calls()).toBe(0);
    expect(recheckExitCode(results)).toBe(0);
    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("rechecks with the question alone when the context cannot be recovered, and says so", async () => {
    const original = renderAdr(run(), { number: 1 }).trimEnd(); // no trailing newline: still a prefix afterwards
    const file = await adrFile(original);
    const p = panel("Optimistic locking.", "unchanged");
    const seen: { prompt: string; context?: string }[] = [];
    const results = await recheckAdrs([file], { deps: deps(p.resolved, undefined, seen) });
    expect(seen[0]).toEqual({ prompt: run().prompt, context: undefined });
    expect(results[0]!.contextNote).toContain("could not be recovered");
    const after = await readFile(file, "utf8");
    expect(after.startsWith(original)).toBe(true);
    expect(after).toContain("- **Context:** The original context was not stored and could not be recovered");
    expect(after).toContain("question alone");
  });

  it("re-reads a recorded context file when the saved run is gone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "consensus-drift-ctx-"));
    const ctx = join(dir, "inventory.md");
    await writeFile(ctx, "carts hold for 15 minutes now");
    const file = await adrFile(renderAdr(run({ contextFile: ctx }), { number: 1 }));
    const p = panel("Optimistic locking.", "unchanged");
    const seen: { prompt: string; context?: string }[] = [];
    const results = await recheckAdrs([file], { deps: deps(p.resolved, undefined, seen) });
    expect(seen[0]!.context).toBe("carts hold for 15 minutes now");
    expect(results[0]!.contextNote).toContain("may have changed since");
  });

  it("does not claim missing context when the original had none", async () => {
    const file = await adrFile(renderAdr(run({ context: undefined }), { number: 1 }));
    const p = panel("Optimistic locking.", "unchanged");
    const results = await recheckAdrs([file], { deps: deps(p.resolved) });
    expect(results[0]!.contextNote).toBeUndefined();
  });

  it("reports an unparseable verdict as a failure and leaves the record alone", async () => {
    const original = renderAdr(run(), { number: 1 });
    const file = await adrFile(original);
    const bad = fakePanelist("a:m", (req) => (req.phase === "grade" ? "no idea" : phaseOf(req) === "critique" ? agreeAll(req) : "# Answer\n\nx\n"));
    const b = fakePanelist("b:m", (req) => (phaseOf(req) === "critique" ? agreeAll(req) : "x"));
    const results = await recheckAdrs([file], { deps: deps({ panel: [bad, b], judge: bad, rounds: 1, effort: "high", source: "flags" }, run()) });
    expect(results[0]).toMatchObject({ status: "error" });
    expect(recheckExitCode(results)).toBe(3);
    expect(bad.calls.filter((c) => c.phase === "grade")).toHaveLength(1);
    expect(await readFile(file, "utf8")).toBe(original);
  });
});

describe("recheck panel choice", () => {
  const env = { ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "y" };
  const cfg: Config = {
    captain: "none",
    profile: "keys",
    profiles: { keys: { panel: ["anthropic:claude-opus-5", "openai:gpt-5.6-sol"], captain: "none" } },
  };
  const ids = (p: Panelist[]) => p.map((x) => x.id);

  it("seats the recorded panel when every seat still resolves", async () => {
    const adr = parseAdr(renderAdr(run({ profile: undefined, seats: [
      { id: "anthropic:claude-sonnet-5", label: "A", provider: "anthropic", model: "claude-sonnet-5" },
      { id: "openai:gpt-5.6-sol", label: "B", provider: "openai", model: "gpt-5.6-sol" },
    ] }), { number: 1 }))!;
    const choice = await panelChooser({ cfg, env, statuses: async () => [] })(adr);
    expect(choice.source).toBe("recorded panel");
    expect(choice.note).toBeUndefined();
    expect(ids(choice.resolved.panel)).toEqual(["anthropic:claude-sonnet-5", "openai:gpt-5.6-sol"]);
  });

  it("falls back to the active profile when a recorded seat no longer resolves, and says which", async () => {
    // The recorded profile is gone and the claude / codex CLIs are not installed here.
    const adr = parseAdr(renderAdr(run({ profile: "old-team" }), { number: 1 }))!;
    const choice = await panelChooser({ cfg, env, statuses: async () => [] })(adr);
    expect(choice.source).toBe('active profile "keys"');
    expect(choice.note).toContain('profile "old-team"');
    expect(choice.note).toContain("no longer resolves");
    expect(choice.note).toContain("claude:opus");
    expect(ids(choice.resolved.panel)).toEqual(["anthropic:claude-opus-5", "openai:gpt-5.6-sol"]);
  });

  it("--profile wins over what the record says", async () => {
    const adr = parseAdr(renderAdr(run(), { number: 1 }))!;
    const choice = await panelChooser({ cfg: { ...cfg, profile: undefined }, profile: "keys", env, statuses: async () => [] })(adr);
    expect(choice.source).toBe('--profile "keys"');
  });
});
