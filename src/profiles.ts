/** Interactive model selector for building / editing profiles. */
import * as p from "@clack/prompts";
import { CATALOG, CATALOG_VENDORS, PRESETS, directRouteBlocker, pickSeatable, priceLabel, routeFor, specFor, type Preset } from "./catalog.js";
import { splitMember, type Member, type Profile } from "./config.js";
import { PERSONAS } from "./personas.js";
import type { VendorStatus } from "./doctor.js";
import { VENDORS, formatSpec, parseSpec, specId, type ParsedSpec } from "./providers/index.js";
import type { Effort } from "./types.js";

const EFFORTS: { value: Effort; label: string; hint: string }[] = [
  { value: "low", label: "low", hint: "fast, cheap, shallow" },
  { value: "medium", label: "medium", hint: "routine" },
  { value: "high", label: "high", hint: "default; hard problems" },
  { value: "xhigh", label: "xhigh", hint: "Claude Code's default for coding; Claude, OpenAI and Codex support it, others map to high" },
  { value: "max", label: "max", hint: "slowest, most thorough" },
];

function bail(v: unknown): asserts v is NonNullable<unknown> {
  if (p.isCancel(v)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
}

/** Materialize one preset against the connected vendors; undefined if it can't be satisfied. */
export function materializePreset(preset: Preset, statuses: VendorStatus[]): Profile | undefined {
  const panel: string[] = [];
  if (preset.shape === "personas") {
    // Best available vendor in catalog order, at the requested tier.
    let base: string | undefined;
    for (const vendor of CATALOG_VENDORS) {
      const pick = pickSeatable(vendor, preset.tier!, statuses);
      if (pick) {
        base = pick.spec(preset.effort);
        break;
      }
    }
    if (!base) return undefined;
    if (preset.name === "red-team") {
      for (const vendor of CATALOG_VENDORS) {
        const pick = pickSeatable(vendor, preset.tier!, statuses);
        if (pick) panel.push(pick.spec(preset.effort));
      }
      for (const persona of preset.personas!) panel.push(`${base}+${persona}`);
    } else {
      for (const persona of preset.personas!) panel.push(`${base}+${persona}`);
    }
    if (panel.length < 2) return undefined;
    return { description: preset.description, panel, captain: "auto", rounds: preset.rounds, effort: preset.effort };
  }
  const substitutions: string[] = [];
  if (preset.shape === "per-vendor") {
    for (const vendor of CATALOG_VENDORS) {
      const pick = pickSeatable(vendor, preset.tier!, statuses);
      if (pick) {
        panel.push(pick.spec(preset.effort));
        if (pick.substituted) substitutions.push(`${pick.model.id} instead of ${pick.substituted}`);
      }
    }
  } else {
    for (const m of CATALOG[preset.vendor!]) {
      const spec = specFor(preset.vendor!, m, statuses, preset.effort);
      if (spec) panel.push(spec);
      else if (statuses.some((s) => s.vendor === preset.vendor && s.connected)) substitutions.push(`${m.id} left out: ${directRouteBlocker(preset.vendor!, m, statuses) ?? "not seatable"}`);
    }
  }
  if (panel.length < 2) return undefined;
  return { description: preset.description, panel, captain: "auto", rounds: preset.rounds, effort: preset.effort, ...(substitutions.length ? { substitutions } : {}) };
}

/** Every preset your connections can satisfy. Judges rotate across seats so no vendor is always the judge. */
export function starterProfiles(statuses: VendorStatus[]): Record<string, Profile> {
  const out: Record<string, Profile> = {};
  let i = 0;
  for (const preset of PRESETS) {
    const prof = materializePreset(preset, statuses);
    if (!prof) continue;
    // The captain (best available model, neutral when possible) moderates and reports.
    prof.captain = "auto";
    delete prof.judge;
    i++;
    out[preset.name] = prof;
  }
  return out;
}

interface Option {
  value: string; // provider:model
  label: string;
  hint?: string;
}

function modelOptions(statuses: VendorStatus[]): Option[] {
  const opts: Option[] = [];
  for (const vendor of CATALOG_VENDORS) {
    const v = VENDORS.find((x) => x.vendor === vendor)!;
    const s = statuses.find((x) => x.vendor === vendor);
    for (const m of CATALOG[vendor]) {
      const route = routeFor(vendor, m, statuses);
      const value = route ? `${route.provider}:${route.model}` : `${v.api}:${m.id}`;
      const via = !route ? "not connected" : route.viaOpenRouter ? "via OpenRouter" : s?.via === "cli" ? `${v.cli} subscription` : "API key";
      opts.push({
        value,
        label: `${m.label.padEnd(26)} ${priceLabel(m).padEnd(18)} ${m.tier}`,
        hint: `${via}${m.note ? `; ${m.note}` : ""}`,
      });
    }
  }
  return opts;
}

/** Walk the user through building a profile. `existing` pre-fills the editor. */
export async function editProfile(statuses: VendorStatus[], existing?: Profile, name?: string): Promise<{ name: string; profile: Profile }> {
  const options = modelOptions(statuses);
  const existingMembers = (existing?.panel ?? []).map(splitMember);
  const existingParsed = existingMembers.map((m) => parseSpec(m.spec));
  const known = new Set(options.map((o) => o.value));
  for (const e of existingParsed) {
    const id = specId(e);
    if (!known.has(id)) {
      options.push({ value: id, label: id, hint: "custom" });
      known.add(id);
    }
  }
  options.push({ value: "__custom__", label: "Other…", hint: "type a spec like openai:gpt-6-astra or compat:model@http://host/v1" });

  const profileName =
    name ??
    (await (async () => {
      const v = await p.text({ message: "Profile name", placeholder: "frontier", initialValue: "", validate: (s) => (!s?.trim() ? "Required" : /\s/.test(s) ? "No spaces" : undefined) });
      bail(v);
      return String(v).trim();
    })());

  const picked = await p.multiselect({
    message: "Models on the panel (space to toggle, enter to confirm)",
    options,
    initialValues: [...new Set(existingParsed.map(specId))],
    required: true,
  });
  bail(picked);
  let specs: ParsedSpec[] = (picked as string[]).filter((v) => v !== "__custom__").map(parseSpec);
  if ((picked as string[]).includes("__custom__")) {
    const custom = await p.text({ message: "Custom specs, comma-separated", placeholder: "openai:gpt-6-astra, ollama:qwen3" });
    bail(custom);
    specs.push(...String(custom).split(",").map((s) => s.trim()).filter(Boolean).map(parseSpec));
  }
  if (!specs.length) {
    p.log.error("Pick at least one model.");
    return editProfile(statuses, existing, profileName);
  }

  const effortMode = await p.select({
    message: "Reasoning effort",
    options: [...EFFORTS.map((e) => ({ value: e.value as string, label: `${e.label} for every model`, hint: e.hint })), { value: "per-model", label: "Choose per model" }],
    initialValue: existing?.effort ?? "high",
  });
  bail(effortMode);
  let effort: Effort = "high";
  if (effortMode === "per-model") {
    for (const s of specs) {
      const e = await p.select({ message: `Effort for ${specId(s)}`, options: EFFORTS, initialValue: existingParsed.find((x) => specId(x) === specId(s))?.effort ?? "high" });
      bail(e);
      s.effort = e as Effort;
    }
  } else {
    effort = effortMode as Effort;
    specs = specs.map((s) => ({ ...s, effort: undefined }));
  }

  // ---- personas: turn models into members ---------------------------------
  const personaOptions = [
    ...Object.values(PERSONAS).map((x) => ({ value: x.name, label: x.name.padEnd(18), hint: x.description })),
    { value: "__custom__", label: "Custom…", hint: "write your own preprompt" },
  ];
  const existingPersonas = existingMembers.filter((m) => m.persona).map((m) => m.persona!);
  const personaMode = await p.select({
    message: "Personas (a preprompt per seat; the same model can hold several seats)",
    options: [
      { value: "none", label: "None — one seat per model" },
      { value: "shared", label: "Same set of personas on every model", hint: "N models × K personas seats" },
      { value: "per-model", label: "Choose personas per model" },
    ],
    initialValue: existingPersonas.length ? (specs.length > 1 ? "per-model" : "shared") : "none",
  });
  bail(personaMode);
  const customPersonas: Record<string, string> = { ...existing?.personas };
  const pickPersonas = async (label: string, initial: string[]): Promise<string[]> => {
    const sel = await p.multiselect({ message: `Personas for ${label} (none = plain seat)`, options: personaOptions, initialValues: initial, required: false });
    bail(sel);
    const out = (sel as string[]).filter((v) => v !== "__custom__");
    if ((sel as string[]).includes("__custom__")) {
      const cname = await p.text({ message: "Persona name", placeholder: "einstein", validate: (v) => (!v?.trim() ? "Required" : /\s/.test(v) ? "No spaces" : undefined) });
      bail(cname);
      const ctext = await p.text({ message: "Preprompt", placeholder: "You are Albert Einstein. Reason with thought experiments and…" , validate: (v) => (!v?.trim() ? "Required" : undefined) });
      bail(ctext);
      customPersonas[String(cname).trim()] = String(ctext).trim();
      out.push(String(cname).trim());
    }
    return out;
  };
  const members: string[] = [];
  if (personaMode === "none") members.push(...specs.map(formatSpec));
  else if (personaMode === "shared") {
    const chosen = await pickPersonas("every model", existingPersonas);
    for (const s of specs) {
      if (!chosen.length) members.push(formatSpec(s));
      for (const c of chosen) members.push(`${formatSpec(s)}+${c}`);
    }
  } else {
    for (const s of specs) {
      const initial = existingMembers.filter((m) => specId(parseSpec(m.spec)) === specId(s) && m.persona).map((m) => m.persona!);
      const chosen = await pickPersonas(specId(s), initial);
      const plain = await p.confirm({ message: `Also seat ${specId(s)} once with no persona?`, initialValue: !chosen.length });
      bail(plain);
      if (plain || !chosen.length) members.push(formatSpec(s));
      for (const c of chosen) members.push(`${formatSpec(s)}+${c}`);
    }
  }
  if (members.length < 2) {
    p.log.error("A panel needs at least 2 seats. Add a model or a persona.");
    return editProfile(statuses, { ...(existing ?? {}), panel: members.length ? members : specs.map(formatSpec), personas: customPersonas } as Profile, profileName);
  }

  const captain = await p.select({
    message: "Captain (moderates, referees, and writes the report)",
    options: [
      { value: "auto", label: "auto", hint: "best available model (separate thread, even if a seat uses it)" },
      { value: "neutral", label: "neutral", hint: "best model of a vendor not on the panel" },
      ...members.map((m) => ({ value: m.replace(/#\w+(?=\+|$)/, ""), label: `seat: ${m}` })),
      { value: "none", label: "none", hint: "no moderation; the first seat writes the synthesis" },
    ],
    initialValue: existing?.captain ?? "auto",
  });
  bail(captain);

  const rounds = await p.select({
    message: "Max debate rounds",
    options: [1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n), hint: n === 1 ? "critique only" : n === 3 ? "default" : undefined })),
    initialValue: existing?.rounds ?? 3,
  });
  bail(rounds);

  const description = await p.text({ message: "Description (optional)", initialValue: existing?.description ?? "", placeholder: "Frontier models, max effort" });
  bail(description);

  return {
    name: profileName,
    profile: {
      description: String(description).trim() || undefined,
      panel: members,
      captain: String(captain),
      rounds: Number(rounds),
      effort: effortMode === "per-model" ? undefined : effort,
      personas: Object.keys(customPersonas).length ? customPersonas : undefined,
    },
  };
}

export function memberLabel(m: Member): string {
  if (typeof m === "string") return m;
  return `${m.model}+${m.name ?? (m.persona && m.persona.length <= 40 && !/\s/.test(m.persona) ? m.persona : "custom")}`;
}

/** Problems a profile would hit at run time that are visible statically (unknown personas). */
export function profileWarnings(prof: Profile, library: Record<string, string>): string[] {
  const out: string[] = [];
  const check = (ref: string | undefined) => {
    if (!ref) return;
    for (const raw of ref.split(",")) {
      const name = raw.trim().replace(/-\d+$/, "");
      if (!name || name.length > 40 || /\s/.test(name)) continue; // empty or inline text
      if (!PERSONAS[name] && !library[name]) out.push(`persona "${name}" is not defined (consensus personas; persona add ${name} "...")`);
    }
  };
  for (const m of prof.panel) check(typeof m === "string" ? splitMember(m).persona : m.persona && (m.persona.length > 40 || /\s/.test(m.persona)) ? undefined : m.persona);
  if (prof.judge) check(splitMember(prof.judge.replace(/^external:/, "")).persona);
  return out;
}

export function describeProfile(name: string, prof: Profile, active: boolean): string {
  const head = `${active ? "* " : "  "}${name}${prof.description ? `  — ${prof.description}` : ""}`;
  const body = prof.panel.map((s) => `      ${memberLabel(s)}`).join("\n");
  const cap = prof.captain ?? "auto";
  const meta = `      captain ${cap}${prof.judge ? `, judge ${prof.judge}` : cap === "none" ? `, judge ${memberLabel(prof.panel[0]!)}` : ""}, rounds ${prof.rounds ?? 3}${prof.effort ? `, effort ${prof.effort}` : ""}${prof.substitutions?.length ? `\n      substituted: ${prof.substitutions.join("; ")}` : ""}`;
  return `${head}\n${body}\n${meta}`;
}
