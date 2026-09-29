import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MIN_N, bucket, calibrate, collectOutcomes, parseOutcome, readOutcome, recordOutcome, renderCalibration, runProfile, type CalibrationRow } from "../src/calibration.js";
import { createMcpServer } from "../src/mcp.js";
import { saveRun } from "../src/store.js";
import type { ConsensusRun, RoundRecord } from "../src/types.js";

const disputed: RoundRecord = {
  round: 1,
  converged: false,
  critiques: { A: { self_review: { errors: [], gaps: [] }, reviews: [{ answer: "B", verdict: "disagree", strengths: [], disputes: [{ claim: "x", problem: "y", correction: "z", severity: "major" }] }] } },
};

function run(id: string, over: Partial<ConsensusRun> = {}, confidence = "High"): ConsensusRun {
  return {
    schemaVersion: 1,
    id,
    startedAt: "2026-09-20T12:00:00Z",
    finishedAt: "2026-09-20T12:20:00Z",
    prompt: "Which lock?",
    options: { rounds: 2, defaultEffort: "high" },
    labels: { A: "claude:opus", B: "codex:sol" },
    seats: [
      { id: "claude:opus", label: "A", provider: "claude", model: "opus" },
      { id: "codex:sol", label: "B", provider: "codex", model: "sol" },
    ],
    proposals: {},
    rounds: [{ round: 1, critiques: {}, converged: true }],
    finalAnswers: {},
    converged: true,
    judge: "claude:opus",
    synthesis: `# Answer\n\nOptimistic locking.\n\n# Confidence\n\n${confidence} — because.\n`,
    usage: {},
    dropped: {},
    ...over,
  };
}

function row(over: Partial<CalibrationRow>): CalibrationRow {
  return { runId: "r", when: "2026-09-20T12:00:00Z", outcome: "right", confidence: "high", converged: true, openDisputes: 0, panel: "p", ...over };
}

async function runsDir(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "consensus-cal-")), "runs");
}

describe("outcome recording", () => {
  it("writes outcome.json next to the run and resolves latest", async () => {
    const dir = await runsDir();
    await saveRun(run("20260920T120000Z-aaa"), dir);
    await saveRun(run("20260921T120000Z-bbb"), dir);
    const { record, previous, file } = await recordOutcome("latest", "right", { note: "held up", dir, now: new Date("2026-09-28T00:00:00Z") });
    expect(file).toBe(join(dir, "20260921T120000Z-bbb", "outcome.json"));
    expect(previous).toBeUndefined();
    expect(record).toMatchObject({ runId: "20260921T120000Z-bbb", outcome: "right", note: "held up", recordedAt: "2026-09-28T00:00:00.000Z" });
    expect(JSON.parse(await readFile(file, "utf8")).history).toHaveLength(1);
  });

  it("re-recording overwrites the verdict and keeps a timestamped history", async () => {
    const dir = await runsDir();
    await saveRun(run("20260920T120000Z-aaa"), dir);
    await recordOutcome("20260920T120000Z-aaa", "right", { dir, now: new Date("2026-09-21T00:00:00Z") });
    const second = await recordOutcome("20260920T120000Z-aaa", "partial", { dir, note: "rollback needed", now: new Date("2026-09-25T00:00:00Z") });
    expect(second.previous).toMatchObject({ outcome: "right", recordedAt: "2026-09-21T00:00:00.000Z" });
    const saved = await readOutcome(join(dir, "20260920T120000Z-aaa"));
    expect(saved?.outcome).toBe("partial");
    expect(saved?.note).toBe("rollback needed");
    expect(saved?.history.map((h) => [h.outcome, h.recordedAt])).toEqual([
      ["right", "2026-09-21T00:00:00.000Z"],
      ["partial", "2026-09-25T00:00:00.000Z"],
    ]);
  });

  it("names an unknown run id and says how to find a real one", async () => {
    const dir = await runsDir();
    await saveRun(run("20260920T120000Z-aaa"), dir);
    await expect(recordOutcome("nope", "wrong", { dir })).rejects.toThrow(/No saved run "nope".*consensus runs/);
    await expect(recordOutcome("latest", "wrong", { dir: join(dir, "missing") })).rejects.toThrow(/No saved runs/);
  });

  it("accepts the run path a result printed, not just the bare id", async () => {
    const dir = await runsDir();
    await saveRun(run("20260920T120000Z-aaa"), dir);
    await saveRun(run("20260921T120000Z-bbb"), dir);
    const { record } = await recordOutcome(".consensus/runs/20260920T120000Z-aaa/debate.md", "right", { dir });
    expect(record.runId).toBe("20260920T120000Z-aaa");
    await expect(recordOutcome("../20260920T120000Z-aaa-x/debate.md", "right", { dir })).rejects.toThrow(/No saved run/);
  });

  it("keeps a hand-written verdict without history when re-recording, and ignores an unusable file", async () => {
    const dir = await runsDir();
    await saveRun(run("20260920T120000Z-aaa"), dir);
    await saveRun(run("20260921T120000Z-bbb"), dir);
    await writeFile(join(dir, "20260920T120000Z-aaa", "outcome.json"), JSON.stringify({ outcome: "right" }));
    const second = await recordOutcome("20260920T120000Z-aaa", "wrong", { dir, now: new Date("2026-09-25T00:00:00Z") });
    expect(second.previous).toMatchObject({ outcome: "right", recordedAt: "" });
    expect(second.record.history.map((h) => h.outcome)).toEqual(["right", "wrong"]);
    await writeFile(join(dir, "20260921T120000Z-bbb", "outcome.json"), JSON.stringify({ outcome: "RIGHT-ish" }));
    expect(await readOutcome(join(dir, "20260921T120000Z-bbb"))).toBeUndefined();
    expect((await collectOutcomes(dir)).map((r) => r.runId)).toEqual(["20260920T120000Z-aaa"]);
  });

  it("rejects an outcome word it does not know", () => {
    expect(parseOutcome("Partial")).toBe("partial");
    expect(() => parseOutcome("maybe")).toThrow(/right, wrong or partial/);
  });
});

