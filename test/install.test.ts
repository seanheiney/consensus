import { describe, expect, it } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addRcLine, isConsensusRcLine, readReceipt, rcLine, runningRoot, standaloneLauncher, stripRcLines, uninstallStandalone } from "../src/install-receipt.js";
import { mcpLaunchCommand } from "../src/hosts.js";

const unix = process.platform !== "win32";
const repo = join(import.meta.dirname, "..");

describe("rc lines", () => {
  it("matches exactly what install.sh writes, for sh and fish", async () => {
    const script = await readFile(join(repo, "install.sh"), "utf8");
    expect(script).toContain(`RC_LINE=". \\"$ENV_REF\\"  # consensus"`);
    expect(isConsensusRcLine(rcLine("$HOME/.consensus/env"))).toBe(true);
    expect(isConsensusRcLine(`. "$HOME/.consensus/env"  # consensus`)).toBe(true);
    expect(isConsensusRcLine(`source "$HOME/.consensus/env.fish"  # consensus`)).toBe(true);
    expect(isConsensusRcLine(`. "/opt/tools/consensus/env"  # consensus`)).toBe(true);
    expect(isConsensusRcLine(`export PATH="$HOME/.local/bin:$PATH"`)).toBe(false);
    expect(isConsensusRcLine(`# consensus`)).toBe(false);
    expect(isConsensusRcLine(`. "$HOME/.cargo/env"`)).toBe(false);
  });

  it("insertion is idempotent and keeps a missing trailing newline safe", () => {
    const before = "export FOO=1"; // no trailing newline
    const once = addRcLine(before, "$HOME/.consensus/env");
    expect(once.added).toBe(true);
    expect(once.text).toBe(`export FOO=1\n. "$HOME/.consensus/env"  # consensus\n`);
    const twice = addRcLine(once.text, "$HOME/.consensus/env");
    expect(twice.added).toBe(false);
    expect(twice.text).toBe(once.text);
    expect(addRcLine("", "$HOME/.consensus/env").text).toBe(`. "$HOME/.consensus/env"  # consensus\n`);
  });

  it("removal takes out only our lines and keeps everything else byte for byte", () => {
    const user = `# my zshrc\nexport PATH="$HOME/bin:$PATH"\n\nalias ll='ls -l'  # consensus of the team\n`;
    const withOurs = addRcLine(user, "$HOME/.consensus/env").text;
    const { text, removed } = stripRcLines(withOurs);
    expect(removed).toBe(1);
    expect(text).toBe(user);
    expect(stripRcLines(user)).toEqual({ text: user, removed: 0 });
  });
});

async function standaloneLayout(): Promise<{ home: string; root: string; versionDir: string; link: string }> {
  const home = await mkdtemp(join(tmpdir(), "cs-home-"));
  const root = join(home, ".consensus");
  const versionDir = join(root, "versions", "9.9.9");
  await mkdir(join(versionDir, "bin"), { recursive: true });
  await writeFile(join(versionDir, "bin", "consensus"), "#!/bin/sh\necho fake\n");
  await chmod(join(versionDir, "bin", "consensus"), 0o755);
  await symlink("versions/9.9.9", join(root, "current"));
  const link = join(home, ".local", "bin", "consensus");
  await mkdir(join(home, ".local", "bin"), { recursive: true });
  await symlink(join(root, "current", "bin", "consensus"), link);
  return { home, root, versionDir, link };
}

describe.skipIf(!unix)("standalone install detection and MCP launch command", () => {
  it("uses the receipt's stable launcher, never a versioned node path", async () => {
    const { home, root, versionDir, link } = await standaloneLayout();
    await writeFile(join(root, "receipt.json"), JSON.stringify({ kind: "standalone", version: "9.9.9", platform: "linux-x64", root, launcher: link, binDir: join(home, ".local", "bin"), rcFiles: [] }));
    const env = { HOME: home, PATH: "/usr/bin:/bin", CONSENSUS_HOME: versionDir };
    expect(runningRoot(env)).toBe(root);
    expect(readReceipt(root)?.version).toBe("9.9.9");
    expect(standaloneLauncher(env)).toBe(link);
    expect(mcpLaunchCommand({ env })).toEqual([link, "mcp"]);
    expect(mcpLaunchCommand({ env, absolute: true })).toEqual([link, "mcp"]);
    expect(mcpLaunchCommand({ env, absolute: true }).join(" ")).not.toContain(process.execPath);
    expect(mcpLaunchCommand({ env, portable: true })).toEqual(["consensus", "mcp"]);
  });

  it("falls back to <root>/current/bin/consensus when the receipt's link is gone", async () => {
    const { root, versionDir, home } = await standaloneLayout();
    await writeFile(join(root, "receipt.json"), JSON.stringify({ kind: "standalone", version: "9.9.9", platform: "linux-x64", root, launcher: join(home, "gone", "consensus"), binDir: join(home, "gone"), rcFiles: [] }));
    const env = { HOME: home, PATH: "/usr/bin:/bin", CONSENSUS_HOME: versionDir };
    expect(mcpLaunchCommand({ env, absolute: true })).toEqual([join(root, "current", "bin", "consensus"), "mcp"]);
  });

  it("is not standalone without the launcher's CONSENSUS_HOME", () => {
    const env = { PATH: "/usr/bin:/bin" };
    expect(standaloneLauncher(env)).toBeUndefined();
    expect(mcpLaunchCommand({ env, absolute: true })[0]).not.toMatch(/\.local[\\/]bin/);
  });
});

