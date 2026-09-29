/**
 * `consensus check`: disagreement as a cheap uncertainty signal.
 *
 * Every seat answers once, independently and in parallel, with a short final
 * answer and a one-line rationale. One cheap comparison step (the captain or
 * judge when there is one, plain normalized comparison otherwise) groups the
 * answers into positions. No critique, no revision, no synthesis: the output is
 * how much the models agree and whether a human should look.
 *
 * Exit codes (see checkExitCode): 0 unanimous, 1 not unanimous (a human should
 * look), 2 no signal (fewer than two seats answered, or the check failed).
 */
import { z } from "zod";
import { describeCost, estimateCost } from "./cost.js";
import { extractJson } from "./protocol/json.js";
import { problemBlock } from "./protocol/prompts.js";
import { toStrictJsonSchema } from "./protocol/engine.js";
import { TransientError } from "./types.js";
const TRANSIENT = /429|rate.?limit|overloaded|529|503|timeout|timed out|ECONNRESET|EPIPE|temporar|try again|SIGTERM/i;
const LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const CheckAnswerSchema = z.object({
    answer: z.string().min(1),
    rationale: z.string(),
});
export const CheckGroupingSchema = z.object({
    positions: z.array(z.object({ answer: z.string(), members: z.array(z.string()) })),
});
const CHECK_SYSTEM = `You are one of several independent AI models answering the same question separately. Nobody sees your reasoning, only your final answer and one line of rationale, which are compared with the other models' answers to detect disagreement. Commit to the answer you actually believe is right. Do not hedge to sound agreeable, and do not mention which company or model you are.`;
const COMPARER_SYSTEM = `You compare short answers from independent AI models to the same question and group them into positions. Two answers share a position when a reader acting on either would do the same thing: same choice, same verdict, same number within rounding, the same claim in different words. Different conclusions, recommendations or values are different positions, however similar the wording. You do not judge which answer is right.`;
export function checkPrompt(prompt, context) {
    return `${problemBlock(prompt, context)}

## Your task

Answer the problem once. Give your final answer as briefly as it can be stated: a word, a number, a choice, or at most one short sentence. Then give a one-line rationale. If the problem is underspecified, answer under the most reasonable assumption and name it in the rationale.

Respond with ONLY a JSON object of this shape:

{"answer": "<your final answer, as short as possible>", "rationale": "<one line: why>"}`;
}
export function comparePrompt(prompt, answers) {
    return `## Question the models were asked

${prompt.trim()}

## Their answers

${answers.map((a) => `- ${a.label}: ${a.answer}${a.rationale ? `  (rationale: ${a.rationale})` : ""}`).join("\n")}

## Your task

Group the answers into positions. Every label must appear in exactly one position. Give each position a short neutral statement of what its members answered.

Respond with ONLY a JSON object of this shape:

{"positions": [{"answer": "<the position in a few words>", "members": ["A", "C"]}]}`;
}
/** Lowercase, strip accents, punctuation, articles and filler so trivially different spellings compare equal. */
export function normalizeAnswer(text) {
    const t = text
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/(\d),(?=\d{3}\b)/g, "$1")
        .replace(/(\d)\.0+\b/g, "$1")
        .replace(/[^\p{L}\p{N}.%\s-]/gu, " ")
        .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^(the|a|an)\s+/, "");
    if (/^(yes|y|true|correct|affirmative)$/.test(t))
        return "yes";
    if (/^(no|n|false|incorrect|negative)$/.test(t))
        return "no";
    return t;
}
function oneLine(text) {
    return text.replace(/\s+/g, " ").trim();
}
/** Short enough that exact comparison after normalization is meaningful (a word, a number, a choice). */
export function isCategorical(answers) {
    return answers.every((a) => normalizeAnswer(a).split(" ").length <= 6);
}
/** Group by normalized text. Order: largest first, ties in the order seats answered. */
export function groupPlain(answers) {
    const groups = new Map();
    for (const a of answers) {
        const key = normalizeAnswer(a.answer);
        const g = groups.get(key);
        if (g)
            g.seats.push(a.seat);
        else
            groups.set(key, { answer: a.answer.trim(), seats: [a.seat] });
    }
    return sortPositions([...groups.values()]);
}
function sortPositions(p) {
    return p.map((x, i) => ({ x, i })).sort((a, b) => b.x.seats.length - a.x.seats.length || a.i - b.i).map(({ x }) => x);
}
/** unanimous: one position. majority: the largest holds more than half the seats that answered. split: otherwise. */
export function agreementOf(positions, answered) {
    if (answered < 2)
        return "insufficient";
    if (positions.length === 1)
        return "unanimous";
    return positions[0].seats.length * 2 > answered ? "majority" : "split";
}
/** 0 unanimous; 1 majority or split (a human should look); 2 no signal (fewer than two seats answered). */
export function checkExitCode(r) {
    return r.agreement === "unanimous" ? 0 : r.agreement === "insufficient" ? 2 : 1;
}
function addUsage(into, p, u) {
    if (!u)
        return;
    const cur = (into[p.id] ??= { inputTokens: 0, outputTokens: 0, billing: p.billing });
    cur.inputTokens += u.inputTokens;
    cur.outputTokens += u.outputTokens;
    if (u.cacheReadTokens)
        cur.cacheReadTokens = (cur.cacheReadTokens ?? 0) + u.cacheReadTokens;
    if (u.costUsd !== undefined)
        cur.costUsd = (cur.costUsd ?? 0) + u.costUsd;
}
/** One JSON call with a single repair attempt, as the engine does for structured phases. */
async function callJson(p, system, content, schema, phase, o, usage, effort) {
    const jsonSchema = toStrictJsonSchema(schema);
    const ask = async (messages) => {
        const res = await p.complete({ system, messages, json: true, jsonSchema, effort: effort ?? o.effort, maxTokens: o.maxTokens, signal: o.signal, phase });
        addUsage(usage, p, res.usage);
        return res.text;
    };
    const messages = [{ role: "user", content }];
    const first = await ask(messages);
    try {
        return schema.parse(extractJson(first));
    }
    catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        const second = await ask([...messages, { role: "assistant", content: first }, { role: "user", content: `Your previous response could not be used: ${why.slice(0, 800)}\n\nRespond again with ONLY the JSON object, matching the requested shape exactly. No prose, no code fences.` }]);
        return schema.parse(extractJson(second));
    }
}
/** Validate a model grouping against the labels it was given: every answer in exactly one position, no invented labels. */
function applyGrouping(grouping, byLabel) {
    const answerOf = (seat) => [...byLabel.values()].find((a) => a.seat === seat).answer;
    const seen = new Set();
    const positions = [];
    for (const pos of grouping.positions) {
        const seats = [];
        for (const raw of pos.members) {
            const label = raw.replace(/^(answer|seat)\s+/i, "").trim().toUpperCase();
            const a = byLabel.get(label);
            if (!a)
                return { error: `grouped an unknown answer "${raw}"` };
            if (seen.has(label))
                return { error: `put answer ${label} in two positions` };
            seen.add(label);
            seats.push(a.seat);
        }
        if (seats.length)
            positions.push({ answer: oneLine(pos.answer) || answerOf(seats[0]), seats });
    }
    const missing = [...byLabel.keys()].filter((l) => !seen.has(l));
    if (missing.length)
        return { error: `left answer${missing.length === 1 ? "" : "s"} ${missing.join(", ")} out of every position` };
    return sortPositions(positions);
}
/** Ask every seat once, compare, and report agreement. Seat failures drop that seat; they never count as a position. */
export async function runCheck(prompt, context, o) {
    if (!o.panel.length)
        throw new Error("A check needs at least one seat; pass --panel or --profile.");
    const ids = o.panel.map((p) => p.id);
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup)
        throw new Error(`Seat "${dup}" appears twice. Give duplicate models different personas (e.g. claude+skeptic) or use --variants.`);
    const emit = o.onEvent ?? (() => { });
    const startedAt = new Date().toISOString();
    const usage = {};
    const dropped = {};
    const answered = new Map();
    await Promise.all(o.panel.map(async (p) => {
        const t0 = Date.now();
        const once = () => callJson(p, CHECK_SYSTEM, checkPrompt(prompt, context), CheckAnswerSchema, "propose", o, usage);
        try {
            let a;
            try {
                a = await once();
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (o.retry === false || o.signal?.aborted || !(err instanceof TransientError || TRANSIENT.test(msg)))
                    throw err;
                await new Promise((r) => setTimeout(r, o.retryDelayMs ?? 4000));
                a = await once();
            }
            // One line each: a newline in an answer could forge a labeled line in the comparer's prompt, or a line in CI outputs.
            answered.set(p.id, { seat: p.id, answer: oneLine(a.answer), rationale: oneLine(a.rationale.trim().split("\n")[0]) });
            emit({ type: "seat:done", seat: p.id, ms: Date.now() - t0 });
        }
        catch (err) {
            const error = (err instanceof Error ? err.message : String(err)).split("\n")[0];
            dropped[p.id] = error;
            emit({ type: "seat:error", seat: p.id, error });
        }
    }));
    if (o.signal?.aborted)
        throw new Error("Check aborted.");
    // Seat order, not completion order, so output is stable.
    const answers = ids.flatMap((id) => (answered.has(id) ? [answered.get(id)] : []));
    let positions = groupPlain(answers);
    let comparedBy = "plain";
    let comparisonNote;
    if (answers.length >= 2 && positions.length > 1) {
        const spent = estimateCost(usage).usd ?? 0;
        if (o.compare === "plain")
            comparisonNote = "plain comparison requested";
        else if (!o.comparer)
            comparisonNote = "no captain or judge to compare with";
        else if (o.maxCostUsd !== undefined && spent > o.maxCostUsd)
            comparisonNote = `skipped the comparer: billed spend $${spent.toFixed(4)} is over the $${o.maxCostUsd} ceiling`;
        else {
            const byLabel = new Map(answers.map((a, i) => [LABELS[i], a]));
            emit({ type: "compare", by: o.comparer.id });
            try {
                const grouping = await callJson(o.comparer, COMPARER_SYSTEM, comparePrompt(prompt, [...byLabel].map(([label, a]) => ({ label, answer: a.answer, rationale: a.rationale }))), CheckGroupingSchema, "moderate", o, usage, "low");
                const applied = applyGrouping(grouping, byLabel);
                if ("error" in applied)
                    comparisonNote = `the comparer ${applied.error}; fell back to plain comparison`;
                else {
                    positions = applied;
                    comparedBy = o.comparer.id;
                }
            }
            catch (err) {
                if (o.signal?.aborted)
                    throw new Error("Check aborted.");
                comparisonNote = `the comparer failed (${(err instanceof Error ? err.message : String(err)).split("\n")[0]}); fell back to plain comparison`;
            }
        }
        if (comparedBy === "plain" && !isCategorical(answers.map((a) => a.answer)))
            comparisonNote = `${comparisonNote ? `${comparisonNote}; ` : ""}the answers are long, so any wording difference counts as disagreement`;
    }
    const agreement = agreementOf(positions, answers.length);
    const c = estimateCost(usage);
    return {
        kind: "check",
        schemaVersion: 1,
        startedAt,
        finishedAt: new Date().toISOString(),
        prompt,
        context,
        seats: ids,
        answers,
        dropped,
        positions,
        agreement,
        needsHuman: agreement !== "unanimous",
        comparedBy,
        comparisonNote,
        usage,
        cost: { billedUsd: c.usd, subscriptionEquivUsd: c.subscriptionEquivUsd, unpriced: c.unpriced, summary: describeCost(c) },
    };
}
/** Plain-text report: agreement, verdict, positions with their seats and rationales, dropped seats. */
export function renderCheck(r) {
    const n = r.answers.length;
    const droppedIds = Object.keys(r.dropped);
    const scope = droppedIds.length ? ` (${n} of ${r.seats.length} seats answered)` : ` (${n} seat${n === 1 ? "" : "s"})`;
    const lines = [`Agreement: ${r.agreement}${scope}`, `Needs human: ${r.needsHuman ? "yes" : "no"}`, ""];
    if (r.positions.length) {
        lines.push("Positions:");
        r.positions.forEach((p, i) => {
            lines.push(`${i + 1}. ${p.answer} (${p.seats.length} of ${n})`);
            for (const s of p.seats) {
                const a = r.answers.find((x) => x.seat === s);
                lines.push(`   - ${s}: ${a?.answer ?? ""}${a?.rationale ? ` — ${a.rationale}` : ""}`);
            }
        });
        lines.push("");
    }
    if (droppedIds.length) {
        lines.push("Dropped (not counted in any position):");
        for (const id of droppedIds)
            lines.push(`   - ${id}: ${r.dropped[id]}`);
        lines.push("");
    }
    if (r.agreement === "insufficient")
        lines.push("Fewer than two seats answered, so there is no disagreement signal. Fix the failing seats or widen the panel.");
    lines.push(`Compared by: ${r.comparedBy === "plain" ? "plain normalized comparison" : r.comparedBy}${r.comparisonNote ? ` (${r.comparisonNote})` : ""}.`);
    lines.push(`Cost: ${r.cost.summary}.`);
    if (r.needsHuman && r.agreement !== "insufficient")
        lines.push("The models disagree. Read the positions, or put the same question to the full debate with `consensus run`.");
    return lines.join("\n");
}
