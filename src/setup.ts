/** `consensus setup`: connect accounts, build profiles, teach your IDEs. */
import * as p from "@clack/prompts";
import { spawnSync } from "node:child_process";
import { loadUserConfig, saveUserConfig, type Config } from "./config.js";
import { credentialEnv, saveCredential } from "./credentials.js";
import { scanVendors, probeSpecs, type VendorStatus } from "./doctor.js";
import { installProjectMcp, installProjectSkills, listHosts, mcpLaunchCommand } from "./hosts.js";
import { editProfile, starterProfiles } from "./profiles.js";
import { PROVIDERS } from "./providers/index.js";
import { resolveRun } from "./config.js";
import { ConsensusEngine } from "./protocol/engine.js";
import { renderReport } from "./report.js";
import { saveRun } from "./store.js";
import { G, progressLogger } from "./progress.js";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { credentialsPath } from "./credentials.js";
import { findReceipt, installKind } from "./install-receipt.js";
import { onPath } from "./providers/index.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

function tilde(path: string): string {
  const h = process.env.HOME || homedir();
  return path === h ? "~" : path.startsWith(h + "/") || path.startsWith(h + "\\") ? `~${path.slice(h.length)}` : path;
}

export interface SummaryInput {
  statuses: VendorStatus[];
  cfg: Config;
  cfgPath: string;
  wired: string[];
  mcpCommand: string[];
  ready: boolean;
  env?: NodeJS.ProcessEnv;
}

/** The end-of-setup "what happened" screen: every row is something setup or the installer actually did. */
export function setupSummary(i: SummaryInput): string {
  const env = i.env ?? process.env;
  const rows: [string, string][] = [];
  const kind = installKind(env, fileURLToPath(import.meta.url));
  const inst = kind === "standalone" ? findReceipt(env) : undefined;
  const onPathNow = onPath("consensus", env);
  if (inst) {
    rows.push(["Installed", `consensus ${inst.receipt?.version ?? version} (bundled Node ${process.versions.node}) in ${tilde(inst.root)}`]);
    if (inst.receipt?.launcher) rows.push(["Launcher", tilde(inst.receipt.launcher)]);
    const rc = (inst.receipt?.rcFiles ?? []).map(tilde);
    const hint = env.CONSENSUS_PATH_HINT;
    if (onPathNow) rows.push(["PATH", `consensus is on PATH${rc.length ? ` (via ${rc.join(", ")})` : ""}`]);
    else if (rc.length) rows.push(["PATH", `new terminals: ok (${rc.join(", ")}); ${hint || `this one: source ${tilde(inst.receipt?.envFile ?? "~/.consensus/env")}`}`]);
    else rows.push(["PATH", hint || `not on PATH: add ${tilde(inst.receipt?.binDir ?? "~/.local/bin")} to PATH`]);
  } else {
    rows.push(["Installed", `consensus ${version} (${kind === "npm" ? "npm package" : "source checkout"}, Node ${process.versions.node})`]);
    rows.push(["PATH", onPathNow ? "consensus is on PATH" : "consensus is not on this shell's PATH"]);
  }
  rows.push(["Accounts", i.statuses.map((s) => `${s.connected ? G.ok : G.no} ${s.label}${s.connected ? (s.via === "cli" && s.cli ? ` via ${s.cli.name}` : " key") : ""}`).join("   ")]);
  const names = Object.keys(i.cfg.profiles ?? {});
  rows.push(["Profiles", `${names.length ? names.map((n) => (n === i.cfg.profile ? `${n} (default)` : n)).join(", ") : "none"}   ${tilde(i.cfgPath)}`]);
  if (existsSync(credentialsPath())) rows.push(["Keys", `${tilde(credentialsPath())} (mode 600)`]);
  rows.push(["IDEs wired", i.wired.length ? i.wired.join(", ") : "none"]);
  if (i.wired.length) rows.push(["MCP command", i.mcpCommand.map((x) => tilde(x)).join(" ")]);
  rows.push(["Telemetry", "none. Nothing is sent to any consensus-operated service; there isn't one."]);
  const width = Math.max(...rows.map(([k]) => k.length)) + 2;
  const lines = rows.map(([k, v]) => `${k.padEnd(width)}${v}`);
  lines.push("");
  if (i.ready) {
    lines.push(`Try:  consensus "Should we use optimistic locking or a distributed lock for inventory holds?"`);
    lines.push("      consensus doctor        consensus --help        consensus uninstall --all");
  } else {
    const n = i.statuses.filter((s) => s.connected).length;
    lines.push(`Not ready yet: ${n === 0 ? "no models connected" : `${n} model connected`}; a panel needs 2.`);
    lines.push("Next: consensus connect openrouter   (one OpenRouter key seats every vendor)");
    lines.push("  or: consensus connect <anthropic|openai|google|xai>, then consensus doctor");
  }
  return lines.join("\n");
}

