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
    if (onPathNow) rows.push(["PATH", `on PATH${rc.length ? ` (${rc.join(", ")})` : ""}`]);
    else if (rc.length) {
      rows.push(["PATH", `new terminals: ${rc.join(", ")}`]);
      rows.push(["This shell", (hint || `source ${tilde(inst.receipt?.envFile ?? "~/.consensus/env")}`).replace(/^this shell: /, "")]);
    } else rows.push(["PATH", hint || `not on PATH: add ${tilde(inst.receipt?.binDir ?? "~/.local/bin")}`]);
  } else {
    rows.push(["Installed", `consensus ${version} (${kind === "npm" ? "npm package" : kind === "archive" ? "release archive" : "source checkout"}, Node ${process.versions.node})`]);
    rows.push(["PATH", onPathNow ? "consensus is on PATH" : "consensus is not on this shell's PATH"]);
  }
  const accounts = i.statuses.map((s) => `${s.connected ? G.ok : G.no} ${s.label}${s.connected ? (s.via === "cli" && s.cli ? ` via ${s.cli.name}` : " key") : ""}`);
  rows.push(["Accounts", [0, 2, 4].map((k) => accounts.slice(k, k + 2).join("   ")).filter(Boolean).join("\n")]);
  const names = Object.keys(i.cfg.profiles ?? {});
  rows.push(["Profiles", names.length ? names.map((n) => (n === i.cfg.profile ? `${n} (default)` : n)).join(", ") : "none yet"]);
  rows.push(["Config", tilde(i.cfgPath)]);
  if (existsSync(credentialsPath())) rows.push(["Keys", `${tilde(credentialsPath())} (mode 600)`]);
  rows.push(["IDEs wired", i.wired.length ? i.wired.join(", ") : "none"]);
  if (i.wired.length) rows.push(["MCP command", i.mcpCommand.map((x) => tilde(x)).join(" ")]);
  rows.push(["Telemetry", "none (there is no consensus server to send anything to)"]);
  const width = Math.max(...rows.map(([k]) => k.length)) + 2;
  const lines = rows.map(([k, v]) => `${k.padEnd(width)}${v.split("\n").join(`\n${" ".repeat(width)}`)}`);
  lines.push("");
  if (i.ready) {
    lines.push(`Try:  consensus "Postgres SKIP LOCKED queue or Redis for our jobs?"`);
    lines.push("      consensus doctor    consensus --help    consensus uninstall --all");
  } else {
    const n = i.statuses.filter((s) => s.connected).length;
    lines.push(`Not ready yet: ${n === 0 ? "no models connected" : `${n} model connected`}; a panel needs 2.`);
    lines.push("Next: consensus connect openrouter  (one key seats every vendor)");
    lines.push("  or: consensus connect <vendor>, then consensus doctor");
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

/** Vendor login/install commands get the terminal, but never forever (a browser login can wait indefinitely). */
const INTERACTIVE_TIMEOUT_MS = 5 * 60_000;

function interactive(bin: string, args: string[], timeoutMs = INTERACTIVE_TIMEOUT_MS): boolean {
  const r = spawnSync(bin, args, { stdio: "inherit", timeout: timeoutMs });
  if ((r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") {
    p.log.warn(`\`${[bin, ...args].join(" ")}\` did not finish within ${Math.round(timeoutMs / 60_000)} minutes, so it was stopped. Run it yourself later, then \`consensus doctor\`.`);
    return false;
  }
  if (r.error) p.log.error(`Could not run ${bin}: ${r.error.message}`);
  return r.status === 0;
}

/** No browser to open: SSH sessions and Linux without a display. */
export function isHeadless(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
  if (env.SSH_CONNECTION || env.SSH_TTY) return true;
  return platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY && !env.BROWSER;
}

/** The login command for a vendor CLI, switched to device-code auth when no browser can open. */
export function loginArgs(cli: string, loginCommand: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] {
  const args = loginCommand.split(" ").slice(1);
  if (cli === "codex" && isHeadless(env, platform)) args.push("--device-auth");
  return args;
}

/** Default choice when connecting a vendor: log in if its CLI is already there, otherwise paste a key. Installing a CLI is never the default. */
export function defaultConnectChoice(s: Pick<VendorStatus, "cli">): "login" | "key" {
  return s.cli?.installed ? "login" : "key";
}

export async function connectVendor(s: VendorStatus): Promise<void> {
  const cliInfo = s.cli ? PROVIDERS[s.cli.name] : undefined;
  const apiInfo = PROVIDERS[s.apiProvider]!;
  const options: { value: string; label: string; hint?: string }[] = [];
  if (s.cli && cliInfo && s.cli.installed) options.push({ value: "login", label: `Log in with ${s.cli.name} (${cliInfo.subscription})`, hint: cliInfo.loginCommand });
  options.push({ value: "key", label: `Paste an API key (${apiInfo.envKey})`, hint: "stored in ~/.config/consensus/credentials.json, chmod 600" });
  if (s.cli && cliInfo && !s.cli.installed && cliInfo.installCommand?.startsWith("npm")) {
    options.push({ value: "install", label: `Install ${s.cli.name} and log in (${cliInfo.subscription})`, hint: `asks first: ${cliInfo.installCommand}` });
  }
  options.push({ value: "skip", label: "Skip for now" });

  const choice = await p.select({ message: `Connect ${s.label}`, options, initialValue: defaultConnectChoice(s) });
  bail(choice);
  switch (choice) {
    case "install": {
      if (!onPath("npm")) {
        p.log.error(`npm is not on PATH, so ${s.cli!.name} cannot be installed from here. Install it yourself (${cliInfo!.installCommand}) or paste an API key instead.`);
        return;
      }
      const sure = await p.confirm({ message: `Run \`${cliInfo!.installCommand}\` now? (installs a global npm package)`, initialValue: false });
      bail(sure);
      if (!sure) return;
      p.log.step(`Running: ${cliInfo!.installCommand}`);
      if (!interactive("sh", ["-c", cliInfo!.installCommand!])) {
        p.log.error("Install failed.");
        return;
      }
    }
    // fall through
    case "login": {
      const args = loginArgs(s.cli!.name, cliInfo!.loginCommand!);
      const headless = args.includes("--device-auth");
      p.log.step(`Running: ${cliInfo!.bin} ${args.join(" ")}  ${headless ? "(device code: open the link it prints on any device)" : "(a browser window may open)"}`);
      if (s.cli!.name === "gemini") p.log.info("Gemini CLI logs in on first interactive run. Type /auth inside it if needed, then quit with /quit.");
      interactive(cliInfo!.bin!, args);
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
  // Some pty wrappers report 0 columns, which makes clack print one character per line.
  if (process.stdout.isTTY && !process.stdout.columns) (process.stdout as { columns: number }).columns = 80;
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

  if (!o.yes && statuses.some((x) => !x.connected)) {
    const missing = statuses.filter((x) => !x.connected);
    // Pre-select only vendors whose CLI is already installed (a login away); nothing gets installed from this screen.
    const pick = await p.multiselect({
      message: "Connect more models now? (space toggles, enter continues; you can also do this later with `consensus connect`)",
      options: missing.map((st) => ({ value: st.vendor, label: st.label, hint: st.cli?.installed ? `log in with ${st.cli.name}` : "API key" })),
      initialValues: missing.filter((st) => st.cli?.installed).map((st) => st.vendor),
      required: false,
    });
    bail(pick);
    for (const st of missing.filter((x) => (pick as string[]).includes(x.vendor))) await connectVendor(st);
    s = p.spinner();
    s.start("Re-checking");
    statuses = await scanVendors(credentialEnv());
    s.stop("Accounts");
    p.note(statuses.map(statusLine).join("\n"), "Connected");
  }
  const connected = statuses.filter((x) => x.connected);
  const reachable = connected.some((x) => x.vendor === "openrouter") ? 4 : connected.length;
  if (reachable < 2) {
    p.log.warn(`${connected.length === 0 ? "No models connected yet" : `Only ${connected.length} vendor connected`}. A panel needs at least 2. Connect more with \`consensus connect <vendor>\`, or add an OpenRouter key to reach every vendor at once.`);
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
      cfg.profile ??= Object.keys(starters).includes("balanced") ? "balanced" : Object.keys(starters)[0];
      await saveUserConfig(cfg); // saved now, so quitting a later question keeps the profiles
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
    p.outro(`Connect ${connected.length === 0 ? "two models" : "one more model"}, then ask your first question.`);
    if (o.yes) process.exitCode = 3;
  }
}
