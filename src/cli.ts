#!/usr/bin/env node
import * as p from "@clack/prompts";
import { Command, InvalidArgumentError } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { CATALOG, CATALOG_VENDORS, priceLabel, routeFor } from "./catalog.js";
import { loadConfig, loadUserConfig, resolveRun, saveUserConfig, type Config } from "./config.js";
import { credentialEnv, loadCredentials } from "./credentials.js";
import { createPack, describePack, diffPack, installPack, readPack, removePack } from "./packs.js";
import { configWarnings } from "./config.js";
import { ensureGitignore } from "./hosts.js";
import { estimateCost } from "./bench.js";
import { probeSpecs, scanVendors } from "./doctor.js";
import { installProjectMcp, installProjectSkills, listHosts, mcpLaunchCommand } from "./hosts.js";
import { describeProfile, editProfile, materializePreset, memberLabel } from "./profiles.js";
import { PRESETS } from "./catalog.js";
import { PROVIDERS, VENDORS, createPanelist } from "./providers/index.js";
import { PERSONAS } from "./personas.js";
import { SAMPLE_SUITE, loadSuite, renderBench, runBench, type BenchProfileTarget } from "./bench.js";
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

import { G, bold, dim, green, log, progressLogger, red, yellow } from "./progress.js";
import { preflight } from "./doctor.js";
import { renderRunHtml } from "./store.js";
import { materializePreset as _mp } from "./profiles.js";

function parseIntArg(v: string): number {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 1) throw new InvalidArgumentError("must be a positive integer");
  return n;
}
function parseEffort(v: string): Effort {
  if (!["low", "medium", "high", "max"].includes(v)) throw new InvalidArgumentError("must be low|medium|high|max");
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
  .version(version);

// ---- run ---------------------------------------------------------------
program
  .command("run", { isDefault: true })
  .description("ask the panel (default command): consensus \"your question\" [-c context.md] [--profile name]")
  .argument("[prompt]", "the problem to solve ('-' or omitted reads stdin)")
  .option("-f, --file <path>", "read the prompt from a file")
  .option("-c, --context <path>", "extra context file (code, docs, constraints) appended to the problem")
  .option("-P, --profile <name>", "model profile to use (see `consensus profiles`)")
  .option("-p, --panel <specs>", "comma-separated panelists, e.g. claude,codex:gpt-5.6-sol,xai:grok-4.6#max")
  .option("-j, --judge <spec>", "panelist that writes the final synthesis")
  .option("-r, --rounds <n>", "max critique/revise rounds", parseIntArg)
  .option("-e, --effort <level>", "low|medium|high|max (default for models without their own #effort)", parseEffort)
  .option("--max-tokens <n>", "max output tokens per call", parseIntArg)
  .option("--max-cost <usd>", "abort once the estimated API list-price spend exceeds this (subscription seats aren't counted)", (v: string) => { const n = Number(v); if (!(n > 0)) throw new InvalidArgumentError("must be a positive number"); return n; })
  .option("--no-retry", "do not retry a seat once on a transient failure")
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
      throw new Error(`"${promptArg}" looks like a command, not a question, and a run spends money. Use \`consensus run "${promptArg}"\` if you meant it, or \`consensus --help\`.`);
    }
    const prompt = (await readPrompt(promptArg, o.file)).trim();
    if (!prompt) throw new Error("Prompt is empty");
    const context = o.context ? await readFile(o.context, "utf8") : undefined;

    const r = await resolveRun({
      cfg,
      panel: o.panel ? String(o.panel).split(",") : undefined,
      profile: o.profile,
      judge: o.judge,
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
      log(dim(`panel${r.profile ? ` (${r.profile})` : ` (${r.source})`}: ${seats}`));
      const onPanel = r.panel.some((x) => x.id === r.judge.id);
      log(dim(`judge: ${r.judge.id}${onPanel ? "" : " (external, did not debate)"}  rounds: ${r.rounds}  cost: ${cliSeats === r.panel.length ? "subscription quota" : cliSeats ? "subscription quota + API tokens" : "API tokens"}; roughly ${r.panel.length * (1 + 2 * r.rounds)} model calls at most${o.maxCost ? `; ceiling $${o.maxCost}` : ""}`));
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
    const engine = new ConsensusEngine({
      panel: r.panel,
      judge: r.judge,
      rounds: r.rounds,
      effort: r.effort,
      maxTokens: o.maxTokens ?? cfg.maxTokens,
      maxCostUsd: o.maxCost,
      retry: o.retry !== false,
      onEvent,
      signal: ac.signal,
    });
    let run: import("./types.js").ConsensusRun;
    try {
      run = await engine.run(prompt, context);
    } finally {
      await debate?.close();
    }
    const out = o.json ? JSON.stringify(run, null, 2) : renderReport(run, { transcript: o.transcript });
    process.stdout.write(out + "\n");
    if (!o.quiet) {
      const cost = estimateCost(run.usage);
      const dropped = Object.keys(run.dropped);
      if (dropped.length) {
        log(yellow(`panel shrank: ${dropped.length} seat(s) dropped (${dropped.join(", ")}); ${run.seats.length - dropped.length} of ${run.seats.length} answered. Exit code 2.`));
        process.exitCode = 2;
      }
      log(dim(`cost: ${cost.usd !== null ? `~$${cost.usd.toFixed(2)} at API list price` : "n/a"}${cost.unpriced.length ? ` (not priced: ${cost.unpriced.join(", ")})` : ""}${run.seats.some((s) => ["claude", "codex", "gemini", "grok"].includes(s.provider)) ? "; subscription seats bill quota, not tokens" : ""}`));
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
      log(`${r.id}  ${r.converged ? green("converged") : yellow("open")} ${r.rounds}r  ${dim(r.panel.join(", "))}`);
      log(`  ${r.prompt.replace(/\s+/g, " ").slice(0, 100)}`);
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
    if (o.answer) return void process.stdout.write(run.synthesis + "\n");
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
  .option("--no-first-run", "skip the guided first debate at the end")
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
      log(`  ${h.detected ? "✓" : "○"} ${h.name.padEnd(28)} ${h.detected ? dim(parts) : dim("not detected")}`);
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
    for (const n of names) log(describeProfile(n, cfg.profiles![n]!, n === cfg.profile));
  });

const profile = program.command("profile").description("create, edit, switch, or delete model profiles");
profile
  .command("presets")
  .description("list built-in presets and whether your connections can satisfy them")
  .action(async () => {
    const statuses = await scanVendors(credentialEnv());
    for (const preset of PRESETS) {
      const prof = materializePreset(preset, statuses);
      log(`${prof ? green(G.ok) : dim("○")} ${preset.name.padEnd(14)} ${preset.description}`);
      if (prof) log(dim(`    ${prof.panel.join(", ")}  rounds ${prof.rounds}`));
    }
    log(dim("\nconsensus profile create <name> --preset <preset>   creates one;  add --edit to tweak it first"));
  });
profile
  .command("create")
  .argument("[name]")
  .description("build a profile with the interactive model selector, or from a preset")
  .option("--preset <preset>", `start from a preset: ${PRESETS.map((x) => x.name).join(", ")}`)
  .option("--edit", "with --preset: open the selector to tweak it before saving")
  .action(async (name: string | undefined, o: { preset?: string; edit?: boolean }) => {
    const cfg = await loadUserConfig();
    const statuses = await scanVendors(credentialEnv());
    let r: { name: string; profile: import("./config.js").Profile };
    if (name && cfg.profiles?.[name] && !o.edit) {
      const ok = await p.confirm({ message: `Profile "${name}" already exists. Overwrite it?`, initialValue: false });
      if (p.isCancel(ok) || !ok) return log("left unchanged");
    }
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
      if (fresh && JSON.stringify(fresh.panel) !== JSON.stringify(cur.panel)) {
        cfg.profiles![preset.name] = { ...fresh, description: cur.description ?? fresh.description };
        changed.push(`${preset.name}: ${fresh.panel.join(", ")}`);
      }
    }
    await saveUserConfig(cfg);
    log(changed.length ? changed.join("\n") : "all preset profiles already match your connections");
  });
