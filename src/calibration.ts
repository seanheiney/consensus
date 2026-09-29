/**
 * Calibration: is the panel's confidence worth anything? `consensus outcome`
 * records what actually happened after a run's decision was acted on, in
 * `outcome.json` next to the run so it travels with it; `consensus calibration`
 * scores those outcomes by what the run claimed at the time (stated
 * confidence, convergence, open disputes, profile or panel).
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openDisputes, statedConfidence } from "./escalate.js";
import { listRuns } from "./store.js";
import type { ConsensusRun } from "./types.js";

export const OUTCOMES = ["right", "wrong", "partial"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Score per outcome: partial counts as half right. */
export const OUTCOME_SCORE: Record<Outcome, number> = { right: 1, partial: 0.5, wrong: 0 };

/** Below this many outcomes a bucket's accuracy is noise. */
export const MIN_N = 5;

export const OUTCOME_FILE = "outcome.json";

export interface OutcomeEntry {
  outcome: Outcome;
  note?: string;
  recordedAt: string;
}

/** outcome.json: the current verdict on top, every verdict ever recorded (oldest first) in `history`. */
export interface OutcomeRecord extends OutcomeEntry {
  runId: string;
  history: OutcomeEntry[];
}

export function parseOutcome(v: string): Outcome {
  const o = v.trim().toLowerCase();
  if (!OUTCOMES.includes(o as Outcome)) throw new Error(`Unknown outcome "${v}". Use right, wrong or partial.`);
  return o as Outcome;
}

/** The recorded outcome of a run directory, if one was recorded. */
export async function readOutcome(runDir: string): Promise<OutcomeRecord | undefined> {
  try {
    return JSON.parse(await readFile(join(runDir, OUTCOME_FILE), "utf8")) as OutcomeRecord;
  } catch {
    return undefined;
  }
}

/** Resolve a run id (or "latest") to its directory, with an actionable error for an unknown id. */
async function findRunDir(id: string | undefined, dir: string): Promise<{ id: string; dir: string; run: ConsensusRun }> {
  const runs = await listRuns(dir);
  if (!runs.length) throw new Error(`No saved runs in ${dir}. Outcomes are recorded against a saved run; run the panel first (without --no-save).`);
  const hit = !id || id === "latest" ? runs[0] : runs.find((r) => r.id === id);
  if (!hit) throw new Error(`No saved run "${id}" in ${dir}. List runs with \`consensus runs\`, or pass "latest".`);
  const run = JSON.parse(await readFile(join(hit.dir, "run.json"), "utf8")) as ConsensusRun;
  return { id: hit.id, dir: hit.dir, run };
}

/**
 * Record what happened for a saved run. Re-recording replaces the current
 * verdict and appends to the history, so a change of mind stays visible.
 */
export async function recordOutcome(
  id: string | undefined,
  outcome: Outcome,
  o: { note?: string; dir?: string; now?: Date } = {},
): Promise<{ record: OutcomeRecord; previous?: OutcomeEntry; file: string; run: ConsensusRun }> {
  const found = await findRunDir(id, o.dir ?? ".consensus/runs");
  const prior = await readOutcome(found.dir);
  const entry: OutcomeEntry = { outcome, ...(o.note ? { note: o.note } : {}), recordedAt: (o.now ?? new Date()).toISOString() };
  const record: OutcomeRecord = { runId: found.id, ...entry, history: [...(prior?.history ?? []), entry] };
  const file = join(found.dir, OUTCOME_FILE);
  await writeFile(file, JSON.stringify(record, null, 2) + "\n");
  return { record, previous: prior ? { outcome: prior.outcome, note: prior.note, recordedAt: prior.recordedAt } : undefined, file, run: found.run };
}

/** One run with a recorded outcome, reduced to what calibration buckets on. */
export interface CalibrationRow {
  runId: string;
  when: string;
  outcome: Outcome;
  confidence: "high" | "medium" | "low" | "unstated";
  converged: boolean;
  openDisputes: number;
  /** The profile the run used when it recorded one, else its seat list. */
  panel: string;
  profile?: string;
}

export function rowFor(run: ConsensusRun, outcome: OutcomeRecord): CalibrationRow {
  return {
    runId: run.id,
    when: run.finishedAt ?? run.startedAt,
    outcome: outcome.outcome,
    confidence: statedConfidence(run.synthesis) ?? "unstated",
    converged: run.converged,
    openDisputes: openDisputes(run).length,
    panel: run.profile ?? run.seats.map((s) => s.id).sort().join(", "),
    ...(run.profile ? { profile: run.profile } : {}),
  };
}

/** Every saved run with a recorded outcome, optionally narrowed to a profile and a recent window. */
export async function collectOutcomes(dir = ".consensus/runs", o: { profile?: string; sinceDays?: number; now?: Date } = {}): Promise<CalibrationRow[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const cutoff = o.sinceDays !== undefined ? (o.now ?? new Date()).getTime() - o.sinceDays * 86_400_000 : undefined;
  const rows: CalibrationRow[] = [];
  for (const id of names.sort()) {
    const outcome = await readOutcome(join(dir, id));
    if (!outcome || !OUTCOMES.includes(outcome.outcome)) continue;
    let run: ConsensusRun;
    try {
      run = JSON.parse(await readFile(join(dir, id, "run.json"), "utf8")) as ConsensusRun;
    } catch {
      continue;
    }
    const row = rowFor(run, outcome);
    if (o.profile && row.profile !== o.profile) continue;
    if (cutoff !== undefined && !(Date.parse(row.when) >= cutoff)) continue;
    rows.push(row);
  }
  return rows;
}

