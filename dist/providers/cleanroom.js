import { foldIsolation } from "./isolation.js";
/** How a grok receipt was observed; shown in reports and doctor --isolation. */
export const GROK_OBSERVED_VIA = "grok inspect --json in an identical sandbox";
function arr(v) {
    return Array.isArray(v) ? v.map((x) => (x && typeof x === "object" ? x : { name: String(x) })) : undefined;
}
function sourceType(x) {
    const s = x.source;
    if (s && typeof s === "object" && typeof s.type === "string")
        return s.type;
    return typeof s === "string" ? s : undefined;
}
/**
 * Parse `grok inspect --json` output. Returns undefined when the output is not
 * an inspect report (an older grok without the subcommand, an error, a fake),
 * so the caller keeps the weaker "configured" evidence instead of guessing.
 */
export function parseGrokInspect(stdout) {
    let d = stdout;
    if (typeof stdout === "string") {
        const start = stdout.indexOf("{");
        if (start < 0)
            return undefined;
        try {
            d = JSON.parse(stdout.slice(start));
        }
        catch {
            return undefined;
        }
    }
    if (!d || typeof d !== "object")
        return undefined;
    const o = d;
    const instructions = arr(o.projectInstructions);
    const skills = arr(o.skills);
    const plugins = arr(o.plugins);
    const mcpServers = arr(o.mcpServers);
    const hooks = arr(o.hooks);
    // All five lists are required: a report missing one cannot vouch for it.
    if (!instructions || !skills || !plugins || !mcpServers || !hooks)
        return undefined;
    // A user's own add-on may be named "x@bundled" or "x@builtin"; tag it so it can never pass for a CLI built-in.
    const name = (x, tag) => {
        const n = String(x.name ?? x.path ?? "?");
        return /@(builtin|bundled)$/.test(n) ? `${n} (${tag})` : n;
    };
    // Grok's own agents (source "builtin") always appear; any other agent, LSP server or remote settings did not come from the empty sandbox.
    const other = [
        ...(arr(o.agents) ?? []).filter((x) => sourceType(x) !== "builtin").map((x) => `agent ${name(x, sourceType(x) ?? "unknown source")}`),
        ...(arr(o.lspServers) ?? []).map((x) => `LSP server ${name(x, "lsp")}`),
        ...(o.externalCompat?.remoteSettingsLoaded === true ? ["remote settings"] : []),
    ];
    return {
        version: typeof o.grokVersion === "string" ? o.grokVersion : undefined,
        instructions: instructions.map((x) => String(x.path ?? x.name ?? "?")),
        // Bundled skills ship inside grok's own install (like Claude Code's @builtin plugins), so they
        // are listed but do not make a seat unclean. User, plugin and config skills do.
        skills: skills.map((x) => (sourceType(x) === "bundled" ? `${String(x.name ?? x.path ?? "?")}@bundled` : name(x, sourceType(x) ?? "unknown source"))),
        // A plugin that is installed but disabled still counts: grok found it, and one flag flips it on.
        plugins: plugins.map((x) => name(x, "plugin")),
        mcpServers: mcpServers.map((x) => name(x, "mcp")),
        hooks: hooks.map((x) => `${String(x.event ?? "hook")} (${sourceType(x) ?? "unknown source"})`),
        other,
    };
}
/** Fold a parsed inspect report into a grok seat's receipt. */
export function observedGrokReceipt(base, s) {
    return {
        ...base,
        evidence: "observed",
        observedVia: GROK_OBSERVED_VIA,
        version: base.version ?? s.version,
        instructions: s.instructions,
        skills: s.skills,
        plugins: s.plugins,
        mcpServers: s.mcpServers,
        hooks: s.hooks,
        other: s.other,
    };
}
/**
 * The run-level verdict: how many seats were observed clean, how many are
 * clean only by configuration, and which (if any) were observed not clean.
 */
export function cleanRooms(isolation) {
    const seats = Object.entries(isolation ?? {});
    if (!seats.length)
        return undefined;
    // Sorted: receipts land in the order calls finish, which varies from run to run.
    const ids = (f) => seats.filter(([, s]) => f(s)).map(([id]) => id).sort();
    const notClean = ids((s) => !s.clean);
    const observedClean = ids((s) => s.clean && s.evidence === "observed");
    const configuredOnly = ids((s) => s.clean && s.evidence === "configured");
    const api = ids((s) => s.clean && s.evidence === "request");
    const n = seats.length;
    let line;
    if (notClean.length) {
        const rest = [observedClean.length && `${observedClean.length} observed clean`, configuredOnly.length && `${configuredOnly.length} configured-only`, api.length && `${api.length} API with no tools`].filter(Boolean).join(", ");
        line = `Clean rooms: NOT CLEAN: ${notClean.join(", ")}${rest ? `; ${rest}` : ""} (${n} seat${n === 1 ? "" : "s"}).`;
    }
    else if (observedClean.length === n) {
        line = `Clean rooms: ${n}/${n} seats observed clean.`;
    }
    else {
        const parts = [
            observedClean.length && `${observedClean.length} observed clean`,
            configuredOnly.length && `${configuredOnly.length} configured-only (${configuredOnly.join(", ")}: lockdown flags, the CLI does not report what it loaded)`,
            api.length && `${api.length} API with no tools attached`,
        ].filter(Boolean);
        line = `Clean rooms: ${parts.join(", ")}.`;
    }
    return { seats: n, observedClean, configuredOnly, api, notClean, line };
}
/** Turn doctor's live probes into checks; a probe that failed or returned no receipt could not be checked, so it fails. */
export function isolationChecks(results) {
    return results.map((r) => {
        if (!r.ok || !r.isolation)
            return { id: r.id, ok: false, clean: false, error: r.error ?? "no isolation receipt returned" };
        const receipt = foldIsolation(undefined, r.isolation);
        return { id: r.id, ok: true, clean: receipt.clean, receipt };
    });
}
export function isolationReport(checks, withheld) {
    const folded = {};
    for (const c of checks)
        if (c.receipt)
            folded[c.id] = c.receipt;
    let verdict = cleanRooms(folded);
    // A seat that could not be checked must not vanish from the verdict, or "1/1 seats observed clean" would hide it.
    const unchecked = checks.filter((c) => !c.receipt).map((c) => c.id).sort();
    if (unchecked.length) {
        const rest = verdict ? `; ${verdict.line.replace(/^Clean rooms: /, "").replace(/\.$/, "")}` : "";
        const line = `Clean rooms: NOT VERIFIED: ${unchecked.join(", ")} could not be checked${rest}.`;
        verdict = verdict ? { ...verdict, line } : { seats: 0, observedClean: [], configuredOnly: [], api: [], notClean: [], line };
    }
    return { ok: checks.every((c) => c.ok && c.clean), seats: checks, cleanRooms: verdict, unchecked, withheld };
}
