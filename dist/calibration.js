/**
 * Calibration: is the panel's confidence worth anything? `consensus outcome`
 * records what actually happened after a run's decision was acted on, in
 * `outcome.json` next to the run so it travels with it; `consensus calibration`
 * scores those outcomes by what the run claimed at the time (stated
 * confidence, convergence, open disputes, profile or panel).
 */
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openDisputes, statedConfidence } from "./escalate.js";
import { listRuns } from "./store.js";
export const OUTCOMES = ["right", "wrong", "partial"];
/** Score per outcome: partial counts as half right. */
export const OUTCOME_SCORE = { right: 1, partial: 0.5, wrong: 0 };
/** Below this many outcomes a bucket's accuracy is noise. */
export const MIN_N = 5;
export const OUTCOME_FILE = "outcome.json";
export function parseOutcome(v) {
    const o = v.trim().toLowerCase();
    if (!OUTCOMES.includes(o))
        throw new Error(`Unknown outcome "${v}". Use right, wrong or partial.`);
    return o;
}
/**
 * The recorded outcome of a run directory, if one was recorded. The file
 * travels with the run and may be written by hand, so a record without a usable
 * verdict counts as none, and a missing history is rebuilt from the verdict.
 */
export async function readOutcome(runDir) {
    let raw;
    try {
        raw = JSON.parse(await readFile(join(runDir, OUTCOME_FILE), "utf8"));
    }
    catch {
        return undefined;
    }
    if (!raw || typeof raw !== "object" || !OUTCOMES.includes(raw.outcome))
        return undefined;
    const entry = { outcome: raw.outcome, ...(typeof raw.note === "string" && raw.note ? { note: raw.note } : {}), recordedAt: typeof raw.recordedAt === "string" ? raw.recordedAt : "" };
    const history = Array.isArray(raw.history) && raw.history.length ? raw.history : [entry];
    return { runId: typeof raw.runId === "string" ? raw.runId : "", ...entry, history };
}
/** Resolve a run id (or "latest") to its directory, with an actionable error for an unknown id. */
async function findRunDir(id, dir) {
    const runs = await listRuns(dir);
    if (!runs.length)
        throw new Error(`No saved runs in ${dir}. Outcomes are recorded against a saved run; run the panel first (without --no-save).`);
    // Accept the path a result printed (".consensus/runs/<id>/debate.md") as well as the bare id.
    const hit = !id || id === "latest" ? runs[0] : runs.find((r) => r.id === id) ?? runs.find((r) => id.split(/[\\/]/).includes(r.id));
    if (!hit)
        throw new Error(`No saved run "${id}" in ${dir}. List runs with \`consensus runs\`, or pass "latest".`);
    const run = JSON.parse(await readFile(join(hit.dir, "run.json"), "utf8"));
    return { id: hit.id, dir: hit.dir, run };
}
/**
 * Record what happened for a saved run. Re-recording replaces the current
 * verdict and appends to the history, so a change of mind stays visible.
 */
export async function recordOutcome(id, outcome, o = {}) {
    const found = await findRunDir(id, o.dir ?? ".consensus/runs");
    const prior = await readOutcome(found.dir);
    const entry = { outcome, ...(o.note ? { note: o.note } : {}), recordedAt: (o.now ?? new Date()).toISOString() };
    const record = { runId: found.id, ...entry, history: [...(prior?.history ?? []), entry] };
    const file = join(found.dir, OUTCOME_FILE);
    // Write then rename, so an interrupted write never leaves a truncated file that would drop the history.
    await writeFile(`${file}.tmp`, JSON.stringify(record, null, 2) + "\n");
    await rename(`${file}.tmp`, file);
    return { record, previous: prior ? { outcome: prior.outcome, note: prior.note, recordedAt: prior.recordedAt } : undefined, file, run: found.run };
}
/**
 * The profile a finished run is filed under for calibration: the escalation
 * target when the run was promoted to it, otherwise the profile it was resolved from.
 */
