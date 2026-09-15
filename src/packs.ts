/**
 * Packs: shareable bundles of profiles, personas, and (optionally) a bench
 * suite. One JSON file; seats are portable (`any:<model>`) so a pack resolves
 * against whatever connections the installer has.
 */
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { BenchSuiteSchema } from "./bench.js";
import { ProfileSchema, splitMember, type Config, type Member, type Profile } from "./config.js";
import { PERSONAS } from "./personas.js";
import { parseSpec } from "./providers/index.js";

export const PackSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "lowercase letters, digits and dashes"),
  version: z.string().default("0.1.0"),
  description: z.string().optional(),
  author: z.string().optional(),
  homepage: z.string().optional(),
  personas: z.record(z.string(), z.string()).default({}),
  profiles: z.record(z.string(), ProfileSchema),
  suite: BenchSuiteSchema.optional(),
});
export type Pack = z.infer<typeof PackSchema>;

/** Build a pack from profiles in the current config, bundling the personas they reference. */
export function createPack(cfg: Config, names: string[], meta: { name: string; version?: string; description?: string; author?: string }): Pack {
  const profiles: Record<string, Profile> = {};
  const personas: Record<string, string> = {};
  for (const n of names) {
    const p = cfg.profiles?.[n];
    if (!p) throw new Error(`No profile "${n}". Known: ${Object.keys(cfg.profiles ?? {}).join(", ") || "none"}`);
    const { personas: local, ...rest } = p;
    profiles[n] = { ...rest, panel: p.panel.map(portable) };
    for (const m of p.panel) {
      const { persona } = splitMember(m);
      if (!persona || PERSONAS[persona]) continue;
      const text = local?.[persona] ?? cfg.personas?.[persona];
      if (text) personas[persona] = text;
    }
  }
  return PackSchema.parse({ schemaVersion: 1, name: meta.name, version: meta.version ?? "0.1.0", description: meta.description, author: meta.author, personas, profiles });
}

/** Rewrite a concrete seat to its portable form when the model is a known catalog model. */
export function portable(m: Member): Member {
  const { spec, persona, name } = splitMember(m);
  const p = parseSpec(spec);
  if (p.provider === "any" || p.provider === "compat" || !p.model) return m;
  const model = p.model.includes("/") ? p.model.split("/").pop()! : p.model;
  // OpenRouter ids use dots for Anthropic versions; catalog ids use dashes.
  const id = model.replace(/^claude-(\w+)-(\d)\.(\d)$/, "claude-$1-$2-$3");
  const s = `any:${id}${p.effort ? `#${p.effort}` : ""}`;
  if (typeof m === "string") return persona ? `${s}+${persona}` : s;
  return { ...m, model: s, persona, name };
}

/** Resolve a pack source: local path, http(s) URL, or GitHub shorthand owner/repo[/path/to/pack.json]. */
export function packSourceUrl(source: string): { kind: "file" | "url"; location: string } {
  if (/^https?:\/\//.test(source)) return { kind: "url", location: source };
  if (/^[\w.-]+\/[\w.-]+(\/.+)?$/.test(source) && !source.startsWith(".") && !source.startsWith("/")) {
    const [owner, repo, ...rest] = source.split("/");
    const path = rest.length ? rest.join("/") : "consensus-pack.json";
    return { kind: "url", location: `https://raw.githubusercontent.com/${owner}/${repo}/main/${path}` };
  }
  return { kind: "file", location: source };
}

export async function readPack(source: string): Promise<{ pack: Pack; from: string }> {
  const { kind, location } = packSourceUrl(source);
  let text: string;
  if (kind === "url") {
    const res = await fetch(location);
    if (!res.ok) throw new Error(`Could not fetch ${location}: HTTP ${res.status}`);
    text = await res.text();
  } else text = await readFile(location, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`${location} is not valid JSON: ${(err as Error).message}`);
  }
  const r = PackSchema.safeParse(raw);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new Error(`${location} is not a valid pack: ${i?.path?.join(".") || "root"}: ${i?.message}`);
  }
  return { pack: r.data, from: location };
}

export interface PackDiff {
  newProfiles: string[];
  conflictingProfiles: string[];
  newPersonas: string[];
  conflictingPersonas: string[];
  builtinPersonaOverrides: string[];
  suiteCases: number;
}

