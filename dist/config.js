import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { configDir } from "./credentials.js";
import { createPanelist, parseSpec, specId } from "./providers/index.js";
import { resolvePersona, withPersona } from "./personas.js";
import { CATALOG_VENDORS, findCatalogModel, pickSeatable, routeFor } from "./catalog.js";
import { formatSpec } from "./providers/index.js";
import { scanVendors } from "./doctor.js";
const EffortSchema = z.enum(["low", "medium", "high", "max"]);
/**
 * A panel member: a model spec string `provider[:model][#effort][+persona]`,
 * or an object with an explicit persona (a library name or inline prompt text).
 */
export const MemberSchema = z.union([
    z.string(),
    z.object({
        model: z.string(),
        persona: z.string().optional(),
        /** Display name for this member (defaults to the persona name). */
        name: z.string().optional(),
    }),
]);
export const ProfileSchema = z.object({
    description: z.string().optional(),
    panel: z.array(MemberSchema).min(2),
    judge: z.string().optional(),
    rounds: z.number().int().min(1).max(10).optional(),
    effort: EffortSchema.optional(),
    /** Profile-local persona library: name -> prompt text. */
    personas: z.record(z.string(), z.string()).optional(),
    /** Set by preset materialization when a tier model was replaced (e.g. gpt-6-astra on an old Codex). */
    substitutions: z.array(z.string()).optional(),
});
export const ConfigSchema = z.object({
    /** Active profile name. */
    profile: z.string().optional(),
    profiles: z.record(z.string(), ProfileSchema).optional(),
    /** User persona library: name -> prompt text. Overrides built-ins of the same name. */
    personas: z.record(z.string(), z.string()).optional(),
    /** Installed packs: name -> provenance. */
    packs: z
        .record(z.string(), z.object({
        source: z.string(),
        version: z.string().optional(),
        installedAt: z.string(),
        profiles: z.array(z.string()),
        personas: z.array(z.string()),
    }))
        .optional(),
    /** Legacy / project-level flat settings (used when no profile is active). */
    panel: z.array(z.string()).optional(),
    judge: z.string().optional(),
    rounds: z.number().int().min(1).max(10).optional(),
    effort: EffortSchema.optional(),
    maxTokens: z.number().int().positive().optional(),
    runsDir: z.string().optional(),
});
export const CONFIG_FILENAMES = ["consensus.config.json", ".consensusrc.json"];
export function userConfigPath() {
    return join(configDir(), "config.json");
}
async function readJson(path) {
    try {
        return JSON.parse(await readFile(path, "utf8"));
    }
    catch (err) {
        if (err.code === "ENOENT")
            return undefined;
        throw new Error(`Failed to read config ${path}: ${err.message}`);
    }
}
/** Problems found in a config file that were skipped rather than fatal. */
export const configWarnings = [];
/**
 * Parse a config leniently: a broken profile is dropped with a one-line warning
 * instead of taking every command down with a schema dump.
 */
