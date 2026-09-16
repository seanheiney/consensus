/**
 * Benchmark profiles against a suite of problems: wall time, tokens, estimated
 * cost, convergence, and grader-scored accuracy / quality, so users can pick
 * the right profile for the right kind of problem.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { findCatalogModel } from "./catalog.js";
import { PROVIDERS } from "./providers/index.js";
import { ConsensusEngine } from "./protocol/engine.js";
import { extractJson } from "./protocol/json.js";
import { parseSpec } from "./providers/index.js";
export const BenchCaseSchema = z.object({
    id: z.string(),
    prompt: z.string(),
    context: z.string().optional(),
    /** Known-correct answer; enables the accuracy score. */
    expected: z.string().optional(),
    /** What a great answer must contain; guides the quality score. */
    rubric: z.string().optional(),
    tags: z.array(z.string()).optional(),
});
export const BenchSuiteSchema = z.object({
    name: z.string().optional(),
    cases: z.array(BenchCaseSchema).min(1),
});
export const SAMPLE_SUITE = {
    name: "starter",
    cases: [
        {
            id: "digits",
            tags: ["reasoning", "objective"],
            prompt: "How many times does the digit 7 appear when you write out all the page numbers of a 300-page book (pages 1 to 300)? Give the number and show how you counted.",
            expected: "60 (30 in the units place, 30 in the tens place, 0 in the hundreds place).",
        },
        {
            id: "dice",
            tags: ["math", "objective"],
            prompt: "Two fair six-sided dice are rolled. What is the probability that the sum is 7 or 11? Give an exact fraction.",
            expected: "8/36 = 2/9 (six ways to make 7, two ways to make 11).",
        },
        {
            id: "second-largest",
            tags: ["code", "objective"],
            prompt: "Find the bug in this function, which should return the second-largest distinct value in a non-empty array of numbers (or -Infinity if there is none). Explain the failing input and give the fix.",
            context: "function secondLargest(a) {\n  let m1 = -Infinity, m2 = -Infinity;\n  for (const x of a) {\n    if (x > m1) { m2 = m1; m1 = x; }\n    else if (x > m2) { m2 = x; }\n  }\n  return m2;\n}",
            expected: "Duplicates of the maximum are treated as second-largest: [5, 5, 3] returns 5 instead of 3, because the else-if branch runs when x === m1. Fix: `else if (x > m2 && x !== m1)` (or skip x === m1).",
        },
        {
            id: "listener-leak",
            tags: ["debugging", "objective"],
            prompt: "A Node.js HTTP service's memory grows steadily under load until it is OOM-killed, even though request volume is flat. What is the cause and the fix?",
            context: "const bus = new EventEmitter();\napp.get('/status', (req, res) => {\n  bus.on('tick', (t) => res.write(`data: ${t}\\n\\n`));\n  res.writeHead(200, { 'Content-Type': 'text/event-stream' });\n});\nsetInterval(() => bus.emit('tick', Date.now()), 1000);",
            expected: "Every request registers a 'tick' listener on the shared emitter and never removes it; the listener (and the closed res) leaks forever. Fix: remove the listener on req/res 'close' (or use once/AbortSignal), and handle disconnects.",
        },
        {
            id: "pagination",
            tags: ["design", "judgment"],
            prompt: "We have a social feed API over a Postgres table with ~10M rows, sorted by created_at desc, with frequent inserts. Clients page through it. Should we use offset pagination or cursor (keyset) pagination? Decide and justify.",
            rubric: "Recommends keyset/cursor pagination; explains offset drift under inserts and O(offset) cost; specifies a composite cursor (created_at, id) to break ties and the matching index; mentions when offset is still acceptable (small, static, jump-to-page).",
        },
    ],
};
// ---- cost (see cost.ts) ----
export { estimateCost, priceFor } from "./cost.js";
import { estimateCost } from "./cost.js";
function vendorOf(panelistId) {
    const base = panelistId.split("+")[0];
    try {
        const p = parseSpec(base);
        const info = PROVIDERS[p.provider];
        if (info && info.vendor !== "other" && info.vendor !== "openrouter")
            return info.vendor;
        if (p.model)
            return findCatalogModel(p.model)?.vendor;
    }
    catch {
        /* ignore */
    }
    return undefined;
}
function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
// ---- grading ----------------------------------------------------------------
const GradeSchema = z.object({
    grades: z.array(z.object({
        answer: z.string(),
        accuracy: z.number().min(0).max(10).nullable().default(null),
        quality: z.number().min(0).max(10),
        notes: z.string().default(""),
    })),
});
export function gradePrompt(c, answers) {
    const block = answers.map((a) => `### Answer ${a.label}\n\n${a.text.trim()}`).join("\n\n---\n\n");
    return `You are grading answers to a problem. Be strict, consistent, and blind to style.

## Problem

${c.prompt}
${c.context ? `\n### Context\n\n${c.context}\n` : ""}
${c.expected ? `## Reference answer (ground truth)\n\n${c.expected}\n` : "## Reference answer\n\nNone: there is no single correct answer. Set accuracy to null.\n"}
${c.rubric ? `## Rubric for quality\n\n${c.rubric}\n` : ""}
## Answers

${block}

## Scoring

For each answer give:
- accuracy (0-10, or null if there is no reference): 10 = fully correct and consistent with the reference; 0 = wrong conclusion. Partial credit only for partially correct conclusions, not for effort.
- quality (0-10): correctness of reasoning, completeness against the rubric, specificity and actionability, honesty about limits, absence of errors or padding.
- notes: one sentence on the decisive strengths or errors.

Respond with ONLY a JSON object: {"grades": [{"answer": "A", "accuracy": 8, "quality": 7, "notes": "..."}, ...]} with one entry per answer.`;
}
export async function gradeCase(grader, c, answers) {
    // Shuffle (Fisher-Yates) so the grader can't learn a profile order.
    const order = shuffle(answers.map((a, i) => ({ ...a, i })));
    const labeled = order.map((a, i) => ({ ...a, label: String.fromCharCode(65 + i) }));
    const res = await grader.complete({
        system: "You are a meticulous, impartial grader.",
        messages: [{ role: "user", content: gradePrompt(c, labeled) }],
        json: true,
        effort: "high",
        phase: "grade",
    });
    const parsed = GradeSchema.parse(extractJson(res.text));
    const out = {};
    for (const g of parsed.grades) {
        const a = labeled.find((x) => x.label === g.answer);
        if (a)
            out[a.key] = { accuracy: c.expected ? g.accuracy : null, quality: g.quality, notes: g.notes };
    }
    return out;
}
// ---- runner -------------------------------------------------------------------
/** The "# Answer" section of a synthesis, without the confidence/agreement framing. */
export function answerSection(synthesis) {
    const m = synthesis.match(/^#\s*Answer\s*\n([\s\S]*?)(?=^#\s+(?:Confidence|Where the panel agreed|Unresolved|What changed)\b|(?![\s\S]))/m);
    return (m?.[1] ?? synthesis).trim();
}
async function runOne(target, c, o, trial) {
    const t0 = Date.now();
    const base = {
        profile: target.name,
        caseId: c.id,
        trial,
        ok: false,
        ms: 0,
        converged: false,
        rounds: 0,
        usage: { inputTokens: 0, outputTokens: 0 },
        costUsd: null,
        unpriced: [],
        dropped: [],
        answer: "",
        accuracy: null,
        quality: null,
    };
    try {
        if (target.single) {
            // A clean baseline: no panel framing at all, just the question.
            const plain = `${c.prompt.trim()}${c.context?.trim() ? `\n\nContext:\n${c.context.trim()}` : ""}`;
            const res = await target.single.complete({ system: "You are a careful expert. Answer the question completely and give your reasoning.", messages: [{ role: "user", content: plain }], effort: target.effort, phase: "propose" });
            const usage = res.usage ?? { inputTokens: 0, outputTokens: 0 };
            const cost = estimateCost({ [target.single.id]: usage });
            return { ...base, ok: true, ms: Date.now() - t0, converged: false, rounds: 0, usage, costUsd: cost.usd, unpriced: cost.unpriced, dropped: [], answer: res.text };
        }
        const engine = new ConsensusEngine({
            panel: target.panel,
            judge: target.judge,
            rounds: target.rounds,
            effort: target.effort,
            onEvent: (e) => o.engineEvents?.(target.name, c.id, e),
        });
        const run = await engine.run(c.prompt, c.context);
        const usage = Object.values(run.usage).reduce((a, u) => ({ inputTokens: a.inputTokens + u.inputTokens, outputTokens: a.outputTokens + u.outputTokens }), { inputTokens: 0, outputTokens: 0 });
        const cost = estimateCost(run.usage);
        if (o.outDir) {
            const dir = join(o.outDir, "runs", target.name);
            await mkdir(dir, { recursive: true });
            await writeFile(join(dir, `${c.id}${trial ? `.${trial + 1}` : ""}.json`), JSON.stringify(run, null, 2));
        }
        return { ...base, ok: true, ms: Date.now() - t0, converged: run.converged, rounds: run.rounds.length, usage, costUsd: cost.usd, unpriced: cost.unpriced, dropped: Object.keys(run.dropped), answer: run.synthesis, runId: run.id };
    }
    catch (err) {
        return { ...base, ms: Date.now() - t0, error: err.message.split("\n")[0].slice(0, 300) };
    }
}
export async function runBench(o) {
    const startedAt = new Date().toISOString();
    const results = [];
    const trials = Math.max(1, o.trials ?? 1);
    const runProfile = async (target) => {
        for (const c of o.suite.cases) {
            for (let t = 0; t < trials; t++) {
                o.onEvent?.({ type: "case:start", profile: target.name, caseId: c.id });
                const r = await runOne(target, c, o, t);
                results.push(r);
                o.onEvent?.({ type: "case:done", profile: target.name, caseId: c.id, result: r });
            }
        }
    };
    if (o.parallel)
        await Promise.all(o.profiles.map(runProfile));
    else
        for (const t of o.profiles)
            await runProfile(t);
    // Grade each case across profiles in one blind call.
    for (const c of o.suite.cases) {
        const rs = results.filter((r) => r.caseId === c.id && r.ok && r.answer.trim());
        if (!rs.length)
            continue;
        try {
            const key = (r) => `${r.profile}#${r.trial}`;
            const grades = await gradeCase(o.grader, c, rs.map((r) => ({ key: key(r), text: answerSection(r.answer) })));
            for (const r of rs) {
                const g = grades[key(r)];
                if (g) {
                    r.accuracy = g.accuracy;
                    r.quality = g.quality;
                    r.notes = g.notes;
                }
            }
        }
        catch (err) {
            for (const r of rs)
                r.notes = `grading failed: ${err.message.split("\n")[0]}`;
        }
        o.onEvent?.({ type: "grade:done", caseId: c.id });
    }
    const summaries = o.profiles.map((t) => summarize(t.name, results.filter((r) => r.profile === t.name)));
    const gv = vendorOf(o.grader.id);
    const graderOverlap = gv ? o.profiles.filter((t) => (t.single ? [t.single] : t.panel).some((p) => vendorOf(p.id) === gv)).map((t) => t.name) : [];
    const report = { startedAt, suite: o.suite.name ?? "suite", grader: o.grader.id, results, summaries, graderOverlap };
    if (o.outDir) {
        await mkdir(o.outDir, { recursive: true });
        await writeFile(join(o.outDir, "results.json"), JSON.stringify(report, null, 2));
        await writeFile(join(o.outDir, "report.md"), renderBench(report));
    }
    return report;
}
function avg(xs) {
    const v = xs.filter((x) => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
export function summarize(profile, rs) {
    const ok = rs.filter((r) => r.ok);
    const costs = ok.map((r) => r.costUsd);
    return {
        profile,
        cases: rs.length,
        failures: rs.length - ok.length,
        convergedRate: ok.length ? ok.filter((r) => r.converged).length / ok.length : 0,
        avgMs: ok.length ? ok.reduce((a, r) => a + r.ms, 0) / ok.length : 0,
        totalIn: ok.reduce((a, r) => a + r.usage.inputTokens, 0),
        totalOut: ok.reduce((a, r) => a + r.usage.outputTokens, 0),
        totalCostUsd: costs.some((c) => c !== null) ? costs.reduce((a, c) => a + (c ?? 0), 0) : null,
        avgAccuracy: avg(ok.map((r) => r.accuracy)),
        avgQuality: avg(ok.map((r) => r.quality)),
    };
}
const f1 = (n, suffix = "") => (n === null ? "—" : `${n.toFixed(1)}${suffix}`);
const usd = (n) => (n === null ? "—" : `$${n.toFixed(2)}`);
export function renderBench(r) {
    const lines = [
        `# Benchmark: ${r.suite}`,
        "",
        `_${r.results.length} runs across ${r.summaries.length} arm${r.summaries.length === 1 ? "" : "s"}, graded blind by ${r.grader}. Cost is the equivalent API list price; subscription seats do not bill per token, and a seat that reports no usage is excluded and listed below, not counted as $0. Started ${r.startedAt}._`,
        ...(r.graderOverlap?.length ? ["", `**Grader bias warning:** the grader shares a model vendor with: ${r.graderOverlap.join(", ")}. LLM judges favour their own family; re-run with a grader from another vendor before trusting gaps involving these arms.`] : []),
        ...(r.summaries.some((s) => s.profile.startsWith("single:")) ? ["", "_Arms named `single:<model>` are baselines: one model answering once with no debate._"] : []),
        "",
        "| Arm | Accuracy | Quality | Converged | Avg time | Tokens in / out | Est. cost | Failures |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ];
    for (const s of r.summaries) {
        const conv = s.profile.startsWith("single:") ? "n/a" : `${Math.round(s.convergedRate * 100)}%`;
        lines.push(`| ${s.profile} | ${f1(s.avgAccuracy, "/10")} | ${f1(s.avgQuality, "/10")} | ${conv} | ${(s.avgMs / 1000).toFixed(0)}s | ${s.totalIn.toLocaleString("en-US")} / ${s.totalOut.toLocaleString("en-US")} | ${usd(s.totalCostUsd)} | ${s.failures} |`);
    }
    lines.push("", "## Per case", "", "| Case | Profile | Accuracy | Quality | Converged | Rounds | Time | Est. cost | Notes |", "|---|---|---:|---:|---:|---:|---:|---:|---|");
    for (const x of r.results) {
        lines.push(x.ok
            ? `| ${x.caseId}${x.trial ? ` (trial ${x.trial + 1})` : ""} | ${x.profile} | ${f1(x.accuracy)} | ${f1(x.quality)} | ${x.converged ? "yes" : "no"} | ${x.rounds} | ${(x.ms / 1000).toFixed(0)}s | ${usd(x.costUsd)} | ${(x.notes ?? "").replace(/\|/g, "/")}${x.dropped.length ? ` (dropped: ${x.dropped.join(", ")})` : ""} |`
            : `| ${x.caseId}${x.trial ? ` (trial ${x.trial + 1})` : ""} | ${x.profile} | — | — | — | — | ${(x.ms / 1000).toFixed(0)}s | — | FAILED: ${(x.error ?? "").replace(/\|/g, "/")} |`);
    }
    const unpriced = [...new Set(r.results.flatMap((x) => x.unpriced))];
    if (unpriced.length)
        lines.push("", `_Seats excluded from cost (no usage reported or no list price; subscription CLIs bill quota): ${unpriced.join(", ")}. Totals above understate real spend by these seats._`);
    lines.push("", "## Reading this", "", "- **Accuracy** is scored only for cases with a reference answer; **quality** covers reasoning, completeness, specificity, and honesty. Both are one grader's opinion: run with `--trials` or a different `--grader` before trusting small gaps.", "- Pick by problem type: objective cases reward cheaper profiles more often than judgment cases do. Compare per-case rows, not just the averages.");
    return lines.join("\n");
}
export async function loadSuite(path) {
    return BenchSuiteSchema.parse(JSON.parse(await readFile(path, "utf8")));
}
