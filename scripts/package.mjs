#!/usr/bin/env node
// Assembles a self-contained release archive: official Node runtime + bundled app + launcher.
//
//   node scripts/bundle.mjs                       # once: builds build/
//   node scripts/package.mjs darwin arm64         # -> dist-release/consensus-darwin-arm64.tar.gz
//   node scripts/package.mjs win x64              # -> dist-release/consensus-win-x64.zip
//   node scripts/package.mjs sums                 # -> dist-release/SHA256SUMS over every archive
//
// Platforms: darwin | linux | win.  Arches: x64 | arm64.
// Env: NODE_VERSION=v22.x.y pins the runtime (default: newest Node 22 release on nodejs.org).
//      NODE_DIST=https://nodejs.org/dist (mirror).
//
// The Node download is verified against the release's SHASUMS256.txt before use.
//
// Archive layout (one top-level directory, everything relative):
//   consensus/
//     VERSION  package.json  README.md  LICENSE  PACKS.md  docs/  packs/  suites/
//     app/cli.mjs  app/build-info.json
//     bin/consensus            POSIX sh launcher (unix)
//     bin/consensus.cmd        cmd launcher (win), bin/consensus.ps1
//     node/bin/node            (unix)   node/node.exe (win)
//     node/LICENSE  node/VERSION
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist-release");
const cacheDir = join(outDir, ".cache");
const buildDir = join(root, "build");
const NODE_DIST = (process.env.NODE_DIST ?? "https://nodejs.org/dist").replace(/\/$/, "");
const NODE_MAJOR = "22";

const sha256File = (file) =>
  new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
  });

