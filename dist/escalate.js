/** The judge's own confidence word, when the report states one. */
export function statedConfidence(synthesis) {
    const section = synthesis.match(/^#+\s*Confidence\s*\n([\s\S]*?)(?=\n#|$)/im)?.[1];
    const word = section?.match(/\b(low|medium|moderate|high)\b/i)?.[1]?.toLowerCase();
    if (!word)
        return undefined;
    return word === "moderate" ? "medium" : word;
}
/** Disputes still open in the last round: what the panel argued about and never settled. */
export function openDisputes(run) {
    const last = run.rounds[run.rounds.length - 1];
    if (!last)
        return [];
    const out = [];
    for (const critique of Object.values(last.critiques)) {
        for (const review of critique.reviews) {
            for (const d of review.disputes)
                if (d.severity === "major")
                    out.push(`${d.claim} — ${d.problem}`);
        }
    }
    return [...new Set(out)];
}
/** Should this first pass be promoted to the stronger panel? */
export function shouldEscalate(run, when = "unsettled") {
    if (when === "always")
        return { escalate: true, reason: "escalate-when=always" };
    const disputes = openDisputes(run);
    if (!run.converged)
        return { escalate: true, reason: `the first panel did not converge${disputes.length ? ` (${disputes.length} major dispute${disputes.length === 1 ? "" : "s"} open)` : ""}` };
    if (disputes.length)
        return { escalate: true, reason: `${disputes.length} major dispute${disputes.length === 1 ? "" : "s"} left open` };
    if (when === "disputed")
        return { escalate: false, reason: "converged with no open disputes" };
    const seatsLeft = run.seats.length - Object.keys(run.dropped).length;
    if (seatsLeft < 2)
        return { escalate: true, reason: `only ${seatsLeft} seat answered` };
    const confidence = statedConfidence(run.synthesis);
    if (confidence === "low" || confidence === "medium")
        return { escalate: true, reason: `the first panel reported ${confidence} confidence` };
    if (!confidence)
        return { escalate: true, reason: "the first panel stated no confidence" };
    return { escalate: false, reason: "converged with high confidence and no open disputes" };
}
/** What the strong panel is told about the first pass. A draft to check, never an authority. */
export function escalationContext(run, context) {
    const answer = run.synthesis.match(/^#+\s*Answer\s*\n([\s\S]*?)(?=\n#|$)/im)?.[1]?.trim() ?? run.synthesis.trim();
    const disputes = openDisputes(run);
    const unresolved = run.synthesis.match(/^#+\s*Unresolved disagreements\s*\n([\s\S]*?)(?=\n#|$)/im)?.[1]?.trim();
    const parts = [
        context?.trim(),
        "## A faster panel's first pass",
        `A cheaper panel (${run.seats.map((s) => s.id).join(", ")}) already answered this. Their answer:`,
        "",
        answer,
        "",
        ...(disputes.length ? ["They could not settle:", ...disputes.map((d) => `- ${d}`), ""] : []),
        ...(unresolved && !disputes.length ? [`They reported as unresolved: ${unresolved}`, ""] : []),
        "Treat this as a draft to verify, not as an authority. Reach your own answer: confirm it, correct it, or replace it, and say which you did.",
    ].filter((x) => !!x);
    return parts.join("\n");
}
/**
 * Run the cheap panel, then the strong one only if needed. The returned run is
 * whichever answered last; when it escalated it carries `escalation`.
 */
export async function runWithEscalation(o) {
    const first = await o.runOnce(o.first, o.prompt, o.context, 1);
    const decision = shouldEscalate(first, o.when ?? "unsettled");
    o.onDecision?.(decision, first);
    await o.onFirstPass?.(first);
    if (!decision.escalate)
        return first;
    const target = await o.resolveTarget();
    const second = await o.runOnce(target, o.prompt, escalationContext(first, o.context), 2);
    second.escalation = {
        fromRunId: first.id,
        fromSeats: first.seats.map((s) => s.id),
        reason: decision.reason,
        firstPassConverged: first.converged,
    };
    return second;
}
