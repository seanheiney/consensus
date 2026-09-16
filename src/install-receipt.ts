/**
 * The standalone install (install.sh / install.ps1): where it lives, its receipt,
 * the stable launcher path for MCP hosts, and exact removal for `uninstall --all`.
 *
 * Layout written by the installers:
 *   ~/.consensus/                         (Windows: %LOCALAPPDATA%\consensus)
 *     versions/<version>/{bin,app,node}   one directory per installed version
 *     current -> versions/<version>       symlink (junction on Windows)
 *     env, env.fish                       PATH snippets sourced by the rc lines
 *     receipt.json                        what was installed where (see InstallReceipt)
 *   ~/.local/bin/consensus -> ~/.consensus/current/bin/consensus
 *   one line per rc file:  . "$HOME/.consensus/env"  # consensus
 *
 * The launcher (bin/consensus) exports CONSENSUS_HOME=<root>/versions/<version>,
 * which is how a running process knows it is the standalone install.
 */
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export interface InstallReceipt {
  kind: "standalone";
  version: string;
  platform: string;
  sha256?: string;
  source?: string;
  installedAt?: string;
  root: string;
  launcher: string;
  binDir: string;
  envFile?: string;
  rcFiles: string[];
  installer?: string;
}

export type InstallKind = "standalone" | "npm" | "source";

const isWin = (): boolean => process.platform === "win32";

/** Where the installers put versions: $CONSENSUS_ROOT, else ~/.consensus (%LOCALAPPDATA%\consensus on Windows). */
export function defaultInstallRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CONSENSUS_ROOT) return resolve(env.CONSENSUS_ROOT);
  if (isWin()) return join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "consensus");
  return join(env.HOME || homedir(), ".consensus");
}

/** The install root this process was launched from, when it runs from <root>/versions/<version>. */
export function runningRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!env.CONSENSUS_HOME) return undefined;
  const home = resolve(env.CONSENSUS_HOME);
  return basename(dirname(home)) === "versions" ? dirname(dirname(home)) : undefined;
}

export function readReceipt(root: string): InstallReceipt | undefined {
  try {
    const r = JSON.parse(readFileSync(join(root, "receipt.json"), "utf8")) as InstallReceipt;
    return r && r.kind === "standalone" ? { ...r, rcFiles: Array.isArray(r.rcFiles) ? r.rcFiles : [] } : undefined;
  } catch {
    return undefined;
  }
}

/** The receipt of the install this process runs from, or else of the default location. */
export function findReceipt(env: NodeJS.ProcessEnv = process.env): { root: string; receipt?: InstallReceipt } | undefined {
  for (const root of [runningRoot(env), defaultInstallRoot(env)]) {
    if (!root) continue;
    const receipt = readReceipt(root);
    if (receipt || existsSync(join(root, "versions"))) return { root, receipt };
  }
  return undefined;
}

export function installKind(env: NodeJS.ProcessEnv = process.env, selfPath = ""): InstallKind {
  if (runningRoot(env)) return "standalone";
  return /[\\/]node_modules[\\/]/.test(selfPath) ? "npm" : "source";
}

/**
 * Stable launcher for MCP hosts when running from the standalone install:
 * the receipt's link (~/.local/bin/consensus) if it still exists, else
 * <root>/current/bin/consensus. Both survive upgrades and Node version managers,
 * unlike process.execPath. Undefined when not running standalone.
 */
export function standaloneLauncher(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const root = runningRoot(env);
  if (!root) return undefined;
  const receipt = readReceipt(root);
  if (receipt?.launcher && existsSync(receipt.launcher)) return receipt.launcher;
  const current = join(root, "current", "bin", isWin() ? "consensus.cmd" : "consensus");
  if (existsSync(current)) return current;
  return join(resolve(env.CONSENSUS_HOME!), "bin", isWin() ? "consensus.cmd" : "consensus");
}

// ---- rc lines -------------------------------------------------------------

/** The exact line install.sh appends: `. "$HOME/.consensus/env"  # consensus`. */
export function rcLine(envRef: string): string {
  return `. "${envRef}"  # consensus`;
}

const RC_LINE_RE = /^[ \t]*(?:\.|source)[ \t]+"[^"\n]*env(?:\.fish)?"[ \t]+# consensus[ \t]*$/;

export function isConsensusRcLine(line: string): boolean {
  return RC_LINE_RE.test(line);
}

/** Append the guarded line unless an identical one exists (mirrors install.sh). */
export function addRcLine(text: string, envRef: string): { text: string; added: boolean } {
  const line = rcLine(envRef);
  if (text.split(/\r?\n/).some((l) => l.trim() === line)) return { text, added: false };
  const sep = text.length && !text.endsWith("\n") ? "\n" : "";
  return { text: `${text}${sep}${line}\n`, added: true };
}

/** Remove only the lines the installer added; everything else is byte-for-byte kept. */
export function stripRcLines(text: string): { text: string; removed: number } {
  const lines = text.split("\n");
  const kept = lines.filter((l) => !isConsensusRcLine(l.replace(/\r$/, "")));
  return { text: kept.join("\n"), removed: lines.length - kept.length };
}