export function runProfile(run, resolved, escalateTo) {
    return run.escalation && escalateTo ? escalateTo : resolved;
}
export function rowFor(run, outcome) {
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
export async function collectOutcomes(dir = ".consensus/runs", o = {}) {
    let names;
    try {
        names = await readdir(dir);
    }
    catch {
        return [];
    }
    const cutoff = o.sinceDays !== undefined ? (o.now ?? new Date()).getTime() - o.sinceDays * 86_400_000 : undefined;
    const rows = [];
    for (const id of names.sort()) {
        const outcome = await readOutcome(join(dir, id));
        if (!outcome)
            continue;
        let run;
        try {
            run = JSON.parse(await readFile(join(dir, id, "run.json"), "utf8"));
        }
        catch {
            continue;
        }
        const row = rowFor(run, outcome);
        if (o.profile && row.profile !== o.profile)
            continue;
        if (cutoff !== undefined && !(Date.parse(row.when) >= cutoff))
            continue;
        rows.push(row);
    }
    return rows;
}
export function bucket(label, rows) {
    const count = (o) => rows.filter((r) => r.outcome === o).length;
    const score = rows.reduce((s, r) => s + OUTCOME_SCORE[r.outcome], 0);
    return { label, n: rows.length, right: count("right"), partial: count("partial"), wrong: count("wrong"), accuracy: rows.length ? score / rows.length : null, thin: rows.length < MIN_N };
}
export function calibrate(rows) {
    const panels = [...new Set(rows.map((r) => r.panel))].sort();
    const byConfidence = ["high", "medium", "low", "unstated"].map((c) => bucket(c, rows.filter((r) => r.confidence === c)));
    return {
        total: bucket("all", rows),
        // "unstated" only shows up when some run actually lacked a confidence line.
        byConfidence: byConfidence.filter((b) => b.label !== "unstated" || b.n > 0),
        byConvergence: [bucket("converged", rows.filter((r) => r.converged)), bucket("not converged", rows.filter((r) => !r.converged))],
        byDisputes: [bucket("0 open disputes", rows.filter((r) => r.openDisputes === 0)), bucket("1+ open disputes", rows.filter((r) => r.openDisputes > 0))],
        byPanel: panels.map((p) => bucket(p, rows.filter((r) => r.panel === p))),
    };
}
function pct(b) {
    if (b.accuracy === null)
        return "—";
    return `${Math.round(b.accuracy * 100)}%`;
}
function line(b, width) {
    const counts = b.n ? `${b.right} right, ${b.partial} partial, ${b.wrong} wrong` : "no outcomes";
    const note = b.n === 0 ? "" : b.thin ? `  (n=${b.n}: too few to mean anything)` : "";
    return `  ${b.label.padEnd(width)}  ${pct(b).padStart(4)}  n=${String(b.n).padEnd(3)} ${counts}${note}`;
}
/** Whether higher stated confidence actually went with better outcomes, stated only when the data can carry it. */
function confidenceVerdict(r) {
    const scored = r.byConfidence.filter((b) => b.label !== "unstated" && !b.thin && b.accuracy !== null);
    if (scored.length < 2)
        return `Not enough outcomes per confidence level to judge calibration yet (need ${MIN_N} in at least two levels).`;
    for (let i = 1; i < scored.length; i++) {
        if (scored[i].accuracy > scored[i - 1].accuracy)
            return `Confidence is not tracking outcomes: "${scored[i].label}" runs scored better than "${scored[i - 1].label}" ones. Weigh the confidence line accordingly.`;
    }
    // Ties are not evidence of calibration: say so rather than credit the confidence line.
    for (let i = 1; i < scored.length; i++) {
        if (scored[i].accuracy === scored[i - 1].accuracy)
            return `No difference yet: "${scored[i - 1].label}" and "${scored[i].label}" runs scored the same, so the confidence line is not telling outcomes apart.`;
    }
    return "Higher stated confidence has gone with better outcomes so far.";
}
export function renderCalibration(r, o = {}) {
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
    if (verdict)
        out.push(verdict);
    if (r.total.thin)
        out.push(`With only ${r.total.n} outcome${r.total.n === 1 ? "" : "s"} recorded, none of these rates means anything yet; keep recording.`);
    return out.join("\n");
}