export function diffPack(cfg: Config, pack: Pack): PackDiff {
  const profiles = Object.keys(pack.profiles);
  const personas = Object.keys(pack.personas);
  return {
    newProfiles: profiles.filter((n) => !cfg.profiles?.[n]),
    conflictingProfiles: profiles.filter((n) => !!cfg.profiles?.[n]),
    newPersonas: personas.filter((n) => !cfg.personas?.[n]),
    conflictingPersonas: personas.filter((n) => !!cfg.personas?.[n]),
    builtinPersonaOverrides: personas.filter((n) => !!PERSONAS[n]),
    suiteCases: pack.suite?.cases.length ?? 0,
  };
}

/**
 * Merge a pack into the config. Never clobbers an existing profile or persona:
 * conflicts are installed under `<pack>/<name>` unless `force` is set.
 */
export function installPack(cfg: Config, pack: Pack, source: string, opts: { force?: boolean } = {}): { cfg: Config; installedProfiles: string[]; installedPersonas: string[]; renamed: string[] } {
  const next: Config = { ...cfg, profiles: { ...cfg.profiles }, personas: { ...cfg.personas }, packs: { ...cfg.packs } };
  const renamed: string[] = [];
  const installedPersonas: string[] = [];
  const personaMap: Record<string, string> = {};
  for (const [n, text] of Object.entries(pack.personas)) {
    let target = n;
    if ((next.personas![n] !== undefined || PERSONAS[n]) && !opts.force && next.personas![n] !== text) {
      target = `${pack.name}/${n}`;
      renamed.push(`persona ${n} -> ${target}`);
    }
    next.personas![target] = text;
    personaMap[n] = target;
    installedPersonas.push(target);
  }
  const installedProfiles: string[] = [];
  for (const [n, prof] of Object.entries(pack.profiles)) {
    let target = n;
    if (next.profiles![n] && !opts.force) {
      target = `${pack.name}/${n}`;
      renamed.push(`profile ${n} -> ${target}`);
    }
    const panel = prof.panel.map((m) => {
      const { spec, persona, name } = splitMember(m);
      if (!persona || !personaMap[persona] || personaMap[persona] === persona) return m;
      return typeof m === "string" ? `${spec}+${personaMap[persona]}` : { ...m, persona: personaMap[persona], name: name ?? persona };
    });
    next.profiles![target] = { ...prof, panel };
    installedProfiles.push(target);
  }
  next.packs![pack.name] = { source, version: pack.version, installedAt: new Date().toISOString(), profiles: installedProfiles, personas: installedPersonas };
  if (!next.profile && installedProfiles.length) next.profile = installedProfiles[0];
  return { cfg: next, installedProfiles, installedPersonas, renamed };
}

export function removePack(cfg: Config, name: string): Config {
  const rec = cfg.packs?.[name];
  if (!rec) throw new Error(`No installed pack "${name}". Installed: ${Object.keys(cfg.packs ?? {}).join(", ") || "none"}`);
  const next: Config = { ...cfg, profiles: { ...cfg.profiles }, personas: { ...cfg.personas }, packs: { ...cfg.packs } };
  for (const p of rec.profiles) delete next.profiles![p];
  for (const p of rec.personas) delete next.personas![p];
  delete next.packs![name];
  if (next.profile && !next.profiles![next.profile]) next.profile = Object.keys(next.profiles!)[0];
  return next;
}

export function describePack(pack: Pack, from?: string): string {
  const lines = [`${pack.name} v${pack.version}${pack.description ? ` — ${pack.description}` : ""}${pack.author ? ` (by ${pack.author})` : ""}${from ? `\n  from ${from}` : ""}`];
  for (const [n, p] of Object.entries(pack.profiles)) {
    lines.push(`  profile ${n}${p.description ? `: ${p.description}` : ""}`);
    for (const m of p.panel) lines.push(`      ${typeof m === "string" ? m : `${m.model}+${m.name ?? "custom"}`}`);
    lines.push(`      judge ${p.judge ?? "first seat"}, rounds ${p.rounds ?? 3}${p.effort ? `, effort ${p.effort}` : ""}`);
  }
  for (const [n, t] of Object.entries(pack.personas)) lines.push(`  persona ${n}:\n      ${t.replace(/\n/g, "\n      ")}`);
  if (pack.suite) lines.push(`  bench suite: ${pack.suite.cases.length} cases (${pack.suite.cases.map((c) => c.id).join(", ")})`);
  return lines.join("\n");
}
