/**
 * Decisions as repo artifacts. `consensus adr` turns a run into an architecture
 * decision record: what was asked, what the panel decided, how sure it was,
 * what it could not settle, and who was in the room — reviewable in a PR and
 * greppable two years later.
 */
import { readdir } from "node:fs/promises";
import { adrMarker } from "./drift.js";
export const DEFAULT_ADR_DIR = "docs/decisions";
function section(synthesis, name) {
    return synthesis.match(new RegExp(`^#+\\s*${name}\\s*\\n([\\s\\S]*?)(?=\\n#|$)`, "im"))?.[1]?.trim() || undefined;
}
/** A short kebab-case slug from the question. */
export function adrSlug(prompt) {
    const words = prompt
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((w) => w && !["the", "a", "an", "should", "we", "do", "is", "are", "for", "to", "of", "and", "or", "in", "on", "with", "what", "which", "how"].includes(w));
    return words.slice(0, 7).join("-").slice(0, 60) || "decision";
}
/** A one-line title: the question itself, trimmed to something readable. */
export function adrTitle(prompt) {
    const first = prompt.replace(/\s+/g, " ").trim().split(/(?<=[.?!])\s/)[0] ?? prompt;
    return first.length > 100 ? `${first.slice(0, 97)}...` : first;
}
/** The next free number in an ADR directory (0001, 0002, ...). */
export async function nextAdrNumber(dir) {
    let names = [];
    try {
        names = await readdir(dir);
    }
    catch {
        return 1;
    }
    const used = names.map((n) => parseInt(n.slice(0, 4), 10)).filter((n) => Number.isFinite(n));
    return used.length ? Math.max(...used) + 1 : 1;
}
/** Render a run as an architecture decision record. */
export function renderAdr(run, o) {
    const answer = section(run.synthesis, "Answer") ?? run.synthesis.trim();
    const confidence = section(run.synthesis, "Confidence");
    const unresolved = section(run.synthesis, "Unresolved disagreements");
    const agreed = section(run.synthesis, "What the panel agreed on");
    const date = o.date ?? (run.finishedAt ?? run.startedAt).slice(0, 10);
    const seats = run.seats.map((s) => `${s.id}${s.persona ? ` (${s.persona})` : ""}${run.dropped[s.id] ? " — dropped" : ""}`);
    const rounds = run.rounds.length;
    const lines = [
        `# ${String(o.number).padStart(4, "0")}. ${adrTitle(run.prompt)}`,
        "",
        `- **Status:** ${o.status ?? "Proposed"}`,
        `- **Date:** ${date}`,
        `- **Decided by:** a consensus panel of ${run.seats.length} model${run.seats.length === 1 ? "" : "s"}, ${run.converged ? `converged after ${rounds} round${rounds === 1 ? "" : "s"}` : `unresolved after ${rounds} round${rounds === 1 ? "" : "s"}`}`,
        "",
        "## Question",
        "",
        run.prompt.trim(),
        "",
        "## Decision",
        "",
        answer,
        "",
    ];
    if (agreed)
        lines.push("## What the panel agreed on", "", agreed, "");
    lines.push("## Confidence", "", confidence ?? "Not stated by the panel.", "");
    lines.push("## Unresolved", "", unresolved ?? (run.converged ? "Nothing: every seat accepted every other seat's answer." : "The panel did not converge; see the debate."), "");
    if (run.verification) {
        const unsupported = run.verification.claims.filter((c) => c.support !== "supported");
        lines.push("## Grounding check", "", `${run.verification.claims.length} load-bearing claim${run.verification.claims.length === 1 ? "" : "s"} were checked against the material the panel was given.`, ...(unsupported.length ? ["", "Not established by that material:", ...unsupported.map((c) => `- **${c.support}**: ${c.claim}`)] : ["", "All of them were established by it."]), "");
    }
    lines.push("## The panel", "", ...seats.map((s) => `- ${s}`), ...(run.captain ? [`- Captain: ${run.captain}`] : []), `- Report written by: ${run.judge}`, "", "## Provenance", "", `- Run \`${run.id}\`${o.runDir ? ` — full debate in \`${o.runDir}/debate.md\`` : ""}`, ...(run.escalation ? [`- Escalated from ${run.escalation.fromSeats.join(", ")} (${run.escalation.reason}); first pass \`${run.escalation.fromRunId}\``] : []), ...(run.cost ? [`- Cost: ${run.cost.summary}`] : []), `- Replay: \`consensus log ${run.id}\``, "", "_A panel converging means every seat accepted every other seat's answer, which is agreement, not proof. Treat this record as a well-argued recommendation, not a verified fact._", "", 
    // Read back by `consensus adr --recheck`; invisible when rendered.
    adrMarker(run), "");
    return lines.join("\n");
}
