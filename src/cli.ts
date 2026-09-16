#!/usr/bin/env node
import * as p from "@clack/prompts";
import { Command, InvalidArgumentError } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { CATALOG, CATALOG_VENDORS, directRouteBlocker, priceLabel, routeFor } from "./catalog.js";
import { loadConfig, loadUserConfig, resolveRun, saveUserConfig, type Config } from "./config.js";
import { credentialEnv, loadCredentials } from "./credentials.js";
import { createPack, describePack, diffPack, installPack, readPack, removePack } from "./packs.js";
import { configWarnings, splitMember } from "./config.js";
import { ensureGitignore } from "./hosts.js";
import { CostLimitError, describeCost, estimateCost } from "./cost.js";
import { setDefaultTimeout } from "./providers/cli.js";
import { probeSpecs, scanVendors } from "./doctor.js";
import { installProjectMcp, installProjectSkills, listHosts, mcpLaunchCommand } from "./hosts.js";
import { describeProfile, editProfile, materializePreset, memberLabel, profileWarnings } from "./profiles.js";
import { PRESETS } from "./catalog.js";
import { PROVIDERS, VENDORS, createPanelist } from "./providers/index.js";
import { PERSONAS } from "./personas.js";
import { SAMPLE_SUITE, answerSection, loadSuite, renderBench, runBench, type BenchProfileTarget } from "./bench.js";
import { CATALOG_VENDORS as _CV, pickForTier, routeFor as _routeFor } from "./catalog.js";
import { scanVendors as _scan } from "./doctor.js";
import { ConsensusEngine } from "./protocol/engine.js";
import { renderReport } from "./report.js";
import { connectVendor, runSetup, statusLine } from "./setup.js";
import { listRuns, loadRun, saveRun } from "./store.js";
import { eventToTerminal, openDebateLog } from "./debatelog.js";
import { join } from "node:path";
import type { ConsensusEvent, Effort } from "./types.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };
let buildInfo = "";
try {
  const bi = require("./build-info.json") as { commit?: string; builtAt?: string };
  if (bi.commit && bi.commit !== "unknown") buildInfo = ` (${bi.commit}${bi.builtAt ? `, built ${bi.builtAt.slice(0, 10)}` : ""})`;
} catch {
  /* not built with build-info */
}

import { G, bold, dim, green, log, progressLogger, red, yellow } from "./progress.js";
import { preflight } from "./doctor.js";
import { renderRunHtml } from "./store.js";
import { materializePreset as _mp } from "./profiles.js";

/** Rough wall-clock guess: per-phase latency scaled by effort, phases by rounds. */
function estimateMinutes(seats: number, rounds: number, effort: string): { low: number; high: number } {
  const scale = effort === "max" ? 2 : effort === "xhigh" ? 1.6 : effort === "high" ? 1.2 : effort === "medium" ? 0.8 : 0.5;
  const phases = 1 + rounds + (rounds > 1 ? rounds - 1 : 0) + 1; // propose, critiques, revisions, synthesis
  const perPhaseSec = 30 * scale + seats * 3;
  const total = phases * perPhaseSec;
  return { low: Math.max(1, Math.round((total * 0.6) / 60)), high: Math.max(2, Math.round((total * 1.4) / 60)) };
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length]![b.length]!;
}

function parseIntArg(v: string): number {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 1) throw new InvalidArgumentError("must be a positive integer");
  return n;
}
function parseEffort(v: string): Effort {
  if (!["low", "medium", "high", "xhigh", "max"].includes(v)) throw new InvalidArgumentError("must be low|medium|high|xhigh|max");
  return v as Effort;
}

async function readPrompt(arg: string | undefined, file: string | undefined): Promise<string> {
  if (file) return readFile(file, "utf8");
  if (arg && arg !== "-") return arg;
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  }
  throw new Error("No prompt given. Pass it as an argument, with -f <file>, or on stdin.");
}

const program = new Command()
  .name("consensus")
  .description("Throw a problem at a panel of frontier models, let them debate, get one consensus answer.")
  .version(`${version}${buildInfo}`);