export function parseConfigLenient(raw, source) {
    if (!raw || typeof raw !== "object")
        throw new Error(`${source}: expected a JSON object`);
    const obj = { ...raw };
    const profiles = obj.profiles;
    const good = {};
    if (profiles && typeof profiles === "object") {
        for (const [name, prof] of Object.entries(profiles)) {
            const r = ProfileSchema.safeParse(prof);
            if (r.success)
                good[name] = r.data;
            else {
                const issue = r.error.issues[0];
                const where = issue?.path?.length ? ` (${issue.path.join(".")})` : "";
                const msg = issue?.code === "too_small" && issue.path?.[0] === "panel" ? "a panel needs at least 2 seats" : issue?.message ?? "invalid";
                configWarnings.push(`${source}: profile "${name}" skipped: ${msg}${where}`);
            }
        }
        obj.profiles = good;
    }
    const r = ConfigSchema.safeParse(obj);
    if (!r.success) {
        const issue = r.error.issues[0];
        throw new Error(`${source}: ${issue?.path?.join(".") || "config"}: ${issue?.message ?? "invalid"}`);
    }
    return r.data;
}
export async function loadUserConfig() {
    const raw = await readJson(userConfigPath());
    return raw ? parseConfigLenient(raw, userConfigPath()) : {};
}
export async function saveUserConfig(cfg) {
    const path = userConfigPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(ConfigSchema.parse(cfg), null, 2) + "\n");
    return path;
}
/** Project config (cwd) overrides user config; profiles merge by name. */
export async function loadConfig(cwd = process.cwd()) {
    const user = await loadUserConfig();
    let project = {};
    for (const name of CONFIG_FILENAMES) {
        const raw = await readJson(join(cwd, name));
        if (raw) {
            project = parseConfigLenient(raw, join(cwd, name));
            break;
        }
    }
    return { ...user, ...project, profiles: { ...user.profiles, ...project.profiles }, personas: { ...user.personas, ...project.personas } };
}
/** Split `spec+persona` into the model spec and the persona reference. */
export function splitMember(member) {
    if (typeof member !== "string")
        return { spec: member.model, persona: member.persona, name: member.name };
    const plus = member.indexOf("+");
    if (plus === -1)
        return { spec: member };
    // `spec+a+b` stacks personas (same as "a,b" inside a profile), so --panel can express it despite splitting on commas.
    return { spec: member.slice(0, plus), persona: member.slice(plus + 1).replace(/\+/g, ",") };
}
/** Stable id for a member, e.g. "claude:claude-opus-5+skeptic". */
export function memberId(member) {
    const { spec, persona, name } = splitMember(member);
    const base = specId(parseSpec(spec));
    if (!persona)
        return base;
    const inline = persona.length > 40 || /\s/.test(persona);
    return `${base}+${name ?? (inline ? "custom" : persona.split(",")[0])}`;
}
export function buildPanel(members, defaultEffort, judgeSpec, env, personaLibrary = {}) {
    const panel = [];
    for (const m of members) {
        const { spec, persona, name } = splitMember(m);
        const parsed = parseSpec(spec);
        let p = createPanelist(parsed, { effort: defaultEffort, env });
        if (persona)
            p = withPersona(p, resolvePersona(persona, personaLibrary, name));
        panel.push(p);
    }
    const ids = panel.map((p) => p.id);
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup)
        throw new Error(`Duplicate panel member "${dup}". Give repeated models different personas (spec+persona) or names.`);
    let judge = panel[0];
    if (judgeSpec?.startsWith("external:")) {
        // A judge that did not argue the case. Written "external:<spec>".
        const { spec, persona, name } = splitMember(judgeSpec.slice("external:".length));
        let j = createPanelist(parseSpec(spec), { effort: defaultEffort, env });
        if (persona)
            j = withPersona(j, resolvePersona(persona, personaLibrary, name));
        return { panel, judge: j };
    }
    if (judgeSpec) {
        const { spec, persona } = splitMember(judgeSpec);
        const j = parseSpec(spec);
        const explicitModel = spec.includes(":");
        const found = panel.find((p) => {
            const [base, pers] = p.id.split("+");
            const parsedBase = parseSpec(base.startsWith("compat:") ? base : base);
            return parsedBase.provider === j.provider && (!explicitModel || parsedBase.model === j.model) && (!persona || pers === persona);
        });
        if (!found)
            throw new Error(`Judge "${judgeSpec}" is not on the panel (${panel.map((p) => p.id).join(", ")}). The judge must be a seat.`);
        judge = found;
    }
    return { panel, judge };
}
/**
 * Turn portable `any:<model>` members into concrete specs for this machine:
 * the vendor's logged-in CLI, else its API key, else OpenRouter. Fails loudly
 * when a seat cannot be satisfied instead of silently shrinking the panel.
 */
