import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adrSlug, adrTitle, nextAdrNumber, renderAdr } from "../src/adr.js";
import { runKey } from "../src/runkey.js";
import { findReusableRun, saveRun } from "../src/store.js";
import type { ConsensusRun } from "../src/types.js";

function run(over: Partial<ConsensusRun> = {}): ConsensusRun {
  return {
    schemaVersion: 1,
    id: "20260924T120000Z-abc123",
    startedAt: "2026-09-24T12:00:00Z",
    finishedAt: "2026-09-24T12:20:00Z",
    prompt: "Should we use optimistic locking or a distributed lock for inventory holds? Explain the tradeoff.",
    options: { rounds: 2, defaultEffort: "high" },
    labels: { A: "claude:opus", B: "codex:sol" },
    seats: [
      { id: "claude:opus", label: "A", provider: "claude", model: "opus" },
      { id: "codex:sol", label: "B", provider: "codex", model: "sol", persona: "skeptic" },
    ],
    proposals: {},
    rounds: [{ round: 1, critiques: {}, converged: true }],
    finalAnswers: {},
    converged: true,
    judge: "claude:opus",
    synthesis: "# Answer\n\nOptimistic locking.\n\n# Confidence\n\nHigh.\n\n# Unresolved disagreements\n\nWhether to shard at 10k writes/s.\n",
    usage: {},
    dropped: {},
    ...over,
  };
}

describe("adr", () => {
  it("titles and slugs from the question", () => {
    expect(adrTitle(run().prompt)).toBe("Should we use optimistic locking or a distributed lock for inventory holds?");
    expect(adrSlug(run().prompt)).toBe("use-optimistic-locking-distributed-lock-inventory-holds");
  });

  it("renders the decision, the dissent and the provenance", () => {
    const md = renderAdr(run(), { number: 7, runDir: ".consensus/runs/x" });
    expect(md).toContain("# 0007. Should we use optimistic locking");
    expect(md).toContain("- **Status:** Proposed");
    expect(md).toContain("## Decision\n\nOptimistic locking.");
    expect(md).toContain("Whether to shard at 10k writes/s.");
    expect(md).toContain("- codex:sol (skeptic)");
    expect(md).toContain("consensus log 20260924T120000Z-abc123");
    expect(md).toContain("agreement, not proof");
  });

  it("says plainly when the panel never converged", () => {
    const md = renderAdr(run({ converged: false, synthesis: "# Answer\n\nx\n" }), { number: 1, status: "Accepted" });
    expect(md).toContain("- **Status:** Accepted");
    expect(md).toContain("unresolved after 1 round");
    expect(md).toContain("The panel did not converge");
  });

  it("carries the grounding check when one ran", () => {
    const md = renderAdr(run({ verification: { by: "claude:opus", claims: [{ claim: "locks are session-scoped", support: "unsupported", evidence: "" }], note: "" } }), { number: 2 });
    expect(md).toContain("## Grounding check");
    expect(md).toContain("**unsupported**: locks are session-scoped");
  });

  it("numbers records after the ones already there", async () => {
    const dir = await mkdtemp(join(tmpdir(), "consensus-adr-"));
    expect(await nextAdrNumber(join(dir, "nope"))).toBe(1);
    await mkdir(join(dir, "decisions"), { recursive: true });
    for (const f of ["0001-a.md", "0004-b.md", "notes.md"]) await writeFile(join(dir, "decisions", f), "x");
    expect(await nextAdrNumber(join(dir, "decisions"))).toBe(5);
  });
});

describe("reuse", () => {
  const parts = { prompt: "Same question?", seats: ["b:m", "a:m"], rounds: 2, effort: "high" };

  it("keys on the question, the panel and the settings, not on formatting", () => {
    expect(runKey(parts)).toBe(runKey({ ...parts, prompt: "Same\n  question?  ", seats: ["a:m", "b:m"] }));
    expect(runKey(parts)).not.toBe(runKey({ ...parts, rounds: 3 }));
    expect(runKey(parts)).not.toBe(runKey({ ...parts, seats: ["a:m", "c:m"] }));
    expect(runKey(parts)).not.toBe(runKey({ ...parts, context: "extra" }));
  });

  it("finds a recent saved answer to the same question and ignores an older one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "consensus-runs-"));
    const key = runKey(parts);
    await saveRun(run({ id: "20260901T000000Z-old", key, finishedAt: new Date(Date.now() - 40 * 86400000).toISOString() }), dir);
    expect(await findReusableRun(key, 30, dir)).toBeUndefined();

    const fresh = run({ id: "20260924T000000Z-new", key, finishedAt: new Date(Date.now() - 2 * 86400000).toISOString() });
    await saveRun(fresh, dir);
    const hit = await findReusableRun(key, 30, dir);
    expect(hit?.run.id).toBe("20260924T000000Z-new");
    expect(Math.round(hit!.ageDays)).toBe(2);
    expect(await findReusableRun("someotherkey", 30, dir)).toBeUndefined();
  });
});