describe("calibration math", () => {
  it("scores partial as half right", () => {
    const b = bucket("x", [row({ outcome: "right" }), row({ outcome: "partial" }), row({ outcome: "wrong" }), row({ outcome: "partial" })]);
    expect(b).toMatchObject({ n: 4, right: 1, partial: 2, wrong: 1, accuracy: 0.5, thin: true });
    expect(bucket("empty", []).accuracy).toBeNull();
  });

  it("buckets by confidence, convergence, disputes and panel", () => {
    const rows = [
      row({ confidence: "high", outcome: "right", panel: "frontier" }),
      row({ confidence: "high", outcome: "wrong", panel: "frontier" }),
      row({ confidence: "low", outcome: "wrong", converged: false, openDisputes: 2, panel: "groq-fast" }),
    ];
    const r = calibrate(rows);
    expect(r.total.accuracy).toBeCloseTo(1 / 3);
    expect(r.byConfidence.map((b) => [b.label, b.n])).toEqual([["high", 2], ["medium", 0], ["low", 1]]);
    expect(r.byConvergence.map((b) => [b.label, b.n, b.accuracy])).toEqual([["converged", 2, 0.5], ["not converged", 1, 0]]);
    expect(r.byDisputes.map((b) => b.n)).toEqual([2, 1]);
    expect(r.byPanel.map((b) => [b.label, b.n])).toEqual([["frontier", 2], ["groq-fast", 1]]);
  });

  it("says plainly when n is too small to mean anything", () => {
    const text = renderCalibration(calibrate([row({}), row({ outcome: "wrong", confidence: "low" })]));
    expect(text).toContain("n=1: too few to mean anything");
    expect(text).toContain("none of these rates means anything yet");
    expect(text).toContain("Not enough outcomes per confidence level");
  });

  it("calls out confidence that does not track outcomes once n is large enough", () => {
    const rows = [
      ...Array.from({ length: MIN_N }, () => row({ confidence: "high", outcome: "wrong" })),
      ...Array.from({ length: MIN_N }, () => row({ confidence: "low", outcome: "right" })),
    ];
    const text = renderCalibration(calibrate(rows));
    expect(text).toContain('"low" runs scored better than "high"');
    expect(text).not.toContain("none of these rates means anything");
    const good = renderCalibration(calibrate([...Array.from({ length: MIN_N }, () => row({ confidence: "high" })), ...Array.from({ length: MIN_N }, () => row({ confidence: "low", outcome: "wrong" }))]));
    expect(good).toContain("Higher stated confidence has gone with better outcomes");
  });

  it("does not credit the confidence line when levels scored the same", () => {
    const rows = [...Array.from({ length: MIN_N }, () => row({ confidence: "high" })), ...Array.from({ length: MIN_N }, () => row({ confidence: "medium" }))];
    const text = renderCalibration(calibrate(rows));
    expect(text).toContain('No difference yet: "high" and "medium" runs scored the same');
    expect(text).not.toContain("Higher stated confidence has gone with better outcomes");
  });

  it("points at `consensus outcome` when nothing is recorded", () => {
    expect(renderCalibration(calibrate([]))).toMatch(/No recorded outcomes.*consensus outcome/);
  });
});

