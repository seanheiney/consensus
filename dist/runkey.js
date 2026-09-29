/**
 * A stable key for "this exact question, put to this exact panel". Used by the
 * opt-in `--reuse`: a repeat of a decision you already paid for is handed back
 * instead of debated again.
 */
import { createHash } from "node:crypto";
/** Whitespace-insensitive: reflowing a pasted question does not miss the cache. */
function normalize(text) {
    return text.replace(/\s+/g, " ").trim();
}
export function runKey(p) {
    const h = createHash("sha256");
    h.update(normalize(p.prompt));
    h.update("\u0000");
    h.update(normalize(p.context ?? ""));
    h.update("\u0000");
    h.update([...p.seats].sort().join(","));
    h.update("\u0000");
    h.update(`${p.rounds}:${p.effort}`);
    return h.digest("hex").slice(0, 32);
}