// ---- run ---------------------------------------------------------------
program
  .command("run", { isDefault: true })
  .description("ask the panel (default command): consensus \"your question\" [-c context.md] [--profile name]")
  .argument("[prompt]", "the problem to solve ('-' or omitted reads stdin)")
  .option("-f, --file <path>", "read the prompt from a file")
  .option("-c, --context <path>", "extra context file (code, docs, constraints) appended to the problem")
  .option("--profile <name>", "model profile to use (see `consensus profiles`)")
  .option("-p, --panel <specs>", "comma-separated panelists, e.g. claude,codex:gpt-5.6-sol,xai:grok-4.6#max")
  .option("--captain <spec|auto|none>", "captain: moderates after each critique round, referees disputes, facilitates, writes the report (default auto = best available model, preferring one not on the panel)")
  .option("-j, --judge <spec>", "override who writes the synthesis: a seat spec or `external:<spec>` (default: the captain)")
  .option("-r, --rounds <n>", "max critique/revise rounds", parseIntArg)
  .option("-e, --effort <level>", "low|medium|high|xhigh|max (default for models without their own #effort)", parseEffort)
  .option("--max-tokens <n>", "max output tokens per call", parseIntArg)
  .option("--max-cost <usd>", "abort once spend billed to API keys exceeds this (subscription seats are quota, not counted); default from config maxCostUsd", (v: string) => { const n = Number(v); if (!(n > 0)) throw new InvalidArgumentError("must be a positive number"); return n; })
  .option("--max-spend <usd>", "abort once billed spend plus the list-price equivalent of subscription seats exceeds this; default from config maxSpendUsd", (v: string) => { const n = Number(v); if (!(n > 0)) throw new InvalidArgumentError("must be a positive number"); return n; })
  .option("--no-retry", "do not retry a seat once on a transient failure")
  .option("--timeout <minutes>", "kill any single model call after this many minutes (default 20)", (v: string) => { const n = Number(v); if (!(n > 0)) throw new InvalidArgumentError("must be a positive number"); return n; })
  .option("--seed <n>", "seed for label assignment and answer ordering (recorded in run.json; reuse to reproduce shuffles)", parseIntArg)
  .option("--force", "run even if pre-flight finds a seat that cannot be reached")
  .option("--json", "print the full run as JSON instead of the markdown report")
  .option("--transcript", "append the full debate transcript to the report")
  .option("-o, --output <path>", "write the report to a file as well as stdout")
  .option("--no-save", "do not save the run under .consensus/runs")
  .option("-v, --verbose", "stream each panelist's verdicts and disputes to stderr as they land")
  .option("-q, --quiet", "no progress output on stderr")
  .action(async (promptArg: string | undefined, o) => {
    const cfg = await loadConfig();
    // A bare single word is almost always a mistyped subcommand, and a run costs money.
    if (promptArg && promptArg !== "-" && !o.file && !/\s/.test(promptArg) && promptArg.length < 40 && process.argv[2] !== "run") {
      const names = program.commands.map((c) => c.name());
      const guess = names.map((n) => [n, levenshtein(promptArg.toLowerCase(), n)] as const).sort((x, y) => x[1] - y[1])[0];
      const hint = guess && guess[1] <= 2 ? ` Did you mean \`consensus ${guess[0]}\`?` : "";
      throw new Error(`"${promptArg}" looks like a command, not a question, and a run spends money.${hint} Use \`consensus run "${promptArg}"\` if you meant it, or \`consensus --help\`.`);
    }
    const prompt = (await readPrompt(promptArg, o.file)).trim();
    if (!prompt) throw new Error("Prompt is empty");
    const context = o.context ? await readFile(o.context, "utf8") : undefined;

    const r = await resolveRun({
      cfg,
      panel: o.panel ? String(o.panel).split(",") : undefined,
      profile: o.profile,
      judge: o.judge,
      captain: o.captain,
      rounds: o.rounds,
      effort: o.effort,
      env: credentialEnv(),
    });
    const problems = preflight(r.panel, await _scan(credentialEnv()), credentialEnv());
    if (problems.length) {
      const msg = `pre-flight found seats that cannot run:\n  - ${problems.join("\n  - ")}`;
      if (!o.force) throw new Error(`${msg}\nFix the connection, change the panel, or pass --force to run without those seats.`);
      log(yellow(msg + "\n(continuing with --force; those seats will be dropped)"));
    }
    if (!o.quiet) {
      for (const w of configWarnings) log(yellow(`warning: ${w}`));
      const seats = r.panel.map((x) => `${x.id}${x.effort ? `#${x.effort}` : `#${r.effort}`}`).join(", ");
      const cliSeats = r.panel.filter((x) => ["claude", "codex", "gemini", "grok"].includes(x.provider)).length;
      const shellKeys = [["claude", "ANTHROPIC_API_KEY"], ["codex", "OPENAI_API_KEY"], ["gemini", "GEMINI_API_KEY"], ["grok", "XAI_API_KEY"]].filter(([p, k]) => process.env[k!] && r.panel.some((x) => x.provider === p));
      for (const [p, k] of shellKeys) log(yellow(`note: ${k} is set in your shell, so the ${p} seat will bill that API key, not your subscription`));
      log(dim(`panel${r.profile ? ` (${r.profile})` : ` (${r.source})`}: ${seats}`));
      const onPanel = r.panel.some((x) => x.id === r.judge.id);
      if (r.captain) log(dim(`captain: ${r.captain.id}${r.panel.some((x) => x.id === r.captain!.id) ? " (also a seat)" : " (not on the panel)"}: moderates each round, referees disputes, may grant one extra round, writes the report`));
      const ceilings = [o.maxCost ?? cfg.maxCostUsd ? `billed ceiling $${o.maxCost ?? cfg.maxCostUsd}` : "", o.maxSpend ?? cfg.maxSpendUsd ? `total ceiling $${o.maxSpend ?? cfg.maxSpendUsd}` : ""].filter(Boolean).join(", ");
      const est = estimateMinutes(r.panel.length, r.rounds, r.effort);
      log(dim(`judge: ${r.judge.id}${onPanel ? "" : " (external, did not debate)"}  rounds: ${r.rounds}  cost: ${cliSeats === r.panel.length ? "subscription quota" : cliSeats ? "subscription quota + API tokens" : "API tokens"}; up to ${r.panel.length * (1 + 2 * r.rounds) + 1} model calls${ceilings ? `; ${ceilings}` : ""}`));
      log(dim(`expect roughly ${est.low}–${est.high} minutes (seats run in parallel; each round adds a critique and, if anything is disputed, a revision)`));
    }
    const ac = new AbortController();
    process.once("SIGINT", () => {
      log(yellow("\naborting…"));
      ac.abort();
    });
    const progress = progressLogger(o.quiet);
    const runsDir = cfg.runsDir ?? ".consensus/runs";
    let debate: Awaited<ReturnType<typeof openDebateLog>> | undefined;
    let pending: ConsensusEvent[] = [];
    const onEvent = (e: ConsensusEvent): void => {
      progress(e);
      if (o.verbose && !o.quiet) for (const line of eventToTerminal(e)) log(dim(line));
      if (o.save === false) return;
      if (e.type === "start") {
        pending.push(e);
        openDebateLog(join(runsDir, e.runId)).then((d) => {
          debate = d;
          for (const p of pending) d.onEvent(p);
          pending = [];
          if (!o.quiet) log(dim(`debate log: ${d.path}  (tail -f to watch)`));
        });
      } else if (debate) debate.onEvent(e);
      else pending.push(e);
    };
    if (o.timeout) setDefaultTimeout(o.timeout * 60_000);
    const engine = new ConsensusEngine({
      panel: r.panel,
      judge: r.judge,
      captain: r.captain,
      rounds: r.rounds,
      effort: r.effort,
      maxTokens: o.maxTokens ?? cfg.maxTokens,
      maxCostUsd: o.maxCost ?? cfg.maxCostUsd,
      maxSpendUsd: o.maxSpend ?? cfg.maxSpendUsd,
      retry: o.retry !== false,
      seed: o.seed,
      onEvent,
      signal: ac.signal,
    });
    let run: import("./types.js").ConsensusRun;
    try {
      run = await engine.run(prompt, context);
    } catch (err) {
      await debate?.close();
      if (err instanceof CostLimitError && err.partial && o.save !== false) {
        // Keep the debate so far; the user paid for it.
        err.partial.synthesis = `(no synthesis: ${err.message})`;
        const dir = await saveRun(err.partial, runsDir);
        log(yellow(`${err.message}\nPartial debate saved to ${dir} (no synthesis). Exit code 3.`));
        process.exitCode = 3;
        return;
      }
      throw err;
    }
    await debate?.close();
    const out = o.json ? JSON.stringify(run, null, 2) : renderReport(run, { transcript: o.transcript });
    process.stdout.write(out + "\n");
    const dropped = Object.keys(run.dropped);
    if (dropped.length) process.exitCode = 2; // also under --quiet: scripts must see a degraded panel
    if (!o.quiet) {
      if (dropped.length) log(yellow(`panel shrank: ${dropped.length} seat(s) dropped (${dropped.join(", ")}); ${run.seats.length - dropped.length} of ${run.seats.length} answered. Exit code 2.`));
      log(dim(`cost: ${describeCost(estimateCost(run.usage))}`));
    }
    if (o.output) await writeFile(o.output, out + "\n");
    if (o.save !== false) {
      const dir = await saveRun(run, cfg.runsDir);
      if (!o.quiet) log(dim(`saved ${dir}`));
    }
  });

// ---- runs / log ----------------------------------------------------------
program
  .command("runs")
  .description("list saved runs (newest first)")
  .option("-n <count>", "how many", parseIntArg)
  .action(async (o: { n?: number }) => {
    const cfg = await loadConfig();
    const runs = await listRuns(cfg.runsDir);
    if (!runs.length) return log(dim("no saved runs here"));
    for (const r of runs.slice(0, o.n ?? 20)) {
      process.stdout.write(`${r.id}  ${r.converged ? "converged" : "open"} ${r.rounds}r  ${r.panel.join(", ")}\n  ${r.prompt.replace(/\s+/g, " ").slice(0, 100)}\n`);
    }
  });

program
  .command("log")
  .argument("[id]", "run id from `consensus runs` (default: latest)")
  .description("print the full debate of a saved run: every answer, critique, concession, and the synthesis")
  .option("--json", "print run.json instead")
  .option("--answer", "print only the synthesized answer")
  .option("--html [file]", "write a self-contained shareable HTML page of the whole debate (default: <run dir>/debate.html)")
  .action(async (id: string | undefined, o: { json?: boolean; answer?: boolean; html?: string | boolean }) => {
    const cfg = await loadConfig();
    const { run, dir } = await loadRun(id, cfg.runsDir);
    if (o.html) {
      const file = typeof o.html === "string" ? o.html : join(dir, "debate.html");
      await writeFile(file, renderRunHtml(run));
      return log(`wrote ${file}  (open it, or send it: it has no external dependencies)`);
    }
    if (o.json) return void process.stdout.write(JSON.stringify(run, null, 2) + "\n");
    if (o.answer) return void process.stdout.write(answerSection(run.synthesis) + "\n");
    process.stdout.write(renderReport(run, { transcript: true }) + "\n");
    log(dim(`(${dir})`));
  });

// ---- setup / doctor / connect ---------------------------------------------
program
  .command("setup")
  .description("connect your AI subscriptions or API keys, build model profiles, and install the skill + MCP server into your IDEs")
  .option("-y, --yes", "non-interactive: use what is already connected, create starter profiles, install everywhere detected")
  .option("--project", "also write project-level files in the current directory")
  .option("--probe", "make one tiny live call through each connection")
  .option("--first-run", "under --yes, also run the guided first debate (spends quota); interactive setup asks")
  .option("--no-first-run", "skip the guided first debate")
  .action((o) => runSetup(o));

program
  .command("doctor")
  .description("show which subscriptions / keys are connected and which IDEs are set up")
  .option("--probe", "make one tiny live call through each connected vendor")
  .action(async (o) => {
    const statuses = await scanVendors(credentialEnv());
    for (const w of configWarnings) log(yellow(`warning: ${w}`));
    log(bold("Accounts"));
    for (const s of statuses) log("  " + statusLine(s));
    if (statuses.some((x) => x.connected && x.via === "cli")) log(dim("  note: subscription seats spend your vendor CLI rate limits (same caps as interactive use); see README \"How your subscriptions are used\""));
    const cfg = await loadConfig();
    log(bold("\nProfiles"));
    const names = Object.keys(cfg.profiles ?? {});
    if (!names.length) log(dim("  none (run `consensus setup`)"));
    for (const n of names) log(`  ${n === cfg.profile ? "*" : " "} ${n}: ${cfg.profiles![n]!.panel.map(memberLabel).join(", ")}`);
    log(bold("\nHosts (detected / consensus installed)"));
    for (const h of listHosts()) {
      const i = h.installed?.() ?? {};
      const parts = [h.installMcp ? `MCP ${i.mcp ? "registered" : "not registered"}` : undefined, h.installSkill ? `skill ${i.skill ? "installed" : "missing"}` : undefined].filter(Boolean).join(", ");
      log(`  ${h.detected ? G.ok : G.no} ${h.name.padEnd(28)} ${h.detected ? dim(parts) : dim("not detected")}`);
    }
    log(dim(`  MCP launch command: ${mcpLaunchCommand().join(" ")}`));
    if (o.probe) {
      const specs = statuses.filter((s) => s.connected).map((s) => s.spec!);
      log(bold("\nLive probe"));
      for (const r of await probeSpecs(specs)) log(`  ${r.ok ? green(G.ok) : red(G.err)} ${r.id.padEnd(12)} ${r.ok ? `${(r.ms / 1000).toFixed(1)}s "${r.sample}"` : r.error}`);
    }
  });

program
  .command("connect")
  .argument("<vendor>", `one of: ${VENDORS.map((v) => v.vendor).join(", ")}`)
  .description("log in to one vendor's CLI or store its API key")
  .action(async (vendor: string) => {
    const v = VENDORS.find((x) => x.vendor === vendor || x.cli === vendor || x.api === vendor);
    if (!v) throw new Error(`Unknown vendor "${vendor}"`);
    const st = (await scanVendors(credentialEnv())).find((s) => s.vendor === v.vendor)!;
    p.intro(`connect ${v.label}`);
    await connectVendor(st);
    const after = (await scanVendors(credentialEnv())).find((s) => s.vendor === v.vendor)!;
    p.outro(statusLine(after));
  });

// ---- profiles --------------------------------------------------------------
program
  .command("profiles")
  .description("list model profiles")
  .action(async () => {
    const cfg = await loadConfig();
    for (const w of configWarnings) log(yellow(`warning: ${w}`));
    const names = Object.keys(cfg.profiles ?? {});
    if (!names.length) return log(dim("No profiles. Run `consensus setup` or `consensus profile create`."));
    for (const n of names) {
      log(describeProfile(n, cfg.profiles![n]!, n === cfg.profile));
      for (const w of profileWarnings(cfg.profiles![n]!, cfg.personas ?? {})) log(yellow(`      warning: ${w}`));
    }
  });

const profile = program.command("profile").description("create, edit, switch, or delete model profiles");
profile
  .command("presets")
  .description("list built-in presets and whether your connections can satisfy them")
  .action(async () => {
    const statuses = await scanVendors(credentialEnv());
    for (const preset of PRESETS) {
      const prof = materializePreset(preset, statuses);
      log(`${prof ? green(G.ok) : dim(G.no)} ${preset.name.padEnd(14)} ${preset.description}`);
      if (prof) {
        log(dim(`    ${prof.panel.map(memberLabel).join(", ")}  rounds ${prof.rounds}`));
        for (const n of prof.substitutions ?? []) log(yellow(`    substituted: ${n}`));
      }
    }
    log(dim("\nconsensus profile create <name> --preset <preset>   creates one;  add --edit to tweak it first"));
  });
profile
  .command("create")
  .argument("[name]")
  .description("build a profile with the interactive model selector, or from a preset")
  .option("--preset <preset>", `start from a preset: ${PRESETS.map((x) => x.name).join(", ")}`)
  .option("--edit", "with --preset: open the selector to tweak it before saving")
  .option("--force", "overwrite an existing profile of the same name without asking")
  .action(async (name: string | undefined, o: { preset?: string; edit?: boolean; force?: boolean }) => {
    const cfg = await loadUserConfig();
    const statuses = await scanVendors(credentialEnv());
    let r: { name: string; profile: import("./config.js").Profile };
    const target = name ?? o.preset;
    if (target && cfg.profiles?.[target] && !o.edit && !o.force) {
      if (!process.stdin.isTTY) throw new Error(`Profile "${target}" already exists. Pass --force to overwrite it (no terminal to ask).`);
      const ok = await p.confirm({ message: `Profile "${target}" already exists. Overwrite it?`, initialValue: false });
      if (p.isCancel(ok) || !ok) return log("left unchanged");
    }
    if (!o.preset && !process.stdin.isTTY) throw new Error("profile create without --preset is interactive; run it in a terminal or use --preset <name>.");
    if (o.preset) {
      const preset = PRESETS.find((x) => x.name === o.preset);
      if (!preset) throw new Error(`Unknown preset "${o.preset}". Known: ${PRESETS.map((x) => x.name).join(", ")}`);
      const prof = materializePreset(preset, statuses);
      if (!prof) throw new Error(`Preset "${o.preset}" needs connections you don't have yet (run \`consensus doctor\`).`);
      if (o.edit) {
        p.intro(`profile from preset ${o.preset}`);
        r = await editProfile(statuses, prof, name ?? o.preset);
      } else r = { name: name ?? o.preset, profile: prof };
    } else {
      p.intro("new profile");
      r = await editProfile(statuses, undefined, name);
    }
    cfg.profiles = { ...cfg.profiles, [r.name]: r.profile };
    cfg.profile ??= r.name;
    await saveUserConfig(cfg);
    log(`Saved profile "${r.name}"${cfg.profile === r.name ? " (active)" : ""}. Use it with --profile ${r.name} or \`consensus profile use ${r.name}\`.`);
  });
profile
  .command("edit")
  .description("reopen the interactive picker on an existing profile")
  .argument("<name>")
  .action(async (name: string) => {
    const cfg = await loadUserConfig();
    const existing = cfg.profiles?.[name];
    if (!existing) throw new Error(`No profile "${name}"`);
    p.intro(`edit profile ${name}`);
    const r = await editProfile(await scanVendors(credentialEnv()), existing, name);
    cfg.profiles![name] = r.profile;
    await saveUserConfig(cfg);
    p.outro(`Saved "${name}".`);
  });
profile
  .command("use")
  .argument("<name>")
  .description("make a profile the default")
  .action(async (name: string) => {
    const cfg = await loadUserConfig();
    if (!cfg.profiles?.[name]) throw new Error(`No profile "${name}". Known: ${Object.keys(cfg.profiles ?? {}).join(", ") || "none"}`);
    cfg.profile = name;
    await saveUserConfig(cfg);
    log(`active profile: ${name}`);
  });
profile
  .command("delete")
  .description("delete a profile (the default moves to the next one)")
  .argument("<name>")
  .action(async (name: string) => {
    const cfg = await loadUserConfig();
    if (!cfg.profiles?.[name]) throw new Error(`No profile "${name}"`);
    delete cfg.profiles[name];
    if (cfg.profile === name) cfg.profile = Object.keys(cfg.profiles)[0];
    await saveUserConfig(cfg);
    log(`deleted ${name}${cfg.profile ? ` (active: ${cfg.profile})` : ""}`);
  });
profile
  .command("design")
  .argument("[brief]", "plain-English description: how many panelists, what expertise, frontier or commodity models, how many rounds")
  .description("build a profile from a plain-English brief (or answer a few questions); your strongest connected model drafts the personas")
  .option("--name <name>", "profile name (default: chosen by the designer)")
  .option("--tier <tier>", "frontier | balanced | commodity (overrides the brief)")
  .option("--no-llm", "template personas instead of a model call")
  .option("-y, --yes", "save without confirming")
  .action(async (brief: string | undefined, o: { name?: string; tier?: string; llm?: boolean; yes?: boolean }) => {
    const { TIER_WORDS, askDesigner, materializeDesign, templateDesign } = await import("./designer.js");
    const cfg = await loadUserConfig();
    const statuses = await scanVendors(credentialEnv());
    let tier = o.tier ? TIER_WORDS[o.tier.toLowerCase()] : undefined;
    if (o.tier && !tier) throw new Error(`--tier must be frontier, balanced or commodity`);
    let count = 0;
    let expertise: string[] = [];
    let rounds = 3;
    if (!brief) {
      if (!process.stdin.isTTY) throw new Error("Give a brief as the argument, e.g. consensus profile design \"5 panelists: security, distributed systems, PM; frontier models\"");
      p.intro("design a panel");
      const n = await p.select({ message: "How many panelists?", options: [2, 3, 4, 5, 6, 7].map((k) => ({ value: k, label: String(k), hint: k === 3 ? "typical" : k >= 6 ? "slow and expensive" : undefined })), initialValue: 3 });
      if (p.isCancel(n)) return;
      count = Number(n);
      const ex = await p.text({ message: "What expertise should they have? (comma-separated, e.g. security, distributed systems, product)", placeholder: "security, performance, product" , validate: (v) => (!v?.trim() ? "Required" : undefined) });
      if (p.isCancel(ex)) return;
      expertise = String(ex).split(",").map((x) => x.trim()).filter(Boolean);
      const t = await p.select({ message: "Which models?", options: [{ value: "frontier", label: "frontier", hint: "best model per vendor, max effort" }, { value: "standard", label: "balanced", hint: "strong mid-tier" }, { value: "budget", label: "commodity", hint: "cheapest capable" }], initialValue: tier ?? "standard" });
      if (p.isCancel(t)) return;
      tier = t as import("./catalog.js").Tier;
      const r = await p.select({ message: "Debate rounds", options: [1, 2, 3, 5].map((k) => ({ value: k, label: String(k) })), initialValue: 3 });
      if (p.isCancel(r)) return;
      rounds = Number(r);
      brief = `${count} panelists with this expertise: ${expertise.join(", ")}. Use ${t === "frontier" ? "frontier" : t === "budget" ? "commodity (cheap)" : "balanced mid-tier"} models. ${rounds} round(s) of debate.`;
    } else {
      const m = brief.match(/(\d+)\s*(panel|seat|member|expert|model)/i);
      if (m) count = Number(m[1]);
      for (const [w, t] of Object.entries(TIER_WORDS)) if (!tier && new RegExp(`\\b${w}\\b`, "i").test(brief)) tier = t;
      const rm = brief.match(/(\d+)\s*rounds?/i);
      if (rm) rounds = Math.min(5, Math.max(1, Number(rm[1])));
    }
    let design;
    if (o.llm === false) {
      if (!expertise.length) expertise = brief.split(/[,;:]| and /i).map((x) => x.trim()).filter((x) => x && !/panelist|round|model|frontier|commodity|budget|cheap/i.test(x));
      design = templateDesign(brief, count || Math.max(2, expertise.length), expertise, tier ?? "standard", rounds);
    } else {
      const { autoDetectSpecs } = await import("./config.js");
      const specs = await autoDetectSpecs(credentialEnv());
      if (!specs.length) throw new Error("No connected model to draft the panel with; run `consensus setup` or use --no-llm.");
      const designer = createPanelist(specs[0]!, { effort: "medium", env: credentialEnv() });
      log(dim(`asking ${designer.id} to design the panel…`));
      design = await askDesigner(designer, brief, statuses, tier);
      if (count) design.seats = design.seats.slice(0, Math.max(2, count));
      if (tier) for (const s of design.seats) s.tier = tier;
    }
    const built = materializeDesign(design, statuses);
    const name = o.name ?? built.name;
    log(bold(`\n${name}`) + (design.description ? `  — ${design.description}` : ""));
    for (const s of built.seatsExplained) log(`  ${s}`);
    log(dim(`  judge ${built.profile.judge}, rounds ${built.profile.rounds}`));
    if (Object.keys(built.personas).length) {
      log(bold("\nnew personas"));
      for (const [n, t] of Object.entries(built.personas)) log(`  ${n}: ${dim(t)}`);
    }
    for (const u of built.unseated) log(yellow(u.startsWith("note:") ? `\n${u}` : `\nnot seated: ${u}`));
    if (design.rationale) log(dim(`\n${design.rationale}`));
    if (built.profile.panel.length < 2) throw new Error("Fewer than 2 seats could be filled with your connections; run `consensus setup` to connect more vendors or add an OpenRouter key.");
    if (!o.yes) {
      if (!process.stdin.isTTY) throw new Error("Pass --yes to save without confirmation.");
      const ok = await p.confirm({ message: `Save profile "${name}"?`, initialValue: true });
      if (p.isCancel(ok) || !ok) return log("not saved");
    }
    cfg.personas = { ...cfg.personas, ...built.personas };
    cfg.profiles = { ...cfg.profiles, [name]: built.profile };
    await saveUserConfig(cfg);
    log(`${green(G.ok)} saved profile ${name}. Try: consensus "…" --profile ${name}`);
  });
profile
  .command("refresh")
  .description("re-materialize preset-derived profiles against your current connections (e.g. after a CLI upgrade or a new key)")
  .action(async () => {
    const cfg = await loadUserConfig();
    const statuses = await scanVendors(credentialEnv());
    const changed: string[] = [];
    for (const preset of PRESETS) {
      const cur = cfg.profiles?.[preset.name];
      if (!cur) continue;
      const fresh = _mp(preset, statuses);
      if (!fresh) {
        delete cfg.profiles![preset.name];
        if (cfg.profile === preset.name) cfg.profile = undefined;
        changed.push(`${preset.name}: removed (no connection can seat it now; \`consensus profile create ${preset.name} --preset ${preset.name}\` brings it back)`);
      } else if (JSON.stringify([fresh.panel, fresh.judge]) !== JSON.stringify([cur.panel, cur.judge])) {
        cfg.profiles![preset.name] = { ...fresh, description: cur.description ?? fresh.description };
        changed.push(`${preset.name}: ${fresh.panel.join(", ")}  captain ${fresh.captain ?? "auto"}${fresh.judge ? `, judge ${fresh.judge}` : ""}`);
      }
    }
    if (!cfg.profile && Object.keys(cfg.profiles ?? {}).length) cfg.profile = Object.keys(cfg.profiles!)[0];
    await saveUserConfig(cfg);
    log(changed.length ? changed.join("\n") : "all preset profiles already match your connections");
  });
profile
  .command("show")
  .description("print one profile's seats, judge, rounds and effort")
  .argument("<name>")
  .action(async (name: string) => {
    const cfg = await loadConfig();
    const prof = cfg.profiles?.[name];
    if (!prof) throw new Error(`No profile "${name}"`);
    log(describeProfile(name, prof, name === cfg.profile));
    for (const w of profileWarnings(prof, cfg.personas ?? {})) log(yellow(`      warning: ${w}`));
  });

// ---- install -------------------------------------------------------------
program
  .command("install")
  .description("(re)install the MCP server and skill packs into detected IDEs / agents")
  .option("--project", "write project-level files in the current directory instead of user-level")
  .option("--skills-only", "skip MCP registration")
  .option("--mcp-only", "skip skill packs")
  .action(async (o) => {
    if (o.project) {
      const files = [...(o.mcpOnly ? [] : await installProjectSkills()), ...(o.skillsOnly ? [] : await installProjectMcp())];
      for (const f of files) log(`  ${f}`);
      return;
    }
    const cmd = mcpLaunchCommand();
    for (const h of listHosts().filter((x) => x.detected)) {
      if (h.installMcp && !o.skillsOnly) {
        try {
          log(`${green(G.ok)} ${h.name}: MCP ${await h.installMcp(cmd)}`);
        } catch (err) {
          log(`${red(G.err)} ${h.name}: MCP ${(err as Error).message}`);
        }
      }
      if (h.installSkill && !o.mcpOnly) {
        try {
          log(`${green(G.ok)} ${h.name}: skill -> ${(await h.installSkill()).join(", ")}`);
        } catch (err) {
          log(`${red(G.err)} ${h.name}: skill ${(err as Error).message}`);
        }
      }
    }
  });

// ---- personas --------------------------------------------------------------
const personaCmd = program.command("persona").description("add or remove your own personas (preprompts)");
personaCmd
  .command("add")
  .argument("<name>", "lowercase name, no spaces")
  .argument("[text]", "the preprompt; omit to read it from stdin or -f")
  .option("-f, --file <path>", "read the preprompt from a file")
  .action(async (name: string, text: string | undefined, o: { file?: string }) => {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) throw new Error("Persona names are lowercase letters, digits, dashes or underscores.");
    let body = text ?? (o.file ? await readFile(o.file, "utf8") : "");
    if (!body && !process.stdin.isTTY) body = await readPrompt(undefined, undefined);
    if (!body.trim()) throw new Error("Give the preprompt as an argument, with -f <file>, or on stdin.");
    const cfg = await loadUserConfig();
    const existed = !!cfg.personas?.[name];
    cfg.personas = { ...cfg.personas, [name]: body.trim() };
    await saveUserConfig(cfg);
    log(`${existed ? "updated" : "added"} persona ${name}${PERSONAS[name] ? " (overrides the built-in of the same name)" : ""}. Use it as spec+${name}, e.g. claude+${name}.`);
  });