describe.skipIf(!unix)("uninstall --all", () => {
  it("removes the link, versions, env files, receipt and only our rc lines; keeps other files", async () => {
    const { home, root, link } = await standaloneLayout();
    const bashrc = join(home, ".bashrc");
    const profile = join(home, ".profile");
    const fish = join(home, ".config", "fish", "conf.d", "consensus.fish");
    await writeFile(bashrc, `alias x=y\n. "$HOME/.consensus/env"  # consensus\n`);
    await writeFile(profile, `umask 022\n`);
    await mkdir(join(home, ".config", "fish", "conf.d"), { recursive: true });
    await writeFile(fish, `source "$HOME/.consensus/env.fish"  # consensus\n`);
    await writeFile(join(root, "env"), "x");
    await writeFile(join(root, "env.fish"), "x");
    await mkdir(join(root, "runs"), { recursive: true }); // saved debates from running in $HOME: must survive
    await writeFile(join(root, "receipt.json"), JSON.stringify({ kind: "standalone", version: "9.9.9", platform: "linux-x64", root, launcher: link, binDir: join(home, ".local", "bin"), rcFiles: [bashrc, fish] }));
    const done = await uninstallStandalone({ HOME: home, PATH: "/usr/bin:/bin", XDG_CONFIG_HOME: join(home, ".config") });
    expect(done.join("\n")).toContain(link);
    expect(existsSync(link)).toBe(false);
    expect(existsSync(join(root, "versions"))).toBe(false);
    expect(() => lstatSync(join(root, "current"))).toThrow();
    expect(existsSync(join(root, "receipt.json"))).toBe(false);
    expect(existsSync(join(root, "env"))).toBe(false);
    expect(existsSync(fish)).toBe(false);
    expect(existsSync(join(root, "runs"))).toBe(true);
    expect(await readFile(bashrc, "utf8")).toBe("alias x=y\n");
    expect(await readFile(profile, "utf8")).toBe("umask 022\n");
  });
});

/** Builds a tiny fake release for this machine and serves it over http. */
async function fakeRelease(): Promise<{ base: string; close: () => void }> {
  const dir = await mkdtemp(join(tmpdir(), "cs-rel-"));
  const os = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const asset = `consensus-${os}-${arch}.tar.gz`;
  const app = join(dir, "stage", "consensus");
  await mkdir(join(app, "bin"), { recursive: true });
  await writeFile(join(app, "VERSION"), "9.9.9\n");
  await writeFile(join(app, "bin", "consensus"), `#!/bin/sh\necho "9.9.9 (fake)"\n`);
  await chmod(join(app, "bin", "consensus"), 0o755);
  execFileSync("tar", ["-czf", join(dir, asset), "-C", join(dir, "stage"), "consensus"], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  const sha = createHash("sha256").update(await readFile(join(dir, asset))).digest("hex");
  const files: Record<string, Buffer> = { [`/${asset}`]: await readFile(join(dir, asset)), "/SHA256SUMS": Buffer.from(`${sha}  ${asset}\n`) };
  const server = createServer((req, res) => {
    const body = files[req.url ?? ""];
    if (!body) return void res.writeHead(404).end("not found");
    res.writeHead(200, { "content-length": body.length }).end(body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return { base: `http://127.0.0.1:${port}`, close: () => server.close() };
}

function runInstaller(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn("sh", [join(repo, "install.sh"), ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

describe.skipIf(!unix)("install.sh against a local fake release", () => {
  it("installs, adds exactly one rc line per file, and re-runs idempotently", async () => {
    const rel = await fakeRelease();
    try {
      const home = await mkdtemp(join(tmpdir(), "cs-inst-"));
      const env = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home, SHELL: "/bin/bash", CONSENSUS_DOWNLOAD_BASE: rel.base };
      await writeFile(join(home, ".bashrc"), "alias x=y"); // no trailing newline
      const first = await runInstaller(["--no-setup"], env);
      expect(first.code, first.out).toBe(0);
      expect(first.out).toContain("sha256 ok");
      const bashrc = await readFile(join(home, ".bashrc"), "utf8");
      expect(bashrc).toBe(`alias x=y\n. "$HOME/.consensus/env"  # consensus\n`);
      const loginFile = process.platform === "darwin" ? ".bash_profile" : ".profile";
      expect((await readFile(join(home, loginFile), "utf8")).match(/# consensus/g)).toHaveLength(1);
      expect(readReceipt(join(home, ".consensus"))?.version).toBe("9.9.9");
      expect(execFileSync(join(home, ".local", "bin", "consensus")).toString()).toContain("9.9.9");
      // a fresh login shell finds it through the env file
      expect(execFileSync("/bin/sh", ["-c", `. "${home}/.consensus/env" && command -v consensus`], { env: { PATH: "/usr/bin:/bin", HOME: home } }).toString().trim()).toBe(join(home, ".local", "bin", "consensus"));

      const second = await runInstaller(["--no-setup"], env);
      expect(second.code, second.out).toBe(0);
      expect(second.out).toContain("already current");
      expect(await readFile(join(home, ".bashrc"), "utf8")).toBe(bashrc);
      expect(stripRcLines(bashrc).text).toBe("alias x=y\n");
    } finally {
      rel.close();
    }
  }, 60000);

  it("refuses to run as root without --allow-root", async () => {
    if (process.getuid?.() !== 0) return; // only meaningful in root CI containers
    const r = await runInstaller(["--no-setup"], { PATH: "/usr/bin:/bin", HOME: tmpdir() });
    expect(r.code).toBe(1);
    expect(r.out).toContain("--allow-root");
  });
});
