import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MIN_N, bucket, calibrate, collectOutcomes, parseOutcome, readOutcome, recordOutcome, renderCalibration, type CalibrationRow } from "../src/calibration.js";
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
