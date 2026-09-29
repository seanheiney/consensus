/**
 * Verified clean rooms: raise a seat's isolation evidence from "we passed the
 * lockdown flags" to "the CLI itself reported what it loaded", and turn the
 * per-seat receipts into one run-level trust line a reader can check.
 *
 * Grok has no startup event listing its surface, but `grok inspect --json`
 * reports the configuration it discovers for a directory (instructions,
 * skills, plugins, MCP servers, hooks) without making a model call. Run once
 * per process in a sandbox built exactly like a seat's, it is observed
 * evidence for every grok seat that follows. See docs/isolation.md.
 */
import type { CleanRooms, IsolationReceipt, SeatIsolation } from "../types.js";
import { foldIsolation } from "./isolation.js";

/** What `grok inspect --json` says a seat would load. */
export interface GrokSurface {
  version?: string;
  /** Agents.md / project-rule files, by path. */
  instructions: string[];
  /** Skill names; the ones grok ships inside its own install are suffixed "@bundled". */
  skills: string[];
  plugins: string[];
  mcpServers: string[];
  /** "<event> (<source>)", e.g. "PreToolUse (user)". */
  hooks: string[];
}

/** How a grok receipt was observed; shown in reports and doctor --isolation. */
export const GROK_OBSERVED_VIA = "grok inspect --json in an identical sandbox";

function arr(v: unknown): Record<string, unknown>[] | undefined {
  return Array.isArray(v) ? v.map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : { name: String(x) })) : undefined;
}

function sourceType(x: Record<string, unknown>): string | undefined {
  const s = x.source;
  if (s && typeof s === "object" && typeof (s as { type?: unknown }).type === "string") return (s as { type: string }).type;
  return typeof s === "string" ? s : undefined;
}

/**
 * Parse `grok inspect --json` output. Returns undefined when the output is not
 * an inspect report (an older grok without the subcommand, an error, a fake),
 * so the caller keeps the weaker "configured" evidence instead of guessing.
 */
export function parseGrokInspect(stdout: string | unknown): GrokSurface | undefined {
  let d: unknown = stdout;
  if (typeof stdout === "string") {
    const start = stdout.indexOf("{");
    if (start < 0) return undefined;
    try {
      d = JSON.parse(stdout.slice(start));
    } catch {
      return undefined;
    }
  }
  if (!d || typeof d !== "object") return undefined;
  const o = d as Record<string, unknown>;
  const instructions = arr(o.projectInstructions);
  const skills = arr(o.skills);
  const plugins = arr(o.plugins);
  const mcpServers = arr(o.mcpServers);
  const hooks = arr(o.hooks);
  // All five lists are required: a report missing one cannot vouch for it.
  if (!instructions || !skills || !plugins || !mcpServers || !hooks) return undefined;
  const name = (x: Record<string, unknown>) => String(x.name ?? x.path ?? "?");
  return {
    version: typeof o.grokVersion === "string" ? o.grokVersion : undefined,
    instructions: instructions.map((x) => String(x.path ?? x.name ?? "?")),
    // Bundled skills ship inside grok's own install (like Claude Code's @builtin plugins), so they
    // are listed but do not make a seat unclean. User, plugin and config skills do.
    skills: skills.map((x) => (sourceType(x) === "bundled" ? `${name(x)}@bundled` : name(x))),
    // A plugin that is installed but disabled still counts: grok found it, and one flag flips it on.
    plugins: plugins.map(name),
    mcpServers: mcpServers.map(name),
    hooks: hooks.map((x) => `${String(x.event ?? "hook")} (${sourceType(x) ?? "unknown source"})`),
  };
}

/** Fold a parsed inspect report into a grok seat's receipt. */
export function observedGrokReceipt(base: IsolationReceipt, s: GrokSurface): IsolationReceipt {
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
  };
}

/**
 * The run-level verdict: how many seats were observed clean, how many are
 * clean only by configuration, and which (if any) were observed not clean.
 */
export function cleanRooms(isolation?: Record<string, SeatIsolation>): CleanRooms | undefined {
  const seats = Object.entries(isolation ?? {});
  if (!seats.length) return undefined;
  // Sorted: receipts land in the order calls finish, which varies from run to run.
  const ids = (f: (s: SeatIsolation) => boolean) => seats.filter(([, s]) => f(s)).map(([id]) => id).sort();
  const notClean = ids((s) => !s.clean);
  const observedClean = ids((s) => s.clean && s.evidence === "observed");
  const configuredOnly = ids((s) => s.clean && s.evidence === "configured");
  const api = ids((s) => s.clean && s.evidence === "request");
  const n = seats.length;
  let line: string;
  if (notClean.length) {
    const rest = [observedClean.length && `${observedClean.length} observed clean`, configuredOnly.length && `${configuredOnly.length} configured-only`, api.length && `${api.length} API with no tools`].filter(Boolean).join(", ");
    line = `Clean rooms: NOT CLEAN: ${notClean.join(", ")}${rest ? `; ${rest}` : ""} (${n} seat${n === 1 ? "" : "s"}).`;
  } else if (observedClean.length === n) {
    line = `Clean rooms: ${n}/${n} seats observed clean.`;
  } else {
    const parts = [
      observedClean.length && `${observedClean.length} observed clean`,
      configuredOnly.length && `${configuredOnly.length} configured-only (${configuredOnly.join(", ")}: lockdown flags, the CLI does not report what it loaded)`,
      api.length && `${api.length} API with no tools attached`,
    ].filter(Boolean);
    line = `Clean rooms: ${parts.join(", ")}.`;
  }
  return { seats: n, observedClean, configuredOnly, api, notClean, line };
}

/** Machine-readable output of `consensus doctor --isolation --json`: one entry per subscription seat checked. */
export interface IsolationCheck {
  id: string;
  ok: boolean;
  clean: boolean;
  receipt?: SeatIsolation;
  error?: string;
}

/** Turn doctor's live probes into checks; a probe that failed or returned no receipt could not be checked, so it fails. */
export function isolationChecks(results: { id: string; ok: boolean; error?: string; isolation?: IsolationReceipt }[]): IsolationCheck[] {
  return results.map((r) => {
    if (!r.ok || !r.isolation) return { id: r.id, ok: false, clean: false, error: r.error ?? "no isolation receipt returned" };
    const receipt = foldIsolation(undefined, r.isolation);
    return { id: r.id, ok: true, clean: receipt.clean, receipt };
  });
}

export function isolationReport(checks: IsolationCheck[], withheld: string[]): { ok: boolean; seats: IsolationCheck[]; cleanRooms?: CleanRooms; withheld: string[] } {
  const folded: Record<string, SeatIsolation> = {};
  for (const c of checks) if (c.receipt) folded[c.id] = c.receipt;
  return { ok: checks.every((c) => c.ok && c.clean), seats: checks, cleanRooms: cleanRooms(folded), withheld };
}