/** Rc files an install may have touched: the receipt's list plus every file install.sh considers. */
export function candidateRcFiles(receipt: InstallReceipt | undefined, env: NodeJS.ProcessEnv = process.env): string[] {
  const home = env.HOME || homedir();
  const zd = env.ZDOTDIR || home;
  const xdg = env.XDG_CONFIG_HOME || join(home, ".config");
  const files = [
    ...(receipt?.rcFiles ?? []),
    join(zd, ".zshrc"),
    join(zd, ".zprofile"),
    join(home, ".zshrc"),
    join(home, ".zprofile"),
    join(home, ".bashrc"),
    join(home, ".bash_profile"),
    join(home, ".bash_login"),
    join(home, ".profile"),
    join(xdg, "fish", "conf.d", "consensus.fish"),
  ];
  return [...new Set(files)];
}

// ---- uninstall ------------------------------------------------------------

function isLinkInto(path: string, root: string): boolean {
  try {
    if (!lstatSync(path).isSymbolicLink()) return false;
    const target = resolve(dirname(path), readlinkSync(path));
    return target.startsWith(root + "/") || target.startsWith(root + "\\") || /[\\/]current[\\/]bin[\\/]consensus(\.cmd)?$/.test(target);
  } catch {
    return false;
  }
}

/**
 * Remove the standalone install: launcher link, rc lines, fish drop-in, versions,
 * env files and receipt. Anything else under the root (e.g. runs saved by running
 * consensus in your home directory) is kept, and the root is removed only if empty.
 * Returns one human-readable line per thing removed.
 */
export async function uninstallStandalone(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const done: string[] = [];
  const found = findReceipt(env);
  const root = found?.root ?? defaultInstallRoot(env);
  const receipt = found?.receipt;
  const home = env.HOME || homedir();

  const links = [receipt?.launcher, join(env.XDG_BIN_HOME || join(home, ".local", "bin"), "consensus"), join(root, "bin", "consensus")].filter((x): x is string => !!x);
  for (const link of [...new Set(links)]) {
    if (isLinkInto(link, root)) {
      await rm(link, { force: true });
      done.push(`removed ${link}`);
    }
  }

  for (const f of candidateRcFiles(receipt, env)) {
    if (!existsSync(f)) continue;
    try {
      if (basename(f) === "consensus.fish" && basename(dirname(f)) === "conf.d") {
        if ((await readFile(f, "utf8")).includes("# consensus")) {
          await rm(f, { force: true });
          done.push(`removed ${f}`);
        }
        continue;
      }
      if (lstatSync(f).isSymbolicLink() || !lstatSync(f).isFile()) continue;
      const { text, removed } = stripRcLines(await readFile(f, "utf8"));
      if (removed) {
        await writeFile(f, text);
        done.push(`removed the consensus PATH line from ${f}`);
      }
    } catch (err) {
      done.push(`could not edit ${f}: ${(err as Error).message}`);
    }
  }

  if (isWin()) {
    const { spawnSync } = await import("node:child_process");
    const bin = join(root, "current", "bin");
    const ps = `$p=[Environment]::GetEnvironmentVariable('Path','User'); if ($p) { $n=($p -split ';' | Where-Object { $_ -and ($_.TrimEnd('\\') -ne '${bin.replace(/'/g, "''")}') }) -join ';'; if ($n -ne $p) { [Environment]::SetEnvironmentVariable('Path',$n,'User'); 'removed' } }`;
    const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8" });
    if (r.stdout?.includes("removed")) done.push(`removed ${bin} from your user PATH`);
  }

  if (existsSync(root)) {
    const ours = ["current", "versions", "env", "env.fish", "receipt.json", "install.log", "bin"];
    const entries = await readdir(root).catch(() => [] as string[]);
    const failed: string[] = [];
    for (const name of entries.filter((n) => ours.includes(n) || n.startsWith(".install."))) {
      const path = join(root, name);
      try {
        // `current` is a symlink / junction: remove the link, never recurse through it.
        if (name === "current") await rm(path, { force: true, recursive: false }).catch(async () => rmdir(path));
        else await rm(path, { recursive: true, force: true });
      } catch (err) {
        failed.push(`${name} (${(err as NodeJS.ErrnoException).code ?? (err as Error).message})`);
      }
    }
    if (failed.length && isWin()) {
      // Files of the running node.exe cannot be deleted while it runs: finish after exit.
      const { spawn } = await import("node:child_process");
      const child = spawn("cmd.exe", ["/d", "/c", `ping -n 3 127.0.0.1 >nul & rmdir /s /q "${join(root, "versions")}" & rmdir "${join(root, "current")}" & rmdir "${root}"`], { detached: true, stdio: "ignore", windowsHide: true });
      child.unref();
      done.push(`${root}: remaining files are removed once this process exits`);
    } else if (failed.length) {
      done.push(`could not remove from ${root}: ${failed.join(", ")}`);
    } else if (entries.length) {
      const left = await readdir(root).catch(() => [] as string[]);
      if (!left.length) {
        await rmdir(root).catch(() => undefined);
        done.push(`removed ${root}`);
      } else {
        done.push(`removed the install from ${root} (kept: ${left.join(", ")})`);
      }
    }
  }
  return done;
}
