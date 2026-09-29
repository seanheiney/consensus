/** Needed by any CLI to start, find its login, and reach the network. */
const BASE_ENV = new Set([
    "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "TEMP", "TZ", "LANG", "LANGUAGE",
    "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "XDG_RUNTIME_DIR",
    "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY",
    "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE",
    // Windows
    "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "HOMEDRIVE", "HOMEPATH", "USERNAME", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE",
]);
/**
 * Each vendor's own auth and routing variables. A seat never sees another
 * vendor's keys, and a Claude seat does not inherit the host Claude Code
 * session's CLAUDECODE / CLAUDE_CODE_SESSION_ID / messaging socket.
 */
const VENDOR_ENV = {
    claude: {
        names: ["CLAUDE_CONFIG_DIR", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLOUD_ML_REGION", "GOOGLE_APPLICATION_CREDENTIALS"],
        prefixes: ["ANTHROPIC_", "AWS_"],
    },
    codex: { names: ["CODEX_HOME"], prefixes: ["OPENAI_"] },
    gemini: { names: ["GOOGLE_API_KEY", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION", "GOOGLE_GENAI_USE_VERTEXAI", "GOOGLE_APPLICATION_CREDENTIALS"], prefixes: ["GEMINI_"] },
    grok: { names: [], prefixes: ["XAI_", "GROK_"] },
};
function allowed(vendor, name, extra) {
    const n = name.toUpperCase();
    if (BASE_ENV.has(n) || n.startsWith("LC_") || extra.has(n))
        return true;
    const v = VENDOR_ENV[vendor];
    return !!v && (v.names.includes(n) || v.prefixes.some((p) => n.startsWith(p)));
}
/**
 * The environment a seat's CLI is spawned with: an allow-list, not the parent
 * environment. CONSENSUS_SEAT_ENV="NAME1,NAME2" passes extra names through.
 */
export function seatEnv(vendor, env = process.env) {
    const extra = new Set((env.CONSENSUS_SEAT_ENV ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
    const out = {};
    let dropped = 0;
    for (const [k, v] of Object.entries(env)) {
        if (v === undefined)
            continue;
        if (allowed(vendor, k, extra))
            out[k] = v;
        else
            dropped++;
    }
    return { env: out, passed: Object.keys(out).sort(), dropped };
}
/**
 * The isolation-relevant flags of a CLI invocation. `valueFlags` names the
 * flags whose value is prompt, schema, path or model (they differ per CLI:
 * `-p` is a bare switch for Claude Code but carries the prompt for Gemini),
 * and those values are left out of the receipt.
 */
export function receiptFlags(args, valueFlags) {
    const skip = new Set(valueFlags);
    const out = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (skip.has(a)) {
            i++;
            continue;
        }
        if (a === "-")
            continue;
        out.push(a === "" ? '""' : a);
    }
    return out;
}
/** Tools a clean seat may legitimately report: Claude Code's structured-output tool exists only to return the JSON answer. */
const BENIGN_TOOLS = new Set(["StructuredOutput"]);
/**
 * Plugins and skills that ship inside the CLI itself (Claude Code reports e.g. "telemetry@builtin", grok
 * "<skill>@bundled"); installed ones make a seat not clean. Each suffix is honoured only in its own list,
 * so a plugin named "x@bundled" is still an installed plugin.
 */
const isBuiltinPlugin = (name) => name.endsWith("@builtin");
const isBundledSkill = (name) => name.endsWith("@bundled");
/** Fold one call's receipt into a seat's running record. */
export function foldIsolation(prev, r) {
    const union = (a, b) => (a || b ? [...new Set([...(a ?? []), ...(b ?? [])])].sort() : undefined);
    const tools = union(prev?.tools, r.tools);
    const mcpServers = union(prev?.mcpServers, r.mcpServers);
    const plugins = union(prev?.plugins, r.plugins);
    const skills = union(prev?.skills, r.skills);
    const hooks = union(prev?.hooks, r.hooks);
    const instructions = union(prev?.instructions, r.instructions);
    const other = union(prev?.other, r.other);
    const clean = (prev?.clean ?? true) &&
        !(r.tools ?? []).some((t) => !BENIGN_TOOLS.has(t)) &&
        !(r.mcpServers ?? []).length &&
        !(r.plugins ?? []).some((p) => !isBuiltinPlugin(p)) &&
        !(r.skills ?? []).some((p) => !isBundledSkill(p)) &&
        !(r.hooks ?? []).length &&
        !(r.instructions ?? []).length &&
        !(r.other ?? []).length;
    // Evidence is only as strong as the weakest call.
    const rank = { observed: 2, configured: 1, request: 1 };
    const evidence = prev && rank[prev.evidence] < rank[r.evidence] ? prev.evidence : r.evidence;
    return { ...prev, ...r, evidence, tools, mcpServers, plugins, skills, hooks, instructions, other, calls: (prev?.calls ?? 0) + 1, clean };
}
/** One line per seat for reports and the MCP summary. */
export function describeIsolation(id, s) {
    if (s.route === "api")
        return `${id}: API request with no tools attached (${s.calls} call${s.calls === 1 ? "" : "s"})`;
    const builtins = [...(s.plugins ?? []).filter(isBuiltinPlugin), ...(s.skills ?? []).filter(isBundledSkill)].map((p) => p.replace(/@(builtin|bundled)$/, ""));
    const installed = s.plugins?.filter((p) => !isBuiltinPlugin(p));
    // Grok's inspect report covers skills, hooks and instruction files but not tools (those are off by --tools "").
    const extra = [
        s.skills && `skills ${list(s.skills.filter((p) => !isBundledSkill(p)))}`,
        s.hooks && `hooks ${list(s.hooks)}`,
        s.instructions && `instruction files ${list(s.instructions)}`,
        s.other?.length && `other add-ons ${list(s.other)}`,
    ]
        .filter(Boolean)
        .map((x) => `, ${x}`)
        .join("");
    const seen = s.evidence === "observed"
        ? `observed ${s.observedVia ? `via ${s.observedVia}` : "at startup"}: tools ${s.tools ? list(s.tools.filter((t) => !BENIGN_TOOLS.has(t))) : "off by flag"}, MCP servers ${list(s.mcpServers)}, plugins ${list(installed)}${extra}${builtins.length ? ` (CLI built-ins: ${builtins.join(", ")})` : ""}`
        : "flags only (this CLI does not report its tool list)";
    const env = s.envPassed ? `, ${s.envPassed.length} env vars passed / ${s.envDropped ?? 0} withheld` : "";
    return `${id}: ${s.clean ? "clean" : "NOT CLEAN"}, ${seen}${env}, fresh empty temp dir${s.version ? `, ${s.bin} ${s.version}` : ""} (${s.calls} call${s.calls === 1 ? "" : "s"})`;
}
/** A one-line verdict for a whole run, or undefined when no receipts were recorded. */
export function isolationSummary(isolation) {
    const seats = Object.entries(isolation ?? {});
    if (!seats.length)
        return undefined;
    const dirty = seats.filter(([, s]) => !s.clean).map(([id]) => id);
    const count = (e) => seats.filter(([, s]) => s.evidence === e).length;
    const how = [
        count("observed") && `${count("observed")} observed (the CLI reported what it loaded)`,
        count("configured") && `${count("configured")} by lockdown flags (CLI does not report its tools)`,
        count("request") && `${count("request")} API with no tools attached`,
    ].filter(Boolean).join("; ");
    return dirty.length
        ? `Isolation: NOT CLEAN for ${dirty.join(", ")}; ${seats.length - dirty.length}/${seats.length} clean (${how}).`
        : `Isolation: ${seats.length}/${seats.length} seats clean (${how}); CLI seats ran in empty temp dirs with an allow-listed environment.`;
}
function list(a) {
    return a && a.length ? a.join(", ") : "none";
}