personaCmd
  .command("prune")
  .description("delete custom personas that no profile references (designer runs leave some behind)")
  .option("-y, --yes", "delete without listing first")
  .action(async (o: { yes?: boolean }) => {
    const cfg = await loadUserConfig();
    const used = new Set<string>();
    for (const prof of Object.values(cfg.profiles ?? {})) {
      for (const m of prof.panel) {
        const { persona } = splitMember(m);
        if (persona) for (const x of persona.split(",")) used.add(x.trim().replace(/-\d+$/, ""));
      }
      const j = prof.judge ? splitMember(prof.judge.replace(/^external:/, "")).persona : undefined;
      if (j) for (const x of j.split(",")) used.add(x.trim());
    }
    const unused = Object.keys(cfg.personas ?? {}).filter((n) => !used.has(n));
    if (!unused.length) return log("nothing to prune: every custom persona is referenced by a profile");
    log(`unreferenced personas: ${unused.join(", ")}`);
    if (!o.yes) {
      if (!process.stdin.isTTY) throw new Error("Pass --yes to prune without confirmation.");
      const ok = await p.confirm({ message: `Delete ${unused.length} persona(s)?`, initialValue: true });
      if (p.isCancel(ok) || !ok) return log("kept");
    }
    for (const n of unused) delete cfg.personas![n];
    await saveUserConfig(cfg);
    log(`pruned ${unused.length} persona(s)`);
  });