export interface Bucket {
  label: string;
  n: number;
  right: number;
  partial: number;
  wrong: number;
  /** Mean score (partial = 0.5), 0..1; null when the bucket is empty. */
  accuracy: number | null;
  /** True when n is below MIN_N and the accuracy should not be read as a rate. */
  thin: boolean;
}

export interface CalibrationReport {
  total: Bucket;
  byConfidence: Bucket[];
  byConvergence: Bucket[];
  byDisputes: Bucket[];
  byPanel: Bucket[];
}

export function bucket(label: string, rows: CalibrationRow[]): Bucket {
  const count = (o: Outcome) => rows.filter((r) => r.outcome === o).length;
  const score = rows.reduce((s, r) => s + OUTCOME_SCORE[r.outcome], 0);
  return { label, n: rows.length, right: count("right"), partial: count("partial"), wrong: count("wrong"), accuracy: rows.length ? score / rows.length : null, thin: rows.length < MIN_N };
}

export function calibrate(rows: CalibrationRow[]): CalibrationReport {
  const panels = [...new Set(rows.map((r) => r.panel))].sort();
  const byConfidence = (["high", "medium", "low", "unstated"] as const).map((c) => bucket(c, rows.filter((r) => r.confidence === c)));
  return {
    total: bucket("all", rows),
    // "unstated" only shows up when some run actually lacked a confidence line.
    byConfidence: byConfidence.filter((b) => b.label !== "unstated" || b.n > 0),
    byConvergence: [bucket("converged", rows.filter((r) => r.converged)), bucket("not converged", rows.filter((r) => !r.converged))],
    byDisputes: [bucket("0 open disputes", rows.filter((r) => r.openDisputes === 0)), bucket("1+ open disputes", rows.filter((r) => r.openDisputes > 0))],
    byPanel: panels.map((p) => bucket(p, rows.filter((r) => r.panel === p))),
  };
}

function pct(b: Bucket): string {
  if (b.accuracy === null) return "—";
  return `${Math.round(b.accuracy * 100)}%`;
}

function line(b: Bucket, width: number): string {
  const counts = b.n ? `${b.right} right, ${b.partial} partial, ${b.wrong} wrong` : "no outcomes";
  const note = b.n === 0 ? "" : b.thin ? `  (n=${b.n}: too few to mean anything)` : "";
  return `  ${b.label.padEnd(width)}  ${pct(b).padStart(4)}  n=${String(b.n).padEnd(3)} ${counts}${note}`;
}

/** Whether higher stated confidence actually went with better outcomes, stated only when the data can carry it. */
function confidenceVerdict(r: CalibrationReport): string | undefined {
  const scored = r.byConfidence.filter((b) => b.label !== "unstated" && !b.thin && b.accuracy !== null);
  if (scored.length < 2) return `Not enough outcomes per confidence level to judge calibration yet (need ${MIN_N} in at least two levels).`;
  for (let i = 1; i < scored.length; i++) {
    if (scored[i]!.accuracy! > scored[i - 1]!.accuracy!) return `Confidence is not tracking outcomes: "${scored[i]!.label}" runs scored better than "${scored[i - 1]!.label}" ones. Weigh the confidence line accordingly.`;
  }
  return "Higher stated confidence has gone with better outcomes so far.";
}

export function renderCalibration(r: CalibrationReport, o: { profile?: string; sinceDays?: number } = {}): string {
  const scope = [o.profile ? `profile ${o.profile}` : "", o.sinceDays !== undefined ? `last ${o.sinceDays} day(s)` : ""].filter(Boolean).join(", ");
  if (!r.total.n) {
    return `No recorded outcomes${scope ? ` (${scope})` : ""}. After acting on a panel's answer, record how it went: \`consensus outcome <run-id|latest> right|wrong|partial [--note <text>]\`.`;
  }
  const all = [r.total, ...r.byConfidence, ...r.byConvergence, ...r.byDisputes, ...r.byPanel];
  const width = Math.min(48, Math.max(...all.map((b) => b.label.length)));
  const out = [
    `Calibration over ${r.total.n} run${r.total.n === 1 ? "" : "s"} with recorded outcomes${scope ? ` (${scope})` : ""}. Accuracy counts partial as half right.`,
    "",
    line(r.total, width),
    "",
    "By stated confidence:",
    ...r.byConfidence.map((b) => line(b, width)),
    "",
    "By convergence:",
    ...r.byConvergence.map((b) => line(b, width)),
    "",
    "By major disputes open at the end:",
    ...r.byDisputes.map((b) => line(b, width)),
    "",
    "By profile (or panel, for runs without one):",
    ...r.byPanel.map((b) => line(b, width)),
    "",
  ];
  const verdict = confidenceVerdict(r);
  if (verdict) out.push(verdict);
  if (r.total.thin) out.push(`With only ${r.total.n} outcome${r.total.n === 1 ? "" : "s"} recorded, none of these rates means anything yet; keep recording.`);
  return out.join("\n");
}