const SAMPLE_PROBLEM = "A small team is adding background jobs to a Node web app on Postgres. Should they start with a Postgres-backed queue (SKIP LOCKED) or adopt Redis/BullMQ from day one? Decide and justify in under 300 words.";

/** Guided first debate: proves the install works and shows what a result looks like. */
async function firstRun(cfg: Config): Promise<void> {
  const names = Object.keys(cfg.profiles ?? {});
  const profile = names.includes("fast") ? "fast" : names.includes("budget") ? "budget" : cfg.profile;
  p.log.step(`Running your first debate with the "${profile ?? "auto"}" profile. This takes a minute or two.`);
  try {
    const r = await resolveRun({ cfg, profile, rounds: 1 });
    const engine = new ConsensusEngine({ panel: r.panel, judge: r.judge, rounds: 1, effort: r.effort, onEvent: progressLogger() });
    const run = await engine.run(SAMPLE_PROBLEM);
    const dir = await saveRun(run, cfg.runsDir);
    process.stdout.write("\n" + renderReport(run) + "\n\n");
    p.note(
      [
        `Full debate: ${dir}/report.md  (or: consensus log)`,
        "",
        "Next:",
        `  consensus "your question" -c file-with-context.md`,
        `  consensus "your question" --profile frontier`,
        "  consensus profiles / consensus profile create",
        "  consensus bench            compare profiles on a suite of problems",
        "",
        "From your IDE or agent, just ask for a consensus / panel / second opinion:",
        "  the installed skill tells it how to call the `consensus` MCP tool.",
      ].join("\n"),
      "You're set up",
    );
  } catch (err) {
    p.log.error(`First run failed: ${(err as Error).message}`);
    p.log.info("Run `consensus doctor --probe` to see which connection is unhappy.");
  }
}

function bail(v: unknown): void {
  if (p.isCancel(v)) {
    p.cancel("Setup cancelled. Run `consensus setup` any time.");
    process.exit(0);
  }
}

export function statusLine(s: VendorStatus): string {
  const key = PROVIDERS[s.apiProvider]!.envKey;
  const mark = s.connected ? (s.via === "cli" && s.cli && !s.cli.verified ? `${G.maybe} unverified ` : `${G.ok} connected   `) : `${G.no} missing     `;
  let how: string;
  if (s.connected) how = s.via === "cli" && s.cli ? `via ${s.cli.name} (${s.cli.detail})` : `via ${key}`;
  else if (!s.cli) how = `no ${key}${s.vendor === "openrouter" ? " (optional: one key covers any vendor you haven't connected)" : ""}`;
  else how = s.cli.installed ? s.cli.detail : `${s.cli.name} not installed, no ${key}`;
  return `${mark} ${s.label.padEnd(20)} ${how}`;
}

function interactive(bin: string, args: string[]): boolean {
  const r = spawnSync(bin, args, { stdio: "inherit" });
  return r.status === 0;
}

