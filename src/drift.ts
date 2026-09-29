/**
 * Decision drift. `consensus adr --recheck` puts a recorded decision's question
 * back to a panel, asks one judge whether the new answer still says the same
 * thing, and appends what it found to the record. The original text is never
 * touched: a record only ever grows a dated "Rechecked" section at the end.
 */
import { appendFile, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { ConsensusRun, Effort, Panelist } from "./types.js";
import type { Config, ResolvedRun } from "./config.js";
import { loadConfig, resolveRun } from "./config.js";
import { credentialEnv } from "./credentials.js";
import type { VendorStatus } from "./doctor.js";
import { preflight, scanVendors } from "./doctor.js";
import { statedConfidence } from "./escalate.js";
import { extractJson } from "./protocol/json.js";
import { ConsensusEngine, toStrictJsonSchema } from "./protocol/engine.js";
import { dim, log, progressLogger, red, yellow } from "./progress.js";
import { fromRepoPath, loadRun, saveRun } from "./store.js";

export const ADR_MARKER = "consensus-adr";
const RECHECK_MARKER = "consensus-recheck";

/** What `consensus adr` records for a later recheck, in an HTML comment at the end of the record. */
export interface AdrMeta {
  v: 1;
  run: string;
  profile?: string;
  /** Seat specs (`provider:model#effort+persona`) as they sat on the panel. */
  panel: string[];
  rounds?: number;
  effort?: Effort;
  /** Whether the panel was given context beyond the question. The context itself stays out of the repo. */
  context: "none" | "given";
  /** The file the context was read from, when it came from `-c <file>`. */
  contextFile?: string;
}

/** A seat as a member spec that resolveRun can seat again. */
export function seatSpec(seat: ConsensusRun["seats"][number]): string {
  const suffix = seat.persona ? `+${seat.persona}` : "";
  const base = suffix && seat.id.endsWith(suffix) ? seat.id.slice(0, -suffix.length) : seat.id;
  return `${base}${seat.effort ? `#${seat.effort}` : ""}${suffix}`;
}

/** The heading escalationContext() puts before the first-pass draft it adds to an escalated run's context. */
const ESCALATION_HEADING = "## A faster panel's first pass";

/**
 * The context the user supplied. An escalated run's saved context also carries the
 * cheaper panel's draft; that draft is not part of the question and is cut off here.
 */
export function userContext(run: Pick<ConsensusRun, "context" | "escalation">): string | undefined {
  let ctx = run.context;
  if (ctx && run.escalation) {
    const i = ctx.lastIndexOf(ESCALATION_HEADING);
    if (i !== -1) ctx = ctx.slice(0, i);
  }
  return ctx?.trim() ? ctx : undefined;
}

export function adrMeta(run: ConsensusRun): AdrMeta {
  return {
    v: 1,
    run: run.id,
    ...(run.profile ? { profile: run.profile } : {}),
    panel: run.seats.map(seatSpec),
    rounds: run.options.rounds,
    effort: run.options.defaultEffort,
    context: userContext(run) ? "given" : "none",
    ...(run.contextFile ? { contextFile: run.contextFile } : {}),
  };
}

/** The marker line: JSON in an HTML comment, invisible when rendered. `>` is escaped so the comment cannot close early. */
export function adrMarker(run: ConsensusRun): string {
  return `<!-- ${ADR_MARKER} ${JSON.stringify(adrMeta(run)).replace(/>/g, "\\u003e")} -->`;
}

export interface ParsedAdr {
  title: string;
  question: string;
  /** The decision as recorded. Rechecks compare against this, never against an earlier recheck. */
  decision: string;
  runId: string;
  panel: string[];
  meta?: AdrMeta;
  /** Rechecks already appended, oldest first. */
  rechecks: { date: string; verdict: string; run: string }[];
}

function between(text: string, start: string, ends: string[]): string | undefined {
  const i = text.indexOf(start);
  if (i === -1) return undefined;
  const from = i + start.length;
  const stops = ends.map((e) => text.indexOf(e, from)).filter((j) => j !== -1);
  return text.slice(from, stops.length ? Math.min(...stops) : undefined).trim() || undefined;
}

/**
 * Read a record written by `consensus adr`. Returns undefined for anything else:
 * records written by hand or by another tool are not ours to recheck.
 */
export function parseAdr(text: string): ParsedAdr | undefined {
  const src = text.replace(/\r\n/g, "\n");
  let meta: AdrMeta | undefined;
  const m = src.match(new RegExp(`<!--\\s*${ADR_MARKER}\\s+(\\{.*?\\})\\s*-->`));
  if (m) {
    try {
      const raw = JSON.parse(m[1]!) as AdrMeta;
      if (raw && typeof raw.run === "string" && Array.isArray(raw.panel)) meta = raw;
    } catch {
      /* a damaged marker falls back to the record's own layout */
    }
  }
  // Records written before the marker existed still carry this exact layout.
  const legacy = /^- \*\*Decided by:\*\* a consensus panel of/m.test(src) ? src.match(/^- Replay: `consensus log ([^`\s]+)`/m)?.[1] : undefined;
  const runId = meta?.run ?? legacy;
  if (!runId) return undefined;
  const question = between(src, "\n## Question\n", ["\n## Decision\n"]);
  const decision = between(src, "\n## Decision\n", ["\n## What the panel agreed on\n", "\n## Confidence\n"]);
  if (!question || !decision) return undefined;
  const title = src.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? question;
  const panelBlock = between(src, "\n## The panel\n", ["\n## "]) ?? "";
  const panel =
    meta?.panel ??
    panelBlock
      .split("\n")
      .filter((l) => l.startsWith("- ") && !/^- (Captain|Report written by):/.test(l))
      .map((l) => l.slice(2).split(/\s/)[0]!)
      .filter(Boolean);
  const rechecks = [...src.matchAll(new RegExp(`<!--\\s*${RECHECK_MARKER}\\s+(\\{.*?\\})\\s*-->`, "g"))].flatMap((x) => {
    try {
      return [JSON.parse(x[1]!) as { date: string; verdict: string; run: string }];
    } catch {
      return [];
    }
  });
  return { title, question, decision, runId, panel, meta, rechecks };
}

/** Markdown files in an ADR directory, in record order. */
export async function listAdrFiles(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    throw new Error(`No decision records in ${dir}. Pass --dir <path>, or name the records to recheck.`);
  }
  return names.filter((n) => n.toLowerCase().endsWith(".md")).sort().map((n) => join(dir, n));
}

// ---- the judge -------------------------------------------------------------

export const DriftVerdictSchema = z.object({
  verdict: z.enum(["unchanged", "refined", "changed"]),
  /** One paragraph: what is different, or why nothing material is. */
  delta: z.string().min(1),
});
export type DriftVerdict = z.infer<typeof DriftVerdictSchema>;

export function driftPrompt(question: string, decision: string, answer: string): string {
  return `A team recorded a decision some time ago. The same question has just been put to a panel again. Say whether the new answer still supports the recorded decision.

## The question

${question.trim()}

## The recorded decision

${decision.trim()}

## The new answer

${answer.trim()}

## Your task

Classify the new answer against the recorded decision:
- "unchanged": it recommends the same thing, for materially the same reasons. Different wording, ordering or detail does not count.
- "refined": the same core recommendation still stands, but the new answer adds a condition, caveat, threshold or step that a reader of the record should know about.
- "changed": the new answer recommends something different, reverses the decision, or narrows it so much that the record would mislead someone who follows it today.

When unsure between two verdicts, pick the one that asks for more attention. Then write one paragraph (at most five sentences) on the delta: what specifically differs and why it matters, or, for "unchanged", what the new answer confirms.

Respond with ONLY a JSON object: {"verdict": "unchanged" | "refined" | "changed", "delta": "<one paragraph>"}`;
}

/** One judge call with a strict structured output. No repair round: a verdict that does not parse is an error, not a guess. */
export async function judgeDrift(judge: Panelist, question: string, decision: string, answer: string, signal?: AbortSignal): Promise<DriftVerdict> {
  const res = await judge.complete({
    system: "You compare a recorded decision with a fresh answer to the same question. You are exact and you never pad.",
    messages: [{ role: "user", content: driftPrompt(question, decision, answer) }],
    json: true,
    jsonSchema: toStrictJsonSchema(DriftVerdictSchema),
    effort: "medium",
    phase: "grade",
    signal,
  });
  try {
    return DriftVerdictSchema.parse(extractJson(res.text));
  } catch (err) {
    throw new Error(`The judge (${judge.id}) did not return a usable verdict: ${(err as Error).message.split("\n")[0]}`);
  }
}

// ---- recheck ---------------------------------------------------------------

/** The panel a record will be rechecked with, and in plain words why that one. */
export interface PanelChoice {
  resolved: ResolvedRun;
  /** e.g. `recorded profile "balanced"`, `recorded panel`, `active profile "fast"`. */
  source: string;
  /** Set when the recorded panel could not be seated and something else was used. */
  note?: string;
}

export interface RecheckDeps {
  /** Pick the panel for one record. Makes no model calls. */
  choosePanel(adr: ParsedAdr): Promise<PanelChoice>;
  /** Debate the question with that panel. */
  runPanel(resolved: ResolvedRun, prompt: string, context: string | undefined): Promise<ConsensusRun>;
  /** The saved run a record points at, if this machine still has it. */
  loadSavedRun(id: string): Promise<ConsensusRun | undefined>;
  /** Persist the new run so its id can be replayed. Returns where it went. */
  saveRun?(run: ConsensusRun): Promise<string | undefined>;
  readFile?(path: string): Promise<string>;
  now?(): Date;
  signal?: AbortSignal;
  onProgress?(message: string): void;
}

export type RecheckStatus = "unchanged" | "refined" | "changed" | "skipped" | "planned" | "error";

export interface RecheckResult {
  file: string;
  status: RecheckStatus;
  /** Why a record was skipped, or what went wrong. */
  reason?: string;
  title?: string;
  panel?: string[];
  panelSource?: string;
  panelNote?: string;
  /** How the original context was (or was not) recovered. */
  contextNote?: string;
  delta?: string;
  confidence?: string;
  runId?: string;
  runDir?: string;
  /** Seats that dropped out of the new run. */
  dropped?: string[];
}

/** Where the question and context come from, most faithful first. */
export async function recoverInput(adr: ParsedAdr, deps: Pick<RecheckDeps, "loadSavedRun" | "readFile">): Promise<{ prompt: string; context?: string; note?: string }> {
  const saved = await deps.loadSavedRun(adr.runId).catch(() => undefined);
  if (saved) return { prompt: saved.prompt, context: userContext(saved) };
  if (adr.meta?.context === "none") return { prompt: adr.question };
  const file = adr.meta?.contextFile;
  if (file) {
    const text = await (deps.readFile ?? ((p: string) => readFile(fromRepoPath(p), "utf8")))(file).catch(() => undefined);
    if (text !== undefined) return { prompt: adr.question, context: text, note: `The saved run \`${adr.runId}\` is not on this machine, so the context was re-read from \`${file}\`, which may have changed since the decision.` };
  }
  if (adr.meta?.context === "given") return { prompt: adr.question, note: `The original context was not stored and could not be recovered (saved run \`${adr.runId}\` not found${file ? `, \`${file}\` unreadable` : ""}), so this recheck used the question alone.` };
  return { prompt: adr.question, note: `The saved run \`${adr.runId}\` is not on this machine, so any context the original panel saw could not be recovered; this recheck used the question alone.` };
}

