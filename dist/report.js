function fmt(n) {
    return n.toLocaleString("en-US");
}
/** Render a run as a self-contained markdown report. */
export function renderReport(run, opts = {}) {
    const panel = Object.entries(run.labels)
        .map(([label, id]) => `${label} = ${id}${run.dropped[id] ? " (dropped)" : ""}`)
        .join(", ");
    const rounds = run.rounds.length;
    const status = run.converged
        ? `converged after ${rounds} round${rounds === 1 ? "" : "s"}`
        : `did not fully converge after ${rounds} round${rounds === 1 ? "" : "s"}`;
    const judgeOnPanel = run.seats.some((s) => s.id === run.judge);
    const lines = [
        run.synthesis,
        "",
        "---",
        "",
        `_Panel ${status}. Panelists: ${panel}. Synthesized by ${run.judge}${judgeOnPanel ? " (a panelist; pass --judge external:<spec> for a judge that did not debate)" : " (external judge, did not debate)"}. Run ${run.id}._`,
        "",
        `_"Converged" means every seat accepted every other seat's answer as substantively equivalent: self-reported agreement, not verified correctness. Confidence is the judge's own estimate._`,
        ...(run.cost ? ["", `_Cost: ${run.cost.summary}._`] : []),
    ];
    if (Object.keys(run.dropped).length) {
        lines.push("", "**Dropped panelists:**");
        for (const [id, err] of Object.entries(run.dropped))
            lines.push(`- ${id}: ${err}`);
    }
    const CLI = new Set(["claude", "codex", "gemini", "grok"]);
    const usageRows = run.seats.length ? run.seats.map((s) => [s.id, run.usage[s.id], s.provider]) : Object.entries(run.usage).map(([id, u]) => [id, u, id.split(":")[0]]);
    if (usageRows.length) {
        lines.push("", "| Seat | Input tokens | Output tokens |", "|---|---:|---:|");
        for (const [id, u, provider] of usageRows) {
            const known = u && (u.inputTokens || u.outputTokens);
            lines.push(known ? `| ${id} | ${fmt(u.inputTokens)} | ${fmt(u.outputTokens)} |` : `| ${id} | n/a${CLI.has(provider) ? " (subscription CLI)" : ""} | n/a |`);
        }
    }
    if (opts.transcript)
        lines.push("", renderTranscript(run));
    return lines.join("\n");
}
/** Full debate transcript: proposals, each round's critiques and revisions. */
export function renderTranscript(run) {
    const out = ["## Transcript", ""];
    out.push("### Initial answers", "");
    for (const [label, text] of Object.entries(run.proposals)) {
        out.push(`#### Answer ${label} (${run.labels[label]})`, "", text, "");
    }
    for (const r of run.rounds) {
        out.push(`### Round ${r.round} — critiques${r.converged ? " (converged)" : ""}`, "");
        for (const [from, c] of Object.entries(r.critiques)) {
            out.push(`#### Panelist ${from}`);
            if (c.self_review.errors.length || c.self_review.gaps.length) {
                out.push(`- Self-review: errors: ${c.self_review.errors.join("; ") || "none"}; gaps: ${c.self_review.gaps.join("; ") || "none"}`);
            }
            for (const rv of c.reviews) {
                out.push(`- On ${rv.answer}: **${rv.verdict}**${rv.strengths.length ? ` — strengths: ${rv.strengths.join("; ")}` : ""}`);
                for (const d of rv.disputes) {
                    out.push(`  - [${d.severity}] ${d.claim}\n    - Problem: ${d.problem}${d.correction ? `\n    - Correction: ${d.correction}` : ""}`);
                }
            }
            out.push("");
        }
        if (r.revisions) {
            out.push(`### Round ${r.round} — revisions`, "");
            for (const [label, rev] of Object.entries(r.revisions)) {
                out.push(`#### Answer ${label}${rev.position_changed ? " (position changed)" : ""}`);
                for (const resp of rev.responses) {
                    out.push(`- ${resp.action.toUpperCase()} (from ${resp.from}): ${resp.claim}${resp.reason ? ` — ${resp.reason}` : ""}`);
                }
                out.push("", rev.answer, "");
            }
        }
    }
    return out.join("\n");
}
