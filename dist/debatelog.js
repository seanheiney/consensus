/**
 * Live debate log: turns engine events into a markdown file that grows while
 * the run is in progress (tail -f it), plus a compact terminal stream.
 */
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
export function formatCritique(label, panelist, c) {
    const out = [`#### Panelist ${label} (${panelist})`];
    if (c.self_review.errors.length || c.self_review.gaps.length) {
        out.push(`- Self-review — errors: ${c.self_review.errors.join("; ") || "none"}; gaps: ${c.self_review.gaps.join("; ") || "none"}`);
    }
    for (const r of c.reviews) {
        out.push(`- On ${r.answer}: **${r.verdict}**${r.strengths.length ? ` — strengths: ${r.strengths.join("; ")}` : ""}`);
        for (const d of r.disputes) {
            out.push(`  - [${d.severity}] ${d.claim}`, `    - Problem: ${d.problem}`);
            if (d.correction)
                out.push(`    - Correction: ${d.correction}`);
        }
    }
    return out.join("\n");
}
export function formatRevision(label, panelist, r) {
    const out = [`#### Answer ${label} (${panelist})${r.position_changed ? " — position changed" : " — position held"}`];
    for (const resp of r.responses)
        out.push(`- ${resp.action.toUpperCase()} (from ${resp.from}): ${resp.claim}${resp.reason ? ` — ${resp.reason}` : ""}`);
    out.push("", r.answer);
    return out.join("\n");
}
/** Markdown fragment for one event, or undefined if the event has no log body. */
export function eventToMarkdown(e) {
    switch (e.type) {
        case "start": {
            const seats = e.seats?.length
                ? e.seats.map((s) => `${s.label} = ${s.id} (effort ${s.effort ?? e.effort}${s.persona ? `, persona ${s.persona}` : ""})`).join(", ")
                : Object.entries(e.labels).map(([l, id]) => `${l} = ${id}`).join(", ");
            return `# Debate ${e.runId}\n\n_Seats: ${seats}. Max rounds ${e.rounds}._\n\n## Problem\n\n${e.prompt}${e.context ? `\n\n### Context\n\n${e.context}` : ""}\n`;
        }
        case "phase":
            return e.phase === "propose" ? `\n## Initial answers\n` : e.phase === "critique" ? `\n## Round ${e.round} — critiques\n` : e.phase === "revise" ? `\n## Round ${e.round} — revisions\n` : `\n## Synthesis\n`;
        case "proposal":
            return `\n### Answer ${e.label} (${e.panelist})\n\n${e.text}\n${e.reasoning ? `\n<details><summary>Reasoning summary</summary>\n\n${e.reasoning}\n\n</details>\n` : ""}`;
        case "served-by":
            return `\n_${e.label} (${e.panelist}) was served by ${e.model} during ${e.phase} (refusal fallback)._\n`;
        case "critique":
            return `\n${formatCritique(e.label, e.panelist, e.critique)}\n`;
        case "revision":
            return `\n${formatRevision(e.label, e.panelist, e.revision)}\n`;
        case "converged":
            return `\n**Converged in round ${e.round}: every panelist accepted every other answer.**\n`;
        case "not-converged":
            return `\n_${e.openDisputes} dispute${e.openDisputes === 1 ? "" : "s"} still open after round ${e.round}._\n`;
        case "panelist:error":
            return `\n_${e.label} (${e.panelist}) failed during ${e.phase}: ${e.error}${e.dropped ? " — dropped from the panel" : ""}_\n`;
        case "synthesis":
            return `\n_Written by ${e.panelist}._\n\n${e.text}\n`;
        default:
            return undefined;
    }
}
/** One-line terminal summaries for --verbose. */
export function eventToTerminal(e) {
    const first = (t) => t.trim().split("\n")[0].slice(0, 110);
    switch (e.type) {
        case "proposal":
            return [`  ${e.label} says: ${first(e.text)}…`];
        case "critique":
            return e.critique.reviews.map((r) => `  ${e.label} on ${r.answer}: ${r.verdict}${r.disputes.length ? ` (${r.disputes.length} dispute${r.disputes.length === 1 ? "" : "s"}: ${first(r.disputes[0].claim)})` : ""}`);
        case "revision": {
            const c = e.revision.responses.filter((x) => x.action === "concede").length;
            const rb = e.revision.responses.filter((x) => x.action === "rebut").length;
            return [`  ${e.label} ${e.revision.position_changed ? "changed position" : "held position"} (conceded ${c}, rebutted ${rb})`];
        }
        default:
            return [];
    }
}
/** Streams events to `<dir>/debate.md` as they happen. Returns the file path and a listener. */
export async function openDebateLog(dir) {
    await mkdir(dir, { recursive: true });
    const path = join(dir, "debate.md");
    const stream = createWriteStream(path, { flags: "w" });
    return {
        path,
        onEvent: (e) => {
            const md = eventToMarkdown(e);
            if (md)
                stream.write(md);
        },
        close: () => new Promise((res) => stream.end(res)),
    };
}