describe("collecting outcomes from saved runs", () => {
  it("reads confidence, disputes and profile from run.json and filters", async () => {
    const dir = await runsDir();
    await saveRun(run("20260901T000000Z-old", { startedAt: "2026-09-01T00:00:00Z", finishedAt: "2026-09-01T00:10:00Z", profile: "frontier" }), dir);
    await saveRun(run("20260920T000000Z-mid", { converged: false, rounds: [disputed], profile: "groq-fast" }, "Medium"), dir);
    await saveRun(run("20260921T000000Z-new", {}, "Moderate"), dir);
    await saveRun(run("20260922T000000Z-none"), dir); // no outcome: ignored
    await recordOutcome("20260901T000000Z-old", "right", { dir });
    await recordOutcome("20260920T000000Z-mid", "wrong", { dir });
    await recordOutcome("20260921T000000Z-new", "partial", { dir });

    const all = await collectOutcomes(dir);
    expect(all.map((r) => [r.runId, r.confidence, r.openDisputes, r.panel])).toEqual([
      ["20260901T000000Z-old", "high", 0, "frontier"],
      ["20260920T000000Z-mid", "medium", 1, "groq-fast"],
      ["20260921T000000Z-new", "medium", 0, "claude:opus, codex:sol"],
    ]);
    expect((await collectOutcomes(dir, { profile: "groq-fast" })).map((r) => r.runId)).toEqual(["20260920T000000Z-mid"]);
    expect((await collectOutcomes(dir, { sinceDays: 14, now: new Date("2026-09-28T00:00:00Z") })).map((r) => r.runId)).toEqual(["20260920T000000Z-mid", "20260921T000000Z-new"]);
    expect(await collectOutcomes(join(dir, "missing"))).toEqual([]);
  });
});

describe("profile attribution", () => {
  it("files an escalated run under the escalation target and others under the resolved profile", () => {
    const escalated = run("r", { escalation: { fromRunId: "f", fromSeats: ["groq:x"], reason: "did not converge", firstPassConverged: false } });
    expect(runProfile(escalated, "groq-fast", "frontier")).toBe("frontier");
    expect(runProfile(run("r"), "groq-fast", "frontier")).toBe("groq-fast");
    expect(runProfile(run("r"), undefined)).toBeUndefined();
  });
});

describe("consensus_outcome MCP tool", () => {
  it("records against a saved run and reports an unknown id as a tool error", async () => {
    const root = await mkdtemp(join(tmpdir(), "consensus-cal-mcp-"));
    const dir = join(root, "runs");
    await saveRun(run("20260920T120000Z-aaa"), dir);
    await writeFile(join(root, "consensus.config.json"), JSON.stringify({ runsDir: dir }));
    const cwd = process.cwd();
    process.chdir(root);
    const client = new Client({ name: "test", version: "0" });
    try {
      const [a, b] = InMemoryTransport.createLinkedPair();
      await Promise.all([createMcpServer().connect(a), client.connect(b)]);
      const ok = (await client.callTool({ name: "consensus_outcome", arguments: { run_id: "latest", outcome: "partial", note: "half of it held" } })) as { isError?: boolean; content: { text: string }[] };
      expect(ok.isError).toBeFalsy();
      expect(ok.content[0]!.text).toContain("Recorded partial for run 20260920T120000Z-aaa");
      expect(await readOutcome(join(dir, "20260920T120000Z-aaa"))).toMatchObject({ outcome: "partial", note: "half of it held" });
      const bad = (await client.callTool({ name: "consensus_outcome", arguments: { run_id: "nope", outcome: "right" } })) as { isError?: boolean; content: { text: string }[] };
      expect(bad.isError).toBe(true);
      expect(bad.content[0]!.text).toMatch(/No saved run "nope"/);
    } finally {
      await client.close();
      process.chdir(cwd);
    }
  });
});