async function fetchOk(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res;
    } catch (err) {
      if (attempt >= 3) throw new Error(`download failed: ${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

async function writeSums() {
  const files = readdirSync(outDir).filter((f) => /^consensus-.*\.(tar\.gz|zip)$/.test(f)).sort();
  if (!files.length) throw new Error("no archives in dist-release/ (run package.mjs <platform> <arch> first)");
  const lines = [];
  for (const f of files) lines.push(`${await sha256File(join(outDir, f))}  ${f}`);
  writeFileSync(join(outDir, "SHA256SUMS"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
}

async function resolveNodeVersion() {
  if (process.env.NODE_VERSION) return process.env.NODE_VERSION.startsWith("v") ? process.env.NODE_VERSION : `v${process.env.NODE_VERSION}`;
  const index = await (await fetchOk(`${NODE_DIST}/index.json`)).json();
  const hit = index.find((r) => r.version.startsWith(`v${NODE_MAJOR}.`) && r.lts);
  if (!hit) throw new Error(`no Node ${NODE_MAJOR} LTS in ${NODE_DIST}/index.json`);
  return hit.version;
}

async function downloadNode(version, platform, arch) {
  const nodePlatform = platform === "win" ? "win" : platform;
  const base = `node-${version}-${nodePlatform}-${arch}`;
  const file = platform === "win" ? `${base}.zip` : `${base}.tar.gz`;
  mkdirSync(cacheDir, { recursive: true });
  const sumsText = await (await fetchOk(`${NODE_DIST}/${version}/SHASUMS256.txt`)).text();
  const expected = sumsText.split("\n").map((l) => l.trim().split(/\s+/)).find(([, name]) => name === file)?.[0];
  if (!expected) throw new Error(`${file} is not listed in ${NODE_DIST}/${version}/SHASUMS256.txt`);
  const local = join(cacheDir, file);
  if (!existsSync(local) || (await sha256File(local)) !== expected) {
    console.log(`downloading ${NODE_DIST}/${version}/${file}`);
    const res = await fetchOk(`${NODE_DIST}/${version}/${file}`);
    writeFileSync(local, Buffer.from(await res.arrayBuffer()));
  }
  const actual = await sha256File(local);
  if (actual !== expected) {
    rmSync(local, { force: true });
    throw new Error(`checksum mismatch for ${file}: expected ${expected}, got ${actual}`);
  }
  console.log(`verified ${file} sha256 ${actual} (SHASUMS256.txt)`);
  return { local, base };
}

const SH_LAUNCHER = `#!/bin/sh
# consensus launcher: runs the bundled CLI with the bundled Node. Relocatable;
# follows symlinks (e.g. ~/.local/bin/consensus -> ~/.consensus/current/bin/consensus).
self=$0
while [ -h "$self" ]; do
  link=$(readlink "$self")
  case $link in
    /*) self=$link ;;
    *) self=$(dirname -- "$self")/$link ;;
  esac
done
here=$(CDPATH= cd -- "$(dirname -- "$self")/.." && pwd -P)
CONSENSUS_HOME=$here
export CONSENSUS_HOME
exec "$here/node/bin/node" --no-warnings=ExperimentalWarning "$here/app/cli.mjs" "$@"
`;

const CMD_LAUNCHER = `@echo off\r
rem consensus launcher: runs the bundled CLI with the bundled Node. Relocatable.\r
setlocal\r
set "CONSENSUS_HOME=%~dp0.."\r
"%~dp0..\\node\\node.exe" --no-warnings=ExperimentalWarning "%~dp0..\\app\\cli.mjs" %*\r
exit /b %ERRORLEVEL%\r
`;

const PS1_LAUNCHER = `# consensus launcher: runs the bundled CLI with the bundled Node. Relocatable.\r
$here = Split-Path -Parent $PSScriptRoot\r
$env:CONSENSUS_HOME = $here\r
& (Join-Path $here 'node\\node.exe') --no-warnings=ExperimentalWarning (Join-Path $here 'app\\cli.mjs') @args\r
exit $LASTEXITCODE\r
`;

async function packageTarget(platform, arch) {
  if (!["darwin", "linux", "win"].includes(platform) || !["x64", "arm64"].includes(arch)) {
    throw new Error(`unsupported target ${platform}-${arch} (platforms: darwin linux win; arches: x64 arm64)`);
  }
  if (!existsSync(join(buildDir, "app", "cli.mjs"))) throw new Error("build/app/cli.mjs missing: run node scripts/bundle.mjs first");
  const version = await resolveNodeVersion();
  const { local, base } = await downloadNode(version, platform, arch);
  const target = `${platform}-${arch}`;
  const stage = join(outDir, "stage", target);
  const app = join(stage, "consensus");
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(join(app, "bin"), { recursive: true });
  mkdirSync(join(app, "node"), { recursive: true });
  cpSync(buildDir, app, { recursive: true });

  const tmp = join(stage, "node-extract");
  mkdirSync(tmp, { recursive: true });
  if (platform === "win") {
    const members = [`${base}/node.exe`, `${base}/LICENSE`];
    try {
      execFileSync("unzip", ["-q", "-o", local, ...members, "-d", tmp], { stdio: "inherit" });
    } catch {
      execFileSync("tar", ["-xf", local, "-C", tmp, ...members], { stdio: "inherit" });
    }
    cpSync(join(tmp, base, "node.exe"), join(app, "node", "node.exe"));
    writeFileSync(join(app, "bin", "consensus.cmd"), CMD_LAUNCHER);
    writeFileSync(join(app, "bin", "consensus.ps1"), PS1_LAUNCHER);
  } else {
    execFileSync("tar", ["-xzf", local, "-C", tmp, `${base}/bin/node`, `${base}/LICENSE`], { stdio: "inherit" });
    mkdirSync(join(app, "node", "bin"), { recursive: true });
    cpSync(join(tmp, base, "bin", "node"), join(app, "node", "bin", "node"));
    chmodSync(join(app, "node", "bin", "node"), 0o755);
    writeFileSync(join(app, "bin", "consensus"), SH_LAUNCHER);
    chmodSync(join(app, "bin", "consensus"), 0o755);
  }
  cpSync(join(tmp, base, "LICENSE"), join(app, "node", "LICENSE"));
  writeFileSync(join(app, "node", "VERSION"), version.replace(/^v/, "") + "\n");
  rmSync(tmp, { recursive: true, force: true });

  mkdirSync(outDir, { recursive: true });
  const env = { ...process.env, COPYFILE_DISABLE: "1" };
  let archive;
  if (platform === "win") {
    archive = join(outDir, `consensus-${target}.zip`);
    rmSync(archive, { force: true });
    execFileSync("zip", ["-q", "-r", "-X", archive, "consensus"], { cwd: stage, stdio: "inherit", env });
  } else {
    archive = join(outDir, `consensus-${target}.tar.gz`);
    rmSync(archive, { force: true });
    const bsd = process.platform === "darwin" ? ["--no-mac-metadata", "--no-xattrs"] : [];
    execFileSync("tar", [...bsd, "-czf", archive, "-C", stage, "consensus"], { stdio: "inherit", env });
  }
  const appVersion = readFileSync(join(app, "VERSION"), "utf8").trim();
  console.log(`packaged consensus ${appVersion} + node ${version} -> ${archive}`);
}

const [a, b] = process.argv.slice(2);
try {
  if (a === "sums") await writeSums();
  else if (a && b) await packageTarget(a, b);
  else {
    console.error("usage: node scripts/package.mjs <darwin|linux|win> <x64|arm64>\n       node scripts/package.mjs sums");
    process.exit(2);
  }
} catch (err) {
  console.error(`package: ${err.message}`);
  process.exit(1);
}