personaCmd
  .command("remove")
  .description("delete one of your custom personas")
  .argument("<name>")
  .action(async (name: string) => {
    const cfg = await loadUserConfig();
    if (!cfg.personas?.[name]) throw new Error(`No custom persona "${name}" (built-ins cannot be removed).`);
    delete cfg.personas[name];
    await saveUserConfig(cfg);
    log(`removed persona ${name}`);
  });

program
  .command("personas")
  .description("list built-in personas (preprompts) and your own from config")
  .action(async () => {
    const cfg = await loadConfig();
    log(bold("Built-in"));
    for (const x of Object.values(PERSONAS)) log(`  ${x.name.padEnd(18)} ${dim(x.description)}`);
    const mine = Object.entries(cfg.personas ?? {});
    log(bold("\nYours") + (mine.length ? "" : dim("  (none; add {\"personas\": {\"einstein\": \"You are…\"}} to ~/.config/consensus/config.json)")));
    for (const [n, t] of mine) log(`  ${n.padEnd(18)} ${dim(t.slice(0, 80))}`);
    log(dim("\nUse: spec+persona, e.g. claude:claude-fable-5-1#max+skeptic, or {\"model\": \"claude\", \"persona\": \"<inline text>\", \"name\": \"einstein\"} in a profile"));
  });

