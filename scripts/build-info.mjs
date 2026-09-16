// Writes dist/build-info.json so `consensus --version` can say which commit a tarball install came from.
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
let commit = process.env.GITHUB_SHA ?? "";
try { commit ||= execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch {}
mkdirSync("dist", { recursive: true });
writeFileSync("dist/build-info.json", JSON.stringify({ commit: commit || "unknown", builtAt: new Date().toISOString() }) + "\n");
