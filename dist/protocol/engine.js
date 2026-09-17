import { TransientError } from "../types.js";
import { extractJson } from "./json.js";
import { CritiqueSchema, ModerationSchema, RevisionSchema } from "./schemas.js";
import { CAPTAIN_PROMPT, SYSTEM_PROMPT, critiquePrompt, moderatorPrompt, problemBlock, proposePrompt, revisePrompt, synthesizePrompt, debateLeak, standaloneRepairPrompt } from "./prompts.js";
import { z } from "zod";
import { CostLimitError, describeCost, estimateCost } from "../cost.js";
const TRANSIENT = /429|rate.?limit|overloaded|529|503|timeout|timed out|ECONNRESET|EPIPE|temporar|try again|SIGTERM/i;
/** Small seeded PRNG (mulberry32) so label and ordering shuffles are reproducible from run.json's seed. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/** Strip zod's `default` annotations and close objects so the schema is acceptable to strict structured-output APIs. */
export function toStrictJsonSchema(schema) {
    const js = z.toJSONSchema(schema, { target: "draft-7" });
    const walk = (node) => {
        if (!node || typeof node !== "object")
            return;
        const o = node;
        delete o.default;
        delete o.$schema;
        if (o.type === "object" && o.properties && typeof o.properties === "object") {
            o.additionalProperties = false;
            o.required = Object.keys(o.properties);
            for (const v of Object.values(o.properties))
                walk(v);
        }
        if (o.items)
            walk(o.items);
        for (const k of ["anyOf", "oneOf", "allOf"])
            if (Array.isArray(o[k]))
                for (const v of o[k])
                    walk(v);
    };
    walk(js);
    return js;
}
const LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function addUsage(a, b) {
    if (!b)
        return;
    a.reported = true;
    a.inputTokens += b.inputTokens;
    a.outputTokens += b.outputTokens;
    if (b.cacheReadTokens)
        a.cacheReadTokens = (a.cacheReadTokens ?? 0) + b.cacheReadTokens;
    if (b.costUsd !== undefined)
        a.costUsd = (a.costUsd ?? 0) + b.costUsd;
}
function newRunId() {
    const d = new Date();
    const stamp = d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    return `${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}
/** Fisher-Yates with an injectable RNG; anonymization only, not security. */
function shuffle(arr, rnd = Math.random) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
export class ConsensusEngine {
    opts;
    emit;
    constructor(opts) {
        if (opts.panel.length < 2)
            throw new Error("A consensus panel needs at least 2 panelists");
        const ids = new Set(opts.panel.map((p) => p.id));
        if (ids.size !== opts.panel.length)
            throw new Error("Panelist ids must be unique");
        this.opts = opts;
        this.emit = opts.onEvent ?? (() => { });
    }
    async run(prompt, context) {
        const rounds = Math.max(1, this.opts.rounds ?? 3);
        const effort = this.opts.effort ?? "high";
        const captain = this.opts.captain;
        const judge = this.opts.judge ?? captain ?? this.opts.panel[0];
        const seed = this.opts.seed ?? (Math.floor(Math.random() * 0xffffffff) >>> 0);
        const rnd = mulberry32(seed);
        this.rnd = rnd;
        // Anonymize: shuffle label assignment so labels carry no provider signal.
        const states = shuffle(this.opts.panel, rnd).map((panelist, i) => ({
            panelist,
            label: LABELS[i],
            answer: "",
            usage: { inputTokens: 0, outputTokens: 0 },
            active: true,
        }));
        const run = {
            schemaVersion: 1,
            id: newRunId(),
            startedAt: new Date().toISOString(),
            prompt,
            context,
            options: { rounds, defaultEffort: effort, maxCostUsd: this.opts.maxCostUsd, maxSpendUsd: this.opts.maxSpendUsd, seed },
            labels: Object.fromEntries(states.map((s) => [s.label, s.panelist.id])),
            seats: states.map((s) => ({
                id: s.panelist.id,
                label: s.label,
                provider: s.panelist.provider,
                model: s.panelist.model,
                effort: s.panelist.effort ?? effort,
                effortApplied: s.panelist.effortApplied?.(s.panelist.effort ?? effort),
                persona: s.panelist.persona,
                billing: s.panelist.billing,
            })),
            proposals: {},
            rounds: [],
            finalAnswers: {},
            converged: false,
            judge: judge.id,
            captain: captain?.id,
            synthesis: "",
            usage: {},
            dropped: {},
        };
        this.current = run;
        this.emit({ type: "start", runId: run.id, labels: run.labels, seats: run.seats, prompt, context, rounds, effort });
        // ---- Phase 1: independent proposals -------------------------------
        this.emit({ type: "phase", phase: "propose" });
        await this.forEachActive(states, "propose", async (s) => {
            const res = await this.call(s, [{ role: "user", content: proposePrompt(prompt, context), cachedPrefix: problemBlock(prompt, context) }], "propose");
            s.answer = res.trim();
            this.emit({ type: "proposal", label: s.label, panelist: s.panelist.id, text: s.answer, reasoning: s.reasoning });
        });
        this.requireQuorum(states, run);
        for (const s of this.active(states))
            run.proposals[s.label] = s.answer;
        // ---- Rounds: critique -> (converged?) -> revise ----------------------
        let lastCritiques;
        let maxRounds = rounds;
        let extraGranted = false;
        for (let round = 1; round <= maxRounds; round++) {
            this.emit({ type: "phase", phase: "critique", round });
            const answers = this.answers(states);
            const critiques = {};
            await this.forEachActive(states, `critique:${round}`, async (s) => {
                // Each critic sees the answers in its own order (position bias mitigation); labels are unchanged.
                const c = await this.callJson(s, [{ role: "user", content: critiquePrompt({ prompt, context, round, answers: this.reorder(answers), own: s.label, prior: this.priorFor(s.label, run.rounds.at(-1)) }), cachedPrefix: problemBlock(prompt, context) }], CritiqueSchema, "critique");
                // Drop reviews of labels that no longer exist / self-reviews by mistake.
                c.reviews = c.reviews.filter((r) => r.answer !== s.label && r.answer in answers);
                critiques[s.label] = c;
                this.emit({ type: "critique", label: s.label, panelist: s.panelist.id, round, critique: c });
            });
            this.requireQuorum(states, run);
            // Critiques from dropped panelists are stale; keep only active ones.
            for (const label of Object.keys(critiques)) {
                if (!this.active(states).some((s) => s.label === label))
                    delete critiques[label];
            }
            // Reviews pointing at dropped panelists are stale too.
            const liveLabels = new Set(this.active(states).map((s) => s.label));
            for (const c of Object.values(critiques))
                c.reviews = c.reviews.filter((r) => liveLabels.has(r.answer));
            // Round 1 with any dispute at all (even minor) goes through revise once, so corrections are
            // actually incorporated; convergence on first critique requires a clean sheet.
            const anyDispute = Object.values(critiques).some((c) => c.reviews.some((r) => r.disputes.length > 0));
            // Round 1 needs a clean sheet (any dispute forces a revision). From round 2 the follow-up critique only carries
            // unresolved or new major disputes, so the panel has converged once no major dispute remains anywhere.
            const noMajor = Object.values(critiques).every((c) => c.reviews.every((r) => !r.disputes.some((d) => d.severity === "major")));
            const converged = round > 1 ? this.isConverged(critiques, liveLabels) || (noMajor && Object.keys(critiques).length === liveLabels.size) : this.isConverged(critiques, liveLabels) && (!anyDispute || round === maxRounds);
            const record = { round, critiques, converged };
            run.rounds.push(record);
            lastCritiques = critiques;
            if (converged) {
                run.converged = true;
                this.emit({ type: "converged", round });
                break;
            }
            const open = Object.values(critiques).reduce((n, c) => n + c.reviews.reduce((m, r) => m + r.disputes.length, 0), 0);
            this.emit({ type: "not-converged", round, openDisputes: open });
            // Captain moderates: a brief with rulings drives the revision; on the last scheduled round it may ask for one more.
            let moderation;
            if (captain && (round < maxRounds || !extraGranted)) {
                try {
                    moderation = await this.callJsonWith(captain, "captain", CAPTAIN_PROMPT, [{ role: "user", content: moderatorPrompt({ prompt, context, round, answers, critiques, lastScheduled: round === maxRounds }), cachedPrefix: problemBlock(prompt, context) }], ModerationSchema, "moderate");
                    record.moderation = moderation;
                    this.emit({ type: "moderation", panelist: captain.id, round, moderation });
                    if (round === maxRounds && moderation.request_extra_round && !extraGranted) {
                        extraGranted = true;
                        maxRounds = rounds + 1;
                        this.emit({ type: "extra-round", panelist: captain.id, round });
                    }
                }
                catch (err) {
                    this.emit({ type: "panelist:error", label: "captain", panelist: captain.id, phase: `moderate:${round}`, error: err.message, dropped: false });
                }
            }
            if (round === maxRounds)
                break;
            if (round > 1 && moderation?.stop_debate) {
                // The captain judged the remaining disputes irreducible: go straight to the report instead of another revision.
                this.emit({ type: "stalemate", panelist: captain.id, round });
                break;
            }
            this.emit({ type: "phase", phase: "revise", round });
            const revisions = {};
            await this.forEachActive(states, `revise:${round}`, async (s) => {
                const r = await this.callJson(s, [{ role: "user", content: revisePrompt({ prompt, context, round, answers: this.reorder(answers), critiques, own: s.label, moderation }), cachedPrefix: problemBlock(prompt, context) }], RevisionSchema, "revise");
                revisions[s.label] = r;
                s.answer = r.answer.trim();
                this.emit({ type: "revision", label: s.label, panelist: s.panelist.id, round, revision: r });
            });
            this.requireQuorum(states, run);
            record.revisions = revisions;
        }
        // ---- Synthesis -----------------------------------------------------
        run.finalAnswers = this.answers(states);
        this.emit({ type: "phase", phase: "synthesize" });
        const onPanel = states.some((s) => s.panelist.id === judge.id);
        const judgeState = states.find((s) => s.panelist.id === judge.id && s.active);
        // An off-panel judge is an external synthesizer: it never argued the case.
        const external = !onPanel
            ? captain && judge.id === captain.id && this.captainState
                ? this.captainState
                : { panelist: judge, label: "J", answer: "", usage: { inputTokens: 0, outputTokens: 0 }, active: true }
            : undefined;
        const synthesizer = judgeState ??
            external ??
            this.active(states)[0] ??
            (() => {
                throw new Error("No active panelist available to synthesize");
            })();
        if (!judgeState && !external)
            run.judge = synthesizer.panelist.id;
        if (external && !states.includes(external))
            states.push(external);
        const synthesisSystem = captain && synthesizer.panelist.id === captain.id ? CAPTAIN_PROMPT : SYSTEM_PROMPT;
        const synthesize = (who, system) => this.callWith(who, system, [
            {
                role: "user",
                content: synthesizePrompt({
                    prompt,
                    context,
                    rounds: run.rounds.length,
                    converged: run.converged,
                    answers: run.finalAnswers,
                    lastCritiques,
                    moderations: run.rounds.filter((rr) => rr.moderation).map((rr) => ({ round: rr.round, moderation: rr.moderation })),
                    revisions: run.rounds.flatMap((rr) => Object.entries(rr.revisions ?? {}).map(([label, rev]) => ({
                        round: rr.round,
                        label,
                        positionChanged: rev.position_changed,
                        conceded: rev.responses.filter((x) => x.action !== "rebut").map((x) => x.claim),
                        rebutted: rev.responses.filter((x) => x.action === "rebut").map((x) => x.claim),
                    }))),
                }),
            },
        ], "synthesize");
        let synthesis;
        let writer = synthesizer;
        try {
            synthesis = await synthesize(synthesizer, synthesisSystem);
        }
        catch (err) {
            // The reporter failed outright (every stand-in too): a seat that argued the case writes the report rather than losing the debate.
            const seat = synthesizer === external ? this.active(states).find((x) => x !== external) : undefined;
            if (!seat || this.opts.signal?.aborted)
                throw err;
            this.emit({ type: "panelist:error", label: synthesizer.label, panelist: synthesizer.panelist.id, phase: "synthesize", error: `${err.message.split("\n")[0]} (seat ${seat.label} writes the report instead)`, dropped: false });
            writer = seat;
            synthesis = await synthesize(seat, SYSTEM_PROMPT);
        }
        run.judge = writer.panelist.id;
        // Guard: the Answer section must read on its own. One rewrite if it leaks debate references.
        const leak = debateLeak(synthesis);
        if (leak && !this.opts.signal?.aborted) {
            try {
                const writerSystem = captain && writer.panelist.id === captain.id ? CAPTAIN_PROMPT : SYSTEM_PROMPT;
                const fixed = await this.callWith(writer, writerSystem, [{ role: "user", content: `Report to fix:\n\n${synthesis}` }, { role: "assistant", content: "Understood." }, { role: "user", content: standaloneRepairPrompt(leak) }], "synthesize");
                if (/^#\s+Answer\s*$/m.test(fixed) && !debateLeak(fixed))
                    synthesis = fixed;
            }
            catch {
                /* keep the original report */
            }
        }
        run.synthesis = synthesis.trim();
        this.emit({ type: "synthesis", panelist: writer.panelist.id, text: run.synthesis });
        for (const s of states)
            if (s.usage.reported)
                run.usage[s.panelist.id] = { ...s.usage, reported: undefined, billing: s.panelist.billing };
        if (this.captainState?.usage.reported && !run.usage[this.captainState.panelist.id])
            run.usage[this.captainState.panelist.id] = { ...this.captainState.usage, reported: undefined, billing: this.captainState.panelist.billing };
        for (const [id, u] of Object.entries(this.retiredUsage))
            if (!run.usage[id])
                run.usage[id] = u;
        if (captain)
            run.captain = captain.id;
        const c = estimateCost(run.usage);
        run.cost = { billedUsd: c.usd, subscriptionEquivUsd: c.subscriptionEquivUsd, unpriced: c.unpriced, summary: describeCost(c) };
        run.finishedAt = new Date().toISOString();
        this.emit({ type: "done", run });
        return run;
    }
    // ---- helpers ---------------------------------------------------------
    rnd = Math.random;
    /** Same answers, shuffled order, labels intact. */
    reorder(answers) {
        return Object.fromEntries(shuffle(Object.entries(answers), this.rnd));
    }
    active(states) {
        return states.filter((s) => s.active);
    }
    answers(states) {
        return Object.fromEntries(this.active(states).map((s) => [s.label, s.answer]));
    }
    requireQuorum(states, run) {
        for (const s of states)
            if (!s.active && s.error)
                run.dropped[s.panelist.id] = s.error;
        if (this.active(states).length < 2) {
            const errs = states
                .filter((s) => !s.active)
                .map((s) => `${s.panelist.id}: ${s.error}`)
                .join("\n");
            throw new Error(`Fewer than 2 panelists remain, cannot continue.\n${errs}`);
        }
    }
    /** For a follow-up critique: what `label` disputed last round in each other answer, and that author's responses to it. */
    priorFor(label, last) {
        if (!last)
            return undefined;
        const out = {};
        for (const review of last.critiques[label]?.reviews ?? []) {
            const responses = (last.revisions?.[review.answer]?.responses ?? []).filter((r) => r.from.replace(/^(panelist|answer)\s+/i, "").trim().toUpperCase() === label.toUpperCase());
            out[review.answer] = { raised: review.disputes.map((d) => ({ severity: d.severity, claim: d.claim, problem: d.problem })), responses: responses.map((r) => ({ claim: r.claim, action: r.action, reason: r.reason })) };
        }
        return out;
    }
    /** All panelists agreed with every other live answer. */
    isConverged(critiques, live) {
        for (const label of live) {
            const c = critiques[label];
            if (!c)
                return false;
            for (const other of live) {
                if (other === label)
                    continue;
                const review = c.reviews.find((r) => r.answer === other);
                if (!review || review.verdict !== "agree")
                    return false;
                if (review.disputes.some((d) => d.severity === "major"))
                    return false;
            }
        }
        return true;
    }
    /** Run `fn` for every active panelist concurrently; a failure (after one retry on transient errors) drops that panelist. */
    async forEachActive(states, phase, fn) {
        await Promise.all(this.active(states).map(async (s) => {
            const t0 = Date.now();
            this.emit({ type: "panelist:start", label: s.label, panelist: s.panelist.id, phase });
            try {
                try {
                    await fn(s);
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    const transient = err instanceof TransientError || TRANSIENT.test(msg);
                    if (this.opts.retry === false || !transient || this.opts.signal?.aborted)
                        throw err;
                    await new Promise((r) => setTimeout(r, 4000));
                    await fn(s);
                }
                this.emit({ type: "panelist:done", label: s.label, panelist: s.panelist.id, phase, ms: Date.now() - t0 });
            }
            catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                s.active = false;
                s.error = `${phase}: ${error}`;
                this.emit({ type: "panelist:error", label: s.label, panelist: s.panelist.id, phase, error, dropped: true });
            }
        }));
        this.checkCost(states, phase);
    }
    checkCost(states, phase) {
        if (this.opts.maxCostUsd === undefined && this.opts.maxSpendUsd === undefined)
            return;
        const usage = Object.fromEntries(states.map((s) => [s.panelist.id, { ...s.usage, billing: s.panelist.billing }]));
        const { usd, subscriptionEquivUsd } = estimateCost(usage);
        const billed = usd ?? 0;
        const total = billed + (subscriptionEquivUsd ?? 0);
        const over = this.opts.maxCostUsd !== undefined && billed > this.opts.maxCostUsd ? { spent: billed, limit: this.opts.maxCostUsd, kind: "billed" } : this.opts.maxSpendUsd !== undefined && total > this.opts.maxSpendUsd ? { spent: total, limit: this.opts.maxSpendUsd, kind: "total" } : undefined;
        if (over) {
            const err = new CostLimitError(over.spent, over.limit, phase, over.kind);
            // Hand back what exists so the caller can save the partial debate instead of losing it.
            if (this.current) {
                this.current.finalAnswers = this.answers(states);
                for (const s of states)
                    if (s.usage.reported)
                        this.current.usage[s.panelist.id] = { ...s.usage, reported: undefined, billing: s.panelist.billing };
                this.current.finishedAt = new Date().toISOString();
                err.partial = this.current;
            }
            throw err;
        }
    }
    current;
    async call(s, messages, phase, json = false, jsonSchema) {
        return this.callWith(s, SYSTEM_PROMPT, messages, phase, json, jsonSchema);
    }
    /** Call a non-seat panelist (the captain) and account its usage under its own id. */
    captainState;
    async callJsonWith(p, label, system, messages, schema, phase) {
        this.captainState ??= { panelist: p, label, answer: "", usage: { inputTokens: 0, outputTokens: 0 }, active: true };
        const jsonSchema = toStrictJsonSchema(schema);
        const attempt = (text) => schema.parse(extractJson(text));
        const first = await this.callWith(this.captainState, system, messages, phase, true, jsonSchema);
        try {
            return attempt(first);
        }
        catch (err) {
            const why = err instanceof Error ? err.message : String(err);
            const second = await this.callWith(this.captainState, system, [...messages, { role: "assistant", content: first }, { role: "user", content: `Your previous response could not be used: ${why.slice(0, 800)}\n\nRespond again with ONLY the JSON object, matching the requested shape exactly.` }], phase, true, jsonSchema);
            return attempt(second);
        }
    }
    retiredUsage = {};
    completeFor(s, system, messages, phase, json, jsonSchema) {
        return s.panelist.complete({
            system,
            messages,
            json,
            jsonSchema,
            effort: this.opts.effort,
            maxTokens: this.opts.maxTokens,
            signal: this.opts.signal,
            phase,
        });
    }
    async callWith(s, system, messages, phase, json = false, jsonSchema) {
        const before = s.panelist.id;
        const beforeBilling = s.panelist.billing;
        const priorUsage = { ...s.usage };
        let res;
        try {
            res = await this.completeFor(s, system, messages, phase, json, jsonSchema);
        }
        finally {
            if (s.panelist.id !== before) {
                // A fallback panelist handed off: keep what the previous model spent under its own id.
                if (priorUsage.reported)
                    this.retiredUsage[before] = { ...priorUsage, reported: undefined, billing: beforeBilling };
                s.usage = { inputTokens: 0, outputTokens: 0 };
                this.emit({ type: "handoff", label: s.label, from: before, to: s.panelist.id, phase: phase ?? "call", error: "previous model unavailable (usage limit or error)" });
            }
        }
        addUsage(s.usage, res.usage);
        if (res.servedBy && res.servedBy !== s.panelist.model)
            this.emit({ type: "served-by", label: s.label, panelist: s.panelist.id, model: res.servedBy, phase: phase ?? "call" });
        if (phase === "propose" && res.reasoning)
            s.reasoning = res.reasoning;
        return res.text;
    }
    /** Call, parse JSON, validate; on failure ask the model once to repair. */
    async callJson(s, messages, schema, phase) {
        const jsonSchema = toStrictJsonSchema(schema);
        const first = await this.call(s, messages, phase, true, jsonSchema);
        const attempt = (text) => schema.parse(extractJson(text));
        try {
            return attempt(first);
        }
        catch (err) {
            const why = err instanceof Error ? err.message : String(err);
            const repair = [
                ...messages,
                { role: "assistant", content: first },
                {
                    role: "user",
                    content: `Your previous response could not be used: ${why.slice(0, 800)}\n\nRespond again with ONLY the JSON object, matching the requested shape exactly. No prose, no code fences.`,
                },
            ];
            const second = await this.call(s, repair, phase, true, jsonSchema);
            return attempt(second);
        }
    }
}
export async function runConsensus(prompt, opts) {
    const { context, ...rest } = opts;
    return new ConsensusEngine(rest).run(prompt, context);
}
