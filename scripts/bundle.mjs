#!/usr/bin/env node
// Bundles the CLI and every dependency into one ESM file for the standalone
// release archives (see docs/design/one-paste-installer.md, option a1).
//
//   node scripts/bundle.mjs            -> build/
//
// Layout (relative lookups in src/ keep working unchanged):
//
//   build/
//     VERSION
//     package.json        name + version only (cli.ts / mcp.ts read ../package.json)
//     app/cli.mjs         src/cli.ts + all node_modules, ESM, target node22
//     app/build-info.json commit + build time (cli.ts reads ./build-info.json)
//     packs/*.json        shipped packs (cli.ts reads ../packs/<name>.json)
//     suites/*.json       sample bench suites
//     docs/*.md  README.md  PACKS.md  LICENSE
import { build } from "esbuild";
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, process.argv[2] ?? "build");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "app"), { recursive: true });

await build({
  entryPoints: [join(root, "src", "cli.ts")],
  outfile: join(out, "app", "cli.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "none",
  logLevel: "warning",
  // Some bundled CommonJS dependencies call require() on node builtins; ESM has no
  // require, so give the bundle one. The alias avoids clashing with the
  // `const require = createRequire(...)` locals that cli.ts and mcp.ts declare.
  banner: {
    js: [
      `import { createRequire as __consensusCreateRequire } from "node:module";`,
      `const require = __consensusCreateRequire(import.meta.url);`,
    ].join("\n"),
  },
});

let commit = process.env.GITHUB_SHA?.slice(0, 7) ?? "";
try {
  commit ||= execSync("git rev-parse --short HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
} catch {
  /* not a git checkout */
}
writeFileSync(join(out, "app", "build-info.json"), JSON.stringify({ commit: commit || "unknown", builtAt: new Date().toISOString() }) + "\n");
writeFileSync(join(out, "package.json"), JSON.stringify({ name: pkg.name, version: pkg.version, type: "module", private: true }, null, 2) + "\n");
writeFileSync(join(out, "VERSION"), pkg.version + "\n");

for (const dir of ["packs", "suites"]) {
  if (existsSync(join(root, dir))) cpSync(join(root, dir), join(out, dir), { recursive: true });
}
mkdirSync(join(out, "docs"), { recursive: true });
for (const f of readdirSync(join(root, "docs")).filter((x) => x.endsWith(".md"))) cpSync(join(root, "docs", f), join(out, "docs", f));
for (const f of ["README.md", "PACKS.md", "LICENSE"]) if (existsSync(join(root, f))) cpSync(join(root, f), join(out, f));

console.log(`bundled consensus ${pkg.version} -> ${join(out, "app", "cli.mjs")}`);