profile
  .command("show")
  .argument("<name>")
  .action(async (name: string) => {
    const cfg = await loadConfig();
    const prof = cfg.profiles?.[name];
    if (!prof) throw new Error(`No profile "${name}"`);
    log(describeProfile(name, prof, name === cfg.profile));
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
  .command("remove")
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
      targets.push({ name: n, panel: r.panel, judge: r.judge, rounds: r.rounds, effort: r.effort });
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
    log(dim(`profiles: ${names.join(", ")}  cases: ${suite.cases.map((c) => c.id).join(", ")}  grader: ${grader.id}`));
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
  .command("init")
  .description("write the starter suite to consensus.bench.json so you can edit or extend it")
  .action(async () => {
    await writeFile("consensus.bench.json", JSON.stringify(SAMPLE_SUITE, null, 2) + "\n");
    log("wrote consensus.bench.json (add your own cases: prompt, optional context, expected for objective ones, rubric for judgment ones)");
  });

// ---- uninstall -----------------------------------------------------------
program
  .command("uninstall")
  .description("remove the MCP registration and skill packs from every host, and optionally your config and saved keys")
  .option("--purge", "also delete ~/.config/consensus (profiles, packs, saved API keys)")
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
        const spec = r ? `${r.provider}:${r.model}` : `${v.api}:${m.id}`;
        log(`  ${spec.padEnd(40)} ${priceLabel(m).padEnd(18)} ${dim(m.tier)}${m.note ? dim(`  ${m.note}`) : ""}`);
      }
    }
    log(bold("OpenRouter") + "  " + (or.connected ? green("connected (OPENROUTER_API_KEY)") : dim("not connected; any openrouter:<vendor>/<model> id works once a key is set")));
    log(bold("\nOther providers"));
    for (const n of ["ollama"]) log(`  ${n.padEnd(10)}:${PROVIDERS[n]!.defaultModel}  ${dim(PROVIDERS[n]!.description)}`);
    log(dim("\nSpec format: provider[:model][#effort]   e.g. claude:claude-opus-5#high, compat:<model>@<baseURL>"));
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
    if (!/^https?:\/\//.test(resolved) && !/^[\w.-]+\/[\w.-]+/.test(resolved) && !fs.existsSync(resolved)) {
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