export async function connectVendor(s: VendorStatus): Promise<void> {
  const cliInfo = s.cli ? PROVIDERS[s.cli.name] : undefined;
  const apiInfo = PROVIDERS[s.apiProvider]!;
  const options: { value: string; label: string; hint?: string }[] = [];
  if (s.cli && cliInfo) {
    if (s.cli.installed) options.push({ value: "login", label: `Log in with ${s.cli.name} (${cliInfo.subscription})`, hint: cliInfo.loginCommand });
    else if (cliInfo.installCommand?.startsWith("npm")) options.push({ value: "install", label: `Install ${s.cli.name} and log in (${cliInfo.subscription})`, hint: cliInfo.installCommand });
  }
  options.push({ value: "key", label: `Paste an API key (${apiInfo.envKey})`, hint: "stored in ~/.config/consensus/credentials.json, chmod 600" });
  options.push({ value: "skip", label: "Skip for now" });

  const choice = await p.select({ message: `Connect ${s.label}`, options });
  bail(choice);
  switch (choice) {
    case "install": {
      p.log.step(`Running: ${cliInfo!.installCommand}`);
      if (!interactive("sh", ["-c", cliInfo!.installCommand!])) {
        p.log.error("Install failed.");
        return;
      }
    }
    // fall through
    case "login": {
      const loginArgs = cliInfo!.loginCommand!.split(" ").slice(1);
      p.log.step(`Running: ${cliInfo!.loginCommand}  (a browser window may open)`);
      if (s.cli!.name === "gemini") p.log.info("Gemini CLI logs in on first interactive run. Type /auth inside it if needed, then quit with /quit.");
      interactive(cliInfo!.bin!, loginArgs);
      return;
    }
    case "key": {
      const key = await p.password({ message: `${apiInfo.envKey}`, validate: (v) => (!v?.trim() ? "Required" : undefined) });
      bail(key);
      const path = await saveCredential(apiInfo.envKey!, String(key).trim());
      p.log.success(`Saved to ${path}`);
      return;
    }
    default:
      return;
  }
}

export interface SetupOptions {
  yes?: boolean;
  project?: boolean;
  probe?: boolean;
  /** Skip the guided first debate (default: run it, also under --yes). */
  firstRun?: boolean;
}