function seatsOf(r: ResolvedRun): string[] {
  return r.panel.map((p) => p.id);
}

/** The dated section appended to a record. */
export function renderRecheck(r: {
  date: string;
  verdict: DriftVerdict;
  panel: string[];
  captain?: string;
  judge: string;
  panelSource: string;
  panelNote?: string;
  contextNote?: string;
  confidence: string;
  runId: string;
  /** Seats that dropped out of the new run, with why. */
  dropped?: Record<string, string>;
}): string {
  const dropped = Object.entries(r.dropped ?? {});
  const lines = [
    `## Rechecked ${r.date}`,
    "",
    `- **Verdict:** ${r.verdict.verdict}`,
    `- **Panel:** ${r.panel.join(", ")} (${r.panelSource})${r.captain ? `; captain ${r.captain}` : ""}; verdict by ${r.judge}`,
    ...(r.panelNote ? [`- **Panel note:** ${r.panelNote}`] : []),
    ...(dropped.length ? [`- **Dropped seats:** ${dropped.map(([id, why]) => `${id} (${inline(why.split("\n")[0]!)})`).join("; ")}; the verdict rests on the seats that answered`] : []),
    `- **New confidence:** ${r.confidence}`,
    `- **Run:** \`${r.runId}\` (replay: \`consensus log ${r.runId}\`)`,
    ...(r.contextNote ? [`- **Context:** ${r.contextNote}`] : []),
    "",
    inline(r.verdict.delta),
    "",
    `_Appended by \`consensus adr --recheck\`. The decision above is the original record and was not edited._`,
    "",
    `<!-- ${RECHECK_MARKER} ${JSON.stringify({ date: r.date, verdict: r.verdict.verdict, run: r.runId }).replace(/>/g, "\\u003e")} -->`,
    "",
  ];
  return lines.join("\n");
}