export function resolvePortableMembers(members, statuses) {
    const unsatisfied = [];
    const out = members.map((m) => {
        const { spec, persona, name } = splitMember(m);
        if (!spec.startsWith("any:"))
            return m;
        const parsed = parseSpec(spec);
        const hit = findCatalogModel(parsed.model);
        if (!hit) {
            unsatisfied.push(`${spec} (not a known catalog model)`);
            return m;
        }
        const route = routeFor(hit.vendor, hit.model, statuses);
        if (!route) {
            unsatisfied.push(`${spec} (no ${hit.vendor} connection and no OpenRouter key)`);
            return m;
        }
        const concrete = formatSpec({ provider: route.provider, model: route.model, effort: parsed.effort });
        if (typeof m === "string")
            return persona ? `${concrete}+${persona}` : concrete;
        return { ...m, model: concrete, persona, name };
    });
    if (unsatisfied.length)
        throw new Error(`Cannot seat: ${unsatisfied.join("; ")}. Run \`consensus setup\` to connect more vendors or add an OpenRouter key.`);
    return out;
}
function hasPortable(members) {
    return members.some((m) => splitMember(m).spec.startsWith("any:"));
}
/**
 * Decide who sits on the panel.
 * Priority: --panel flags > --profile / active profile > flat config > auto-detect.
 * Auto-detect prefers a logged-in vendor CLI (subscription) over that vendor's API key.
 */
export async function resolveRun(o) {
    const env = o.env ?? process.env;
    const cfg = o.cfg;
    const library = cfg.personas ?? {};
    let statuses;
    const scan = async () => (statuses ??= await scanVendors(env));
    const concrete = async (members) => (hasPortable(members) ? resolvePortableMembers(members, await scan()) : members);
    const concreteJudge = async (spec) => {
        if (!spec)
            return spec;
        const ext = spec.startsWith("external:");
        const bare = ext ? spec.slice("external:".length) : spec;
        if (!bare.startsWith("any:"))
            return spec;
        const [m] = resolvePortableMembers([bare], await scan());
        const out = typeof m === "string" ? m : m.model;
        return ext ? `external:${out}` : out;
    };
    if (o.panel?.length) {
        const { panel, judge } = buildPanel(await concrete(o.panel), o.effort ?? cfg.effort, await concreteJudge(o.judge ?? cfg.judge), env, library);
        return { panel, judge, rounds: o.rounds ?? cfg.rounds ?? 3, effort: o.effort ?? cfg.effort ?? "high", source: "flags" };
    }
    const profileName = o.profile ?? cfg.profile;
    if (profileName) {
        const prof = cfg.profiles?.[profileName];
        if (!prof) {
            const known = Object.keys(cfg.profiles ?? {});
            throw new Error(`Unknown profile "${profileName}". ${known.length ? `Known: ${known.join(", ")}` : "No profiles defined; run `consensus setup` or `consensus profile create`."}`);
        }
        const effort = o.effort ?? prof.effort ?? cfg.effort ?? "high";
        const { panel, judge } = buildPanel(await concrete(prof.panel), effort, await concreteJudge(o.judge ?? prof.judge), env, { ...library, ...prof.personas });
        return { panel, judge, rounds: o.rounds ?? prof.rounds ?? cfg.rounds ?? 3, effort, profile: profileName, source: "profile" };
    }
    if (cfg.panel?.length) {
        const { panel, judge } = buildPanel(await concrete(cfg.panel), o.effort ?? cfg.effort, await concreteJudge(o.judge ?? cfg.judge), env, library);
        return { panel, judge, rounds: o.rounds ?? cfg.rounds ?? 3, effort: o.effort ?? cfg.effort ?? "high", source: "config" };
    }
    const specs = await autoDetectSpecs(env);
    if (specs.length < 2) {
        throw new Error(`Need at least 2 connected models, found ${specs.length}. Run \`consensus setup\` to connect your subscriptions or add API keys, or pass --panel.`);
    }
    const { panel, judge } = buildPanel(specs, o.effort ?? cfg.effort, o.judge ?? cfg.judge, env, library);
    return { panel, judge, rounds: o.rounds ?? cfg.rounds ?? 3, effort: o.effort ?? cfg.effort ?? "high", source: "auto" };
}
/**
 * One spec per reachable vendor: its logged-in CLI, else its API key, else
 * the vendor's default model through OpenRouter. Frontier tier by default.
 */
export async function autoDetectSpecs(env = process.env) {
    const statuses = await scanVendors(env);
    const specs = [];
    for (const vendor of CATALOG_VENDORS) {
        const direct = statuses.find((s) => s.vendor === vendor && s.connected);
        if (direct?.spec) {
            specs.push(direct.spec);
            continue;
        }
        const pick = pickSeatable(vendor, "frontier", statuses);
        if (pick)
            specs.push(pick.spec());
    }
    return specs;
}