export async function runSetup(o: SetupOptions = {}): Promise<void> {
  p.intro("consensus setup");
  const cfg: Config = await loadUserConfig();

  // 1. Accounts ------------------------------------------------------------
  let s = p.spinner();
  s.start("Looking for AI subscriptions and API keys");
  let statuses = await scanVendors(credentialEnv());
  s.stop("Accounts");
  p.note(statuses.map(statusLine).join("\n"), "Detected");
  if (statuses.some((x) => x.connected && x.via === "cli")) {
    p.log.warn("Subscription seats run your vendor CLIs headless: each debate spends the same rate limits as your interactive sessions (e.g. Claude Code's 5-hour and weekly caps). Anthropic's published terms restrict third-party products from relying on claude.ai logins; consensus is a local tool you run yourself, but read your plan's terms and prefer API keys for anything shared or automated.");
  }

  if (!o.yes) {
    for (const st of statuses.filter((x) => !x.connected)) {
      const want = await p.confirm({ message: `Connect ${st.label}?`, initialValue: true });
      bail(want);
      if (want) await connectVendor(st);
    }
    s = p.spinner();
    s.start("Re-checking");
    statuses = await scanVendors(credentialEnv());
    s.stop("Accounts");
    p.note(statuses.map(statusLine).join("\n"), "Connected");
  }
  const connected = statuses.filter((x) => x.connected);
  const reachable = connected.some((x) => x.vendor === "openrouter") ? 4 : connected.length;
  if (reachable < 2) {
    p.log.warn(`Only ${connected.length} vendor connected. A panel needs at least 2. Connect more with \`consensus connect <vendor>\`, or add an OpenRouter key to reach every vendor at once.`);
  }

  if (o.probe && connected.length) {
    s = p.spinner();
    s.start("Making one tiny call through each connection");
    const results = await probeSpecs(connected.map((c) => c.spec!));
    s.stop("Probe");
    p.note(results.map((r) => `${r.ok ? G.ok : G.err} ${r.id.padEnd(12)} ${r.ok ? `${(r.ms / 1000).toFixed(1)}s  "${r.sample}"` : r.error}`).join("\n"), "Live check");
  }

  // 2. Profiles ------------------------------------------------------------
  const starters = starterProfiles(statuses);
  cfg.profiles ??= {};
  if (Object.keys(starters).length) {
    const add = o.yes ? true : await p.confirm({ message: `Create starter profiles from your connected accounts (${Object.keys(starters).join(", ")})?`, initialValue: true });
    bail(add);
    if (add) {
      for (const [name, prof] of Object.entries(starters)) cfg.profiles[name] = prof;
      p.log.success(`Profiles: ${Object.keys(starters).join(", ")}`);
    }
  }
  if (!o.yes) {
    const custom = await p.confirm({ message: "Build a custom profile now?", initialValue: false });
    bail(custom);
    if (custom) {
      const { name, profile } = await editProfile(statuses);
      cfg.profiles[name] = profile;
    }
  }
  const names = Object.keys(cfg.profiles);
  if (names.length) {
    if (o.yes) cfg.profile = cfg.profile && names.includes(cfg.profile) ? cfg.profile : names.includes("balanced") ? "balanced" : names[0];
    else {
      const active = await p.select({ message: "Default profile", options: names.map((n) => ({ value: n, label: n, hint: cfg.profiles![n]!.description })), initialValue: cfg.profile && names.includes(cfg.profile) ? cfg.profile : names.includes("balanced") ? "balanced" : names[0] });
      bail(active);
      cfg.profile = String(active);
    }
  }
  const cfgPath = await saveUserConfig(cfg);
  p.log.success(`Config saved to ${cfgPath}`);

  // 3. Hosts: MCP + skill packs --------------------------------------------
  const hosts = listHosts().filter((h) => h.detected);
  let chosen = hosts.map((h) => h.id);
  if (!o.yes) {
    const pick = await p.multiselect({
      message: "Teach these tools about consensus (installs the MCP server and a skill pack into each)",
      options: hosts.map((h) => ({ value: h.id, label: h.name, hint: [h.installMcp && "MCP", h.installSkill && "skill"].filter(Boolean).join(" + ") })),
      initialValues: chosen,
      required: false,
    });
    bail(pick);
    chosen = pick as string[];
  }
  const cmd = mcpLaunchCommand();
  const lines: string[] = [];
  const wired: string[] = [];
  for (const h of hosts.filter((x) => chosen.includes(x.id))) {
    const before = lines.length;
    if (h.installMcp) {
      try {
        lines.push(`${h.name}: MCP ${await h.installMcp(cmd)}`);
      } catch (err) {
        lines.push(`${h.name}: MCP failed: ${(err as Error).message}`);
      }
    }
    if (h.installSkill) {
      try {
        const files = await h.installSkill();
        lines.push(`${h.name}: skill -> ${files.join(", ")}`);
      } catch (err) {
        lines.push(`${h.name}: skill failed: ${(err as Error).message}`);
      }
    }
    if (lines.slice(before).some((l) => !l.includes(" failed: "))) wired.push(h.id === "agents-standard" ? "~/.agents/skills" : h.name);
  }
  if (lines.length) p.note(lines.join("\n"), `Installed (MCP command: ${cmd.join(" ")})`);

  const doProject = o.project ?? (o.yes ? false : await p.confirm({ message: "Also add project-level files here (.claude/skills, .agents/skills, .cursor/rules, AGENTS.md, CLAUDE.md, .mcp.json)?", initialValue: false }));
  bail(doProject);
  if (doProject) {
    const files = [...(await installProjectSkills()), ...(await installProjectMcp())];
    p.note(files.join("\n"), "Project files");
  }

  // Under --yes nothing may spend quota without being asked for: the first debate needs an explicit --first-run.
  const wantFirst = o.yes ? o.firstRun === true : o.firstRun !== false;
  if (wantFirst && reachable >= 2) {
    let go: unknown = true;
    if (!o.yes) {
      go = await p.confirm({ message: "Run a quick first debate now to see it work? (spends a little quota)", initialValue: true });
      bail(go);
    }
    if (go) await firstRun(cfg);
  } else if (o.yes && o.firstRun !== true) p.log.info("No first debate under --yes (add --first-run to run one). Try: consensus \"…\" --profile fast");
  else if (o.firstRun === false) p.log.info("Skipped the first debate (--no-first-run).");
  p.note(setupSummary({ statuses, cfg, cfgPath, wired, mcpCommand: cmd, ready: reachable >= 2 }), reachable >= 2 ? "You're set up" : "Installed, not ready yet");
  if (reachable >= 2) p.outro(`Done.${cfg.profile ? ` Default profile: ${cfg.profile}.` : ""}`);
  else {
    p.outro("Connect one more model, then ask your first question.");
    if (o.yes) process.exitCode = 3;
  }
}
