const isTTY = !!process.stderr.isTTY && !process.env.NO_COLOR;
const ascii = !!process.env.CONSENSUS_ASCII || /^(C|POSIX)$/.test(process.env.LANG ?? "") || process.env.TERM === "dumb";
/** Status glyphs with an ASCII fallback (CONSENSUS_ASCII=1, LANG=C, or TERM=dumb). Always pair with words. */
export const G = ascii
    ? { ok: "[ok]", no: "[--]", maybe: "[?]", err: "[x]", step: ">" }
    : { ok: "✓", no: "○", maybe: "?", err: "✗", step: "▶" };
export const dim = (s) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s);
export const bold = (s) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s);
export const green = (s) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s);
export const yellow = (s) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s);
export const red = (s) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s);
export const log = (msg) => void process.stderr.write(msg + "\n");
export function progressLogger(quiet = false) {
    return (e) => {
        if (quiet)
            return;
        switch (e.type) {
            case "phase":
                log(bold(`\n${G.step} ${e.phase}${e.round ? ` (round ${e.round})` : ""}`));
                break;
            case "panelist:done":
                log(`  ${G.ok} ${e.label} ${e.panelist}  ${dim(`${(e.ms / 1000).toFixed(1)}s`)}`);
                break;
            case "panelist:error":
                log(red(`  ${G.err} ${e.label} ${e.panelist}: ${e.error}${e.dropped ? " (dropped)" : ""}`));
                break;
            case "moderation":
                log(`  ${G.step} captain ${e.panelist}: ${e.moderation.settled.length} settled, ${e.moderation.key_disputes.length} dispute(s) carried, ${e.moderation.key_disputes.filter((d) => d.ruling).length} ruling(s)${e.moderation.questions_for_seats?.length ? `, ${e.moderation.questions_for_seats.length} question(s) to seats` : ""}`);
                break;
            case "extra-round":
                log(yellow(`  captain ${e.panelist} granted one extra round after round ${e.round}`));
                break;
            case "served-by":
                log(yellow(`  ${e.label} ${e.panelist} was served by ${e.model} (refusal fallback) during ${e.phase}`));
                break;
            case "converged":
                log(green(`  panel converged in round ${e.round}`));
                break;
            case "not-converged":
                log(yellow(`  ${e.openDisputes} dispute${e.openDisputes === 1 ? "" : "s"} open after round ${e.round}`));
                break;
        }
    };
}
