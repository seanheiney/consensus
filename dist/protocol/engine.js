import { extractJson } from "./json.js";
import { CritiqueSchema, RevisionSchema } from "./schemas.js";
import { SYSTEM_PROMPT, critiquePrompt, proposePrompt, revisePrompt, synthesizePrompt } from "./prompts.js";
import { CostLimitError, estimateCost } from "../cost.js";
const TRANSIENT = /429|rate.?limit|overloaded|529|503|timeout|timed out|ECONNRESET|EPIPE|temporar|try again|SIGTERM/i;
const LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function addUsage(a, b) {
    if (!b)
        return;
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
/** Fisher-Yates with Math.random; anonymization only, not security. */
function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
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
        const judge = this.opts.judge ?? this.opts.panel[0];
        // Anonymize: shuffle label assignment so labels carry no provider signal.
        const states = shuffle(this.opts.panel).map((panelist, i) => ({
            panelist,
            label: LABELS[i],
            answer: "",
            usage: { inputTokens: 0, outputTokens: 0 },
            active: true,
        }));
        const run = {
            id: newRunId(),
            startedAt: new Date().toISOString(),
            prompt,
            context,
            options: { rounds, defaultEffort: effort, maxCostUsd: this.opts.maxCostUsd },
            labels: Object.fromEntries(states.map((s) => [s.label, s.panelist.id])),
            seats: states.map((s) => ({
                id: s.panelist.id,
                label: s.label,
                provider: s.panelist.provider,
                model: s.panelist.model,
                effort: s.panelist.effort ?? effort,
                persona: s.panelist.persona,
            })),
            proposals: {},
            rounds: [],
            finalAnswers: {},
            converged: false,
            judge: judge.id,
            synthesis: "",
            usage: {},
            dropped: {},
        };
        this.emit({ type: "start", runId: run.id, labels: run.labels, prompt, context, rounds, effort });
        // ---- Phase 1: independent proposals -------------------------------
        this.emit({ type: "phase", phase: "propose" });
        await this.forEachActive(states, "propose", async (s) => {
            const res = await this.call(s, [{ role: "user", content: proposePrompt(prompt, context) }], "propose");
            s.answer = res.trim();
            this.emit({ type: "proposal", label: s.label, panelist: s.panelist.id, text: s.answer, reasoning: s.reasoning });
        });
        this.requireQuorum(states, run);
        for (const s of this.active(states))
            run.proposals[s.label] = s.answer;
        // ---- Rounds: critique -> (converged?) -> revise ----------------------
        let lastCritiques;
        for (let round = 1; round <= rounds; round++) {
            this.emit({ type: "phase", phase: "critique", round });
            const answers = this.answers(states);
            const critiques = {};
            await this.forEachActive(states, `critique:${round}`, async (s) => {
                const c = await this.callJson(s, [{ role: "user", content: critiquePrompt({ prompt, context, round, answers, own: s.label }) }], CritiqueSchema, "critique");
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
            const converged = this.isConverged(critiques, liveLabels);
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
            if (round === rounds)
                break;
            this.emit({ type: "phase", phase: "revise", round });
            const revisions = {};
            await this.forEachActive(states, `revise:${round}`, async (s) => {
                const r = await this.callJson(s, [{ role: "user", content: revisePrompt({ prompt, context, round, answers, critiques, own: s.label }) }], RevisionSchema, "revise");
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
            ? { panelist: judge, label: "J", answer: "", usage: { inputTokens: 0, outputTokens: 0 }, active: true }
            : undefined;
        const synthesizer = judgeState ??
            external ??
            this.active(states)[0] ??
            (() => {
                throw new Error("No active panelist available to synthesize");
            })();
        if (!judgeState && !external)
            run.judge = synthesizer.panelist.id;
        if (external)
            states.push(external);
        const synthesis = await this.call(synthesizer, [
            {
                role: "user",
                content: synthesizePrompt({
                    prompt,
                    context,
                    rounds: run.rounds.length,
                    converged: run.converged,
                    answers: run.finalAnswers,
                    lastCritiques,
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
        run.synthesis = synthesis.trim();
        this.emit({ type: "synthesis", panelist: synthesizer.panelist.id, text: run.synthesis });
        for (const s of states)
            run.usage[s.panelist.id] = s.usage;
        run.finishedAt = new Date().toISOString();
        this.emit({ type: "done", run });
        return run;
    }
    // ---- helpers ---------------------------------------------------------
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
                    if (this.opts.retry === false || !TRANSIENT.test(msg) || this.opts.signal?.aborted)
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
        const limit = this.opts.maxCostUsd;
        if (limit === undefined)
            return;
        const usage = Object.fromEntries(states.map((s) => [s.panelist.id, s.usage]));
        const { usd } = estimateCost(usage);
        if (usd !== null && usd > limit)
            throw new CostLimitError(usd, limit, phase);
    }
    async call(s, messages, phase, json = false) {
        const res = await s.panelist.complete({
            system: SYSTEM_PROMPT,
            messages,
            json,
            effort: this.opts.effort,
            maxTokens: this.opts.maxTokens,
            signal: this.opts.signal,
            phase,
        });
        addUsage(s.usage, res.usage);
        if (res.servedBy && res.servedBy !== s.panelist.model)
            this.emit({ type: "served-by", label: s.label, panelist: s.panelist.id, model: res.servedBy, phase: phase ?? "call" });
        if (phase === "propose" && res.reasoning)
            s.reasoning = res.reasoning;
        return res.text;
    }
    /** Call, parse JSON, validate; on failure ask the model once to repair. */
    async callJson(s, messages, schema, phase) {
        const first = await this.call(s, messages, phase, true);
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
            const second = await this.call(s, repair, phase, true);
            return attempt(second);
        }
    }
}
export async function runConsensus(prompt, opts) {
    const { context, ...rest } = opts;
    return new ConsensusEngine(rest).run(prompt, context);
}