/**
 * Model-written text as one plain paragraph. HTML comment delimiters are broken up so
 * the text cannot hide the rest of the record when rendered, or plant a marker that a
 * later recheck would read back as the record's panel; a leading `#` cannot make a heading.
 */
function inline(text: string): string {
  return text
    .replace(/\s*\n\s*/g, " ")
    .trim()
    .replace(/<!--/g, "<\u200b!--")
    .replace(/--(?=>)/g, "-\u200b-")
    .replace(/^#/, "\\#");
}

/**
 * Recheck each record in turn. Records not written by `consensus adr` are
 * skipped; a failure on one record is reported and the rest still run.
 */
export async function recheckAdrs(files: string[], o: { dryRun?: boolean; deps: RecheckDeps }): Promise<RecheckResult[]> {
  const { deps } = o;
  const read = deps.readFile ?? ((p: string) => readFile(p, "utf8"));
  const out: RecheckResult[] = [];
  for (const file of files) {
    if (deps.signal?.aborted) {
      out.push({ file, status: "error", reason: "not rechecked: interrupted" });
      continue;
    }
    let original: string;
    try {
      original = await read(file);
    } catch (err) {
      out.push({ file, status: "error", reason: `cannot read it: ${(err as Error).message}` });
      continue;
    }
    const adr = parseAdr(original);
    if (!adr) {
      out.push({ file, status: "skipped", reason: "not written by `consensus adr` (no consensus marker or record layout)" });
      continue;
    }
    try {
      const input = await recoverInput(adr, deps);
      const choice = await deps.choosePanel(adr);
      const base: RecheckResult = { file, status: "planned", title: adr.title, panel: seatsOf(choice.resolved), panelSource: choice.source, panelNote: choice.note, contextNote: input.note };
      if (o.dryRun) {
        out.push(base);
        continue;
      }
      deps.onProgress?.(`${file}: rechecking with ${base.panel!.join(", ")} (${choice.source})`);
      const run = await deps.runPanel(choice.resolved, input.prompt, input.context);
      const runDir = await deps.saveRun?.(run).catch(() => undefined);
      const answer = answerOf(run.synthesis);
      const judge = choice.resolved.captain ?? choice.resolved.judge;
      const verdict = await judgeDrift(judge, input.prompt, adr.decision, answer, deps.signal);
      const confidence = statedConfidence(run.synthesis) ?? "not stated by the panel";
      const section = renderRecheck({
        date: (deps.now?.() ?? new Date()).toISOString().slice(0, 10),
        verdict,
        panel: base.panel!,
        captain: choice.resolved.captain?.id,
        judge: judge.id,
        panelSource: choice.source,
        panelNote: choice.note,
        contextNote: input.note,
        confidence,
        runId: run.id,
        dropped: run.dropped,
      });
      // Append only: the original bytes stay a prefix of the file.
      await appendFile(file, `${original.endsWith("\n") ? "" : "\n"}\n${section}`);
      const dropped = Object.keys(run.dropped ?? {});
      out.push({ ...base, status: verdict.verdict, delta: verdict.delta, confidence, runId: run.id, runDir, ...(dropped.length ? { dropped } : {}) });
    } catch (err) {
      out.push({ file, status: "error", title: adr.title, reason: (err as Error).message.split("\n")[0] });
    }
  }
  return out;
}

function answerOf(synthesis: string): string {
  return synthesis.match(/^#+\s*Answer\s*\n([\s\S]*?)(?=\n#|$)/im)?.[1]?.trim() || synthesis.trim();
}

/** 1 if any decision changed (a scheduled job can open an issue on it), 3 if any recheck failed, else 0. */
export function recheckExitCode(results: RecheckResult[]): number {
  if (results.some((r) => r.status === "changed")) return 1;
  if (results.some((r) => r.status === "error")) return 3;
  return 0;
}

/**
 * The CLI's panel choice: --profile if given; else the profile the record names,
 * if it still exists; else the recorded seats; and when those no longer resolve,
 * the active profile (or whatever `consensus` would seat today), saying so.
 */
export function panelChooser(o: { cfg: Config; profile?: string; env: NodeJS.ProcessEnv; statuses: () => Promise<VendorStatus[]> }): (adr: ParsedAdr) => Promise<PanelChoice> {
  const seatable = async (r: ResolvedRun): Promise<string[]> => preflight(r.panel, await o.statuses(), o.env);
  return async (adr) => {
    if (o.profile) return { resolved: await resolveRun({ cfg: o.cfg, profile: o.profile, env: o.env }), source: `--profile "${o.profile}"` };
    const problems: string[] = [];
    const recorded = adr.meta?.profile;
    if (recorded) {
      try {
        const r = await resolveRun({ cfg: o.cfg, profile: recorded, env: o.env });
        const bad = await seatable(r);
        if (!bad.length) return { resolved: r, source: `recorded profile "${recorded}"` };
        problems.push(...bad);
      } catch (err) {
        problems.push(`profile "${recorded}": ${(err as Error).message.split("\n")[0]}`);
      }
    }
    if (adr.panel.length) {
      try {
        const r = await resolveRun({ cfg: o.cfg, panel: adr.panel, rounds: adr.meta?.rounds, effort: adr.meta?.effort, env: o.env });
        const bad = await seatable(r);
        if (!bad.length) return { resolved: r, source: "recorded panel" };
        problems.push(...bad);
      } catch (err) {
        problems.push((err as Error).message.split("\n")[0]!);
      }
    } else problems.push("the record lists no seats");
    const r = await resolveRun({ cfg: o.cfg, env: o.env });
    const what = r.profile ? `active profile "${r.profile}"` : `${r.source === "auto" ? "auto-detected" : "configured"} panel`;
    return { resolved: r, source: what, note: `the recorded panel no longer resolves (${[...new Set(problems)].join("; ")}), so the ${what} was used instead` };
  };
}

/** One line per record for the terminal; the full verdict is in the record itself. */
export function describeRecheck(results: RecheckResult[], dryRun = false): string {
  const lines: string[] = [];
  for (const r of results) {
    if (r.status === "skipped") lines.push(`${r.file}: skipped, ${r.reason}`);
    else if (r.status === "error") lines.push(`${r.file}: failed, ${r.reason}`);
    else {
      lines.push(`${r.file}: ${r.status === "planned" ? "would recheck" : r.status} with ${r.panel!.join(", ")} (${r.panelSource})`);
      if (r.panelNote) lines.push(`  note: ${r.panelNote}`);
      if (r.contextNote) lines.push(`  note: ${r.contextNote}`);
      if (r.delta) lines.push(`  ${r.delta.replace(/\s*\n\s*/g, " ")}`);
    }
  }
  const count = (s: RecheckStatus) => results.filter((r) => r.status === s).length;
  const failed = count("error") ? `, ${count("error")} failed` : "";
  lines.push(
    dryRun
      ? `${count("planned")} to recheck, ${count("skipped")} skipped${failed}; no model was called (drop --dry-run to run them)`
      : `${count("unchanged")} unchanged, ${count("refined")} refined, ${count("changed")} changed, ${count("skipped")} skipped${failed}`,
  );
  return lines.join("\n");
}

/** The same record named twice (./a.md and a.md, or by name and again by --all) is rechecked once. */
export function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((f) => {
    const key = resolve(f);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface RecheckCliOptions {
  paths: string[];
  all?: boolean;
  dir: string;
  profile?: string;
  dryRun?: boolean;
  json?: boolean;
  maxCost?: number;
  quiet?: boolean;
}

/** `consensus adr --recheck`: wires the real panel, store and terminal. Returns the exit code. */
export async function recheckCommand(o: RecheckCliOptions): Promise<number> {
  let files: string[];
  let cfg: Config;
  try {
    if (!o.paths.length && !o.all) throw new Error(`Name the records to recheck (consensus adr --recheck docs/decisions/0003-....md), or pass --all to recheck every record in ${o.dir}.`);
    files = uniquePaths([...o.paths, ...(o.all ? await listAdrFiles(o.dir) : [])]);
    cfg = await loadConfig();
  } catch (err) {
    // Not 1: a scheduled job reads 1 as "a decision changed".
    log(red(`error: ${(err as Error).message}`));
    return 3;
  }
  const env = credentialEnv();
  let statuses: Promise<VendorStatus[]> | undefined;
  const ac = new AbortController();
  process.once("SIGINT", () => {
    log(yellow("\naborting… records not yet rechecked are left as they are"));
    ac.abort();
  });
  const results = await recheckAdrs(files, {
    dryRun: o.dryRun,
    deps: {
      choosePanel: panelChooser({ cfg, profile: o.profile, env, statuses: () => (statuses ??= scanVendors(env)) }),
      loadSavedRun: async (id) => (await loadRun(id, cfg.runsDir).catch(() => undefined))?.run,
      runPanel: async (r, prompt, context) => {
        const run = await new ConsensusEngine({
          panel: r.panel,
          judge: r.judge,
          captain: r.captain,
          rounds: r.rounds,
          effort: r.effort,
          maxTokens: cfg.maxTokens,
          maxCostUsd: o.maxCost ?? cfg.maxCostUsd,
          maxSpendUsd: cfg.maxSpendUsd,
          onEvent: progressLogger(o.quiet || o.json),
          signal: ac.signal,
        }).run(prompt, context);
        if (r.profile) run.profile = r.profile;
        return run;
      },
      saveRun: (run) => saveRun(run, cfg.runsDir),
      signal: ac.signal,
      onProgress: (m) => (o.quiet || o.json ? undefined : log(dim(m))),
    },
  });
  if (o.json) process.stdout.write(JSON.stringify(results, null, 2) + "\n");
  else process.stdout.write(describeRecheck(results, o.dryRun) + "\n");
  return o.dryRun ? (results.some((r) => r.status === "error") ? 3 : 0) : recheckExitCode(results);
}