// ---- bench -----------------------------------------------------------------
const bench = program.command("bench").description("benchmark profiles: speed, tokens, cost, convergence, graded accuracy and quality (`consensus bench [options]` runs; see `consensus bench run --help`)");
bench
  .command("run", { isDefault: true })
  .description("run a suite across profiles and grade the answers blind")
  .option("-P, --profiles <names>", "comma-separated profiles (default: all)")
  .option("-s, --suite <path>", "suite JSON (default: consensus.bench.json here, else the built-in starter suite)")
  .option("-c, --cases <ids>", "comma-separated case ids to run")
  .option("-g, --grader <spec>", "grader model spec (default: the best directly connected frontier model)")
  .option("--parallel", "run profiles concurrently")
  .option("-t, --trials <n>", "repeat each case this many times per profile and average", parseIntArg)
  .option("-b, --baseline <specs>", "comma-separated single-model baseline arms (no debate), e.g. claude:claude-opus-5,codex:gpt-5.6-sol")
  .option("-o, --out <dir>", "output directory (default: .consensus/bench/<timestamp>)")
  .option("--json", "print results JSON instead of the report")
  .action(async (o: { profiles?: string; suite?: string; cases?: string; grader?: string; parallel?: boolean; trials?: number; baseline?: string; out?: string; json?: boolean }) => {
    const cfg = await loadConfig();
    const names = o.profiles ? o.profiles.split(",").map((x) => x.trim()) : Object.keys(cfg.profiles ?? {});
    if (!names.length) throw new Error("No profiles to benchmark. Run `consensus setup` or `consensus profile create` first.");
    const targets: BenchProfileTarget[] = [];
    for (const n of names) {
      const r = await resolveRun({ cfg, profile: n, env: credentialEnv() });
      targets.push({ name: n, panel: r.panel, judge: r.judge, captain: r.captain, rounds: r.rounds, effort: r.effort });
    }
    for (const spec of (o.baseline ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
      const single = createPanelist(spec, { effort: cfg.effort ?? "high", env: credentialEnv() });
      targets.push({ name: `single:${spec}`, panel: [single], judge: single, rounds: 0, effort: cfg.effort ?? "high", single });
    }
    let suite = o.suite ? await loadSuite(o.suite) : await loadSuite("consensus.bench.json").catch(() => SAMPLE_SUITE);
    if (o.cases) {
      const want = new Set(o.cases.split(",").map((x) => x.trim()));
      suite = { ...suite, cases: suite.cases.filter((c) => want.has(c.id)) };
      if (!suite.cases.length) throw new Error(`No cases matched ${o.cases}`);
    }
    let graderSpec = o.grader;
    if (!graderSpec) {
      const statuses = await _scan(credentialEnv());
      for (const v of _CV) {
        const m = pickForTier(v, "frontier");
        const r = m && _routeFor(v, m, statuses);
        if (r) {
          graderSpec = `${r.provider}:${r.model}`;
          break;
        }
      }
      if (!graderSpec) throw new Error("No connected model to grade with; pass --grader.");
    }
    const grader = createPanelist(graderSpec, { effort: "high", env: credentialEnv() });
    const outDir = o.out ?? join(cfg.runsDir ? join(cfg.runsDir, "..", "bench") : ".consensus/bench", new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"));
    const calls = targets.reduce((n, t) => n + (t.single ? 1 : t.panel.length * (1 + 2 * t.rounds) + 1), 0) * suite.cases.length * Math.max(1, o.trials ?? 1);
    log(dim(`arms: ${targets.map((t) => t.name).join(", ")}  cases: ${suite.cases.map((c) => c.id).join(", ")}  grader: ${grader.id}`));
    log(dim(`up to ~${calls} model calls across ${targets.length} arm(s); expect minutes to tens of minutes${o.parallel ? "" : " (add --parallel to run arms concurrently)"}`));
    log(dim(`output: ${outDir}`));
    const report = await runBench({
      suite,
      profiles: targets,
      grader,
      parallel: o.parallel,
      trials: o.trials,
      outDir,
      onEvent: (e) => {
        if (e.type === "case:start") log(bold(`\n▶ ${e.profile} / ${e.caseId}`));
        else if (e.type === "case:done" && e.result) {
          const r = e.result;
          log(r.ok ? dim(`  done in ${(r.ms / 1000).toFixed(0)}s, ${r.converged ? "converged" : "open"} after ${r.rounds} round(s), ${r.usage.inputTokens + r.usage.outputTokens} tokens${r.costUsd !== null ? `, ~$${r.costUsd.toFixed(2)}` : ""}${r.dropped.length ? `, dropped ${r.dropped.join(", ")}` : ""}`) : red(`  failed: ${r.error}`));
        } else if (e.type === "grade:done") log(dim(`  graded ${e.caseId}`));
      },
      engineEvents: (_p, _c, e) => {
        if (e.type === "panelist:error") log(red(`    ✗ ${e.panelist}: ${e.error}`));
      },
    });
    process.stdout.write((o.json ? JSON.stringify(report, null, 2) : renderBench(report)) + "\n");
    log(dim(`saved ${outDir}`));
  });
bench
  .command("regrade")
  .argument("<dir>", "a saved bench directory (contains results.json)")
  .requiredOption("-g, --grader <spec>", "grader model spec, ideally from a vendor not on the panels")
  .option("-s, --suite <path>", "the suite the bench ran (default: consensus.bench.json here, else the starter suite)")
  .option("--seed <n>", "grader shuffle seed (default: the original)", parseIntArg)
  .description("re-grade a saved bench with another grader without re-running any arm; writes report-<grader>.md next to the original")
  .action(async (dir: string, o: { grader: string; suite?: string; seed?: number }) => {
    const { regradeBench } = await import("./bench.js");
    const report = JSON.parse(await readFile(join(dir, "results.json"), "utf8")) as import("./bench.js").BenchReport;
    const suite = o.suite ? await loadSuite(o.suite) : await loadSuite("consensus.bench.json").catch(() => SAMPLE_SUITE);
    const grader = createPanelist(o.grader, { effort: "high", env: credentialEnv() });
    log(dim(`re-grading ${report.results.length} runs with ${grader.id}…`));
    const next = await regradeBench(report, suite, grader, o.seed);
    const file = join(dir, `report-${grader.id.replace(/[^a-z0-9]+/gi, "-")}.md`);
    await writeFile(file, renderBench(next));
    await writeFile(join(dir, `results-${grader.id.replace(/[^a-z0-9]+/gi, "-")}.json`), JSON.stringify(next, null, 2));
    process.stdout.write(renderBench(next) + "\n");
    log(dim(`wrote ${file}`));
  });
bench
  .command("init")
  .description("write the starter suite to consensus.bench.json so you can edit or extend it")
  .option("--force", "overwrite an existing consensus.bench.json")
  .action(async (o: { force?: boolean }) => {
    const { existsSync } = await import("node:fs");
    if (existsSync("consensus.bench.json") && !o.force) throw new Error("consensus.bench.json already exists; pass --force to overwrite it.");
    await writeFile("consensus.bench.json", JSON.stringify(SAMPLE_SUITE, null, 2) + "\n");
    log("wrote consensus.bench.json (add your own cases: prompt, optional context, expected for objective ones, rubric for judgment ones)");
  });

// ---- uninstall -----------------------------------------------------------
program
  .command("uninstall")
  .description("remove the MCP registration and skill packs from every host, and optionally your config and saved keys (non-interactive; --yes accepted for symmetry)")
  .option("--purge", "also delete ~/.config/consensus (profiles, packs, saved API keys)")
  .option("-y, --yes", "no-op: uninstall never prompts")
  .action(async (o: { purge?: boolean }) => {
    for (const h of listHosts().filter((x) => x.detected && x.uninstall)) {
      try {
        const done = await h.uninstall!();
        log(done.length ? `${green(G.ok)} ${h.name}: ${done.join("; ")}` : dim(`${G.no} ${h.name}: nothing to remove`));
      } catch (err) {
        log(`${red(G.err)} ${h.name}: ${(err as Error).message}`);
      }
    }
    if (o.purge) {
      const { rm } = await import("node:fs/promises");
      const { configDir } = await import("./credentials.js");
      await rm(configDir(), { recursive: true, force: true });
      log(`${green(G.ok)} removed ${configDir()}`);
    } else log(dim("config and saved keys kept (add --purge to delete ~/.config/consensus). Then: npm uninstall -g consensus-panel"));
  });

// ---- models ---------------------------------------------------------------
program
  .command("models")
  .description("list known models with prices, and how each vendor is connected")
  .action(async () => {
    const statuses = await scanVendors(credentialEnv());
    const or = statuses.find((x) => x.vendor === "openrouter")!;
    for (const vendor of CATALOG_VENDORS) {
      const v = VENDORS.find((x) => x.vendor === vendor)!;
      const s = statuses.find((x) => x.vendor === vendor)!;
      log(bold(`${v.label}`) + "  " + (s.connected ? green(`connected via ${s.spec}`) : or.connected ? yellow("via OpenRouter") : dim("not connected")));
      for (const m of CATALOG[vendor]) {
        const r = routeFor(vendor, m, statuses);
        const blocker = directRouteBlocker(vendor, m, statuses);
        const spec = r ? `${r.provider}:${r.model}` : `${v.api}:${m.id}`;
        log(`  ${spec.padEnd(40)} ${priceLabel(m).padEnd(18)} ${dim(m.tier)}${blocker ? yellow(`  cannot run here: ${blocker}`) : !r ? dim("  not connected") : ""}${m.note && !blocker ? dim(`  ${m.note}`) : ""}`);
      }
    }
    log(bold("OpenRouter") + "  " + (or.connected ? green("connected (OPENROUTER_API_KEY)") : dim("not connected; any openrouter:<vendor>/<model> id works once a key is set")));
    log(bold("\nOther providers"));
    for (const n of ["ollama"]) log(`  ${n.padEnd(10)}:${PROVIDERS[n]!.defaultModel}  ${dim(PROVIDERS[n]!.description)}`);
    log(dim("\nSpec format: provider[:model][#effort][+persona[+persona]]   e.g. claude:claude-opus-5#high+skeptic, compat:<model>@<baseURL>"));
  });

program
  .command("init")
  .description("write a project-level consensus.config.json here")
  .option("--from-profile <name>", "freeze one of your profiles into the project config so teammates get the same panel")
  .action(async (o: { fromProfile?: string }) => {
    const user = await loadUserConfig();
    const cfg: Config = { rounds: 3, effort: "high" };
    if (o.fromProfile) {
      const prof = user.profiles?.[o.fromProfile];
      if (!prof) throw new Error(`No profile "${o.fromProfile}"`);
      cfg.profile = o.fromProfile;
      cfg.profiles = { [o.fromProfile]: prof };
      const used = prof.panel.map((m) => (typeof m === "string" ? m.split("+")[1] : m.persona)).filter((x): x is string => !!x && !!user.personas?.[x]);
      if (used.length) cfg.personas = Object.fromEntries(used.map((n) => [n, user.personas![n]!]));
    }
    await writeFile("consensus.config.json", JSON.stringify(cfg, null, 2) + "\n");
    const gi = await ensureGitignore();
    log(`wrote consensus.config.json${o.fromProfile ? ` (profile ${o.fromProfile} pinned)` : " (edit `profile` or `panel` to pin models for this project)"}${gi ? "; added .consensus/ to .gitignore" : ""}`);
  });

// ---- packs -----------------------------------------------------------------
const pack = program.command("pack").description("build, add, list, remove and share packs (profiles + personas + optional bench suite)");
pack
  .command("add")
  .argument("<source>", "local file, URL, owner/repo[/path], or the name of a pack shipped with consensus")
  .option("-y, --yes", "install without confirmation")
  .option("--force", "overwrite same-named profiles/personas instead of installing them as <pack>/<name>")
  .description("install a pack into your config (shows everything first; never runs anything)")
  .action(async (source: string, o: { yes?: boolean; force?: boolean }) => {
    const cfg = await loadUserConfig();
    const bundled = new URL(`../packs/${source}.json`, import.meta.url);
    const fs = await import("node:fs");
    const resolved = /^[a-z0-9-]+$/.test(source) && fs.existsSync(bundled) ? (await import("node:url")).fileURLToPath(bundled) : source;
    const looksLikeRepo = /^[A-Za-z0-9_-][\w.-]*\/[\w.-]+/.test(resolved) && !resolved.startsWith(".") && !resolved.startsWith("/") && !fs.existsSync(resolved);
    if (!/^https?:\/\//.test(resolved) && !looksLikeRepo && !fs.existsSync(resolved)) {
      throw new Error(`No pack at "${source}". Give a file path, a URL, owner/repo, or one of the shipped packs (consensus pack list).`);
    }
    const { pack: pk, from } = await readPack(resolved);
    const d = diffPack(cfg, pk);
    log(describePack(pk, from));
    log("");
    log(`installs ${d.newProfiles.length + d.conflictingProfiles.length} profile(s), ${d.newPersonas.length + d.conflictingPersonas.length} persona(s)${d.suiteCases ? `, a ${d.suiteCases}-case bench suite` : ""}`);
    if (d.conflictingProfiles.length) log(yellow(`  existing profiles kept; pack copies installed as ${pk.name}/<name>: ${d.conflictingProfiles.join(", ")}${o.force ? " (--force: overwriting)" : ""}`));
    if (d.conflictingPersonas.length || d.builtinPersonaOverrides.length) log(yellow(`  persona name clashes installed as ${pk.name}/<name>: ${[...new Set([...d.conflictingPersonas, ...d.builtinPersonaOverrides])].join(", ")}${o.force ? " (--force: overwriting)" : ""}`));
    if (!o.yes) {
      const ok = await p.confirm({ message: "Install this pack?", initialValue: true });
      if (p.isCancel(ok) || !ok) return log("not installed");
    }
    const r = installPack(cfg, pk, from, { force: o.force });
    await saveUserConfig(r.cfg);
    log(`${green(G.ok)} installed ${pk.name}: profiles ${r.installedProfiles.join(", ")}${r.installedPersonas.length ? `; personas ${r.installedPersonas.join(", ")}` : ""}`);
    if (pk.suite) {
      const f = `${pk.name}.bench.json`;
      await writeFile(f, JSON.stringify(pk.suite, null, 2) + "\n");
      log(`  bench suite written to ${f}: consensus bench -P balanced,${r.installedProfiles[0]} -s ${f}`);
    }
    log(dim(`  try: consensus "…" --profile ${r.installedProfiles[0]}`));
  });
pack
  .command("list")
  .description("installed packs, and the packs shipped with consensus")
  .action(async () => {
    const cfg = await loadUserConfig();
    const installed = Object.entries(cfg.packs ?? {});
    log(bold("Installed"));
    if (!installed.length) log(dim("  none"));
    for (const [n, rec] of installed) log(`  ${n.padEnd(20)} v${rec.version ?? "?"}  ${dim(rec.source)}\n      profiles: ${rec.profiles.join(", ")}${rec.personas.length ? `; personas: ${rec.personas.join(", ")}` : ""}`);
    log(bold("\nShipped with consensus (consensus pack add <name>)"));
    const dir = (await import("node:url")).fileURLToPath(new URL("../packs/", import.meta.url));
    const fs = await import("node:fs/promises");
    for (const f of (await fs.readdir(dir).catch(() => [] as string[])).filter((x) => x.endsWith(".json"))) {
      try {
        const { pack: pk } = await readPack(join(dir, f));
        log(`  ${pk.name.padEnd(20)} ${dim(pk.description ?? "")}`);
      } catch {
        /* skip */
      }
    }
  });
pack
  .command("remove")
  .description("remove an installed pack's profiles and personas")
  .argument("<name>")
  .action(async (name: string) => {
    const cfg = await loadUserConfig();
    await saveUserConfig(removePack(cfg, name));
    log(`removed pack ${name}`);
  });
pack
  .command("create")
  .argument("<name>", "pack name (lowercase, dashes)")
  .requiredOption("-p, --profiles <names>", "comma-separated profiles to bundle (their custom personas come along)")
  .option("-o, --out <file>", "output file (default: <name>.json)")
  .option("--description <text>")
  .option("--author <text>")
  .description("bundle your profiles and personas into a shareable pack file with portable any:<model> seats")
  .action(async (name: string, o: { profiles: string; out?: string; description?: string; author?: string }) => {
    const cfg = await loadUserConfig();
    const pk = createPack(cfg, o.profiles.split(",").map((x) => x.trim()), { name, description: o.description, author: o.author });
    const file = o.out ?? `${name}.json`;
    await writeFile(file, JSON.stringify(pk, null, 2) + "\n");
    log(describePack(pk));
    log(`\nwrote ${file}. Share it, or publish it as consensus-pack.json at the root of a repo so others can \`consensus pack add you/repo\`.`);
  });

program
  .command("mcp")
  .description("run as an MCP server over stdio (for Claude Code, Codex, Cursor, etc.)")
  .action(async () => {
    const { startMcpServer } = await import("./mcp.js");
    await startMcpServer();
  });

program.addHelpText(
  "after",
  `
Ask the panel (the default command):
  consensus "your question"                          default profile (or auto-detect)
  consensus "your question" -c context.md            paste real code / constraints
  consensus "..." --profile frontier --rounds 2      pick a profile, cap rounds
  consensus "..." --panel claude+skeptic,codex       explicit seats: provider[:model][#effort][+persona]
  consensus "..." --max-cost 2 --verbose             spend ceiling; stream verdicts
  consensus runs / consensus log [id] [--html]       browse and replay debates
Every run prints its seats before starting and its cost after; a bare single word is refused so a typo can't start a paid run.
`,
);

loadCredentials()
  .then(() => program.parseAsync(process.argv))
  .catch((err: unknown) => {
    log(red(`error: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  });
