import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ensureGitignore } from "./hosts.js";
import { isAbsolute, relative, resolve, dirname as pdirname, sep } from "node:path";

export function findGitRoot(from = process.cwd()): string | undefined {
  let d = resolve(from);
  for (;;) {
    if (existsSync(join(d, ".git"))) return d;
    const up = pdirname(d);
    if (up === d) return undefined;
    d = up;
  }
}

/**
 * A path as it should be recorded in a committed file: relative to the repo root (or the
 * working directory outside a repo), with forward slashes. Undefined for a file outside it,
 * so a local absolute path never lands in the repo.
 */
export function repoRelativePath(path: string, cwd = process.cwd()): string | undefined {
  const root = findGitRoot(cwd) ?? resolve(cwd);
  const rel = relative(root, resolve(cwd, path));
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return rel.split(sep).join("/");
}

/** Resolve a path recorded by repoRelativePath (older records may hold it as typed). */
export function fromRepoPath(path: string, cwd = process.cwd()): string {
  return isAbsolute(path) ? path : join(findGitRoot(cwd) ?? resolve(cwd), path);
}
import type { ConsensusRun } from "./types.js";
import { renderReport } from "./report.js";

/** Persist a run as JSON + markdown under `<dir>/<run id>/`. Returns the run directory. */
export async function saveRun(run: ConsensusRun, dir = ".consensus/runs"): Promise<string> {
  const runDir = join(dir, run.id);
  await mkdir(runDir, { recursive: true });
  // Saved debates contain verbatim prompts and pasted context: keep them out of git (any repo we are inside).
  if (dir === ".consensus/runs" && findGitRoot()) await ensureGitignore().catch(() => undefined);
  await Promise.all([
    writeFile(join(runDir, "run.json"), JSON.stringify(run, null, 2)),
    writeFile(join(runDir, "report.md"), renderReport(run, { transcript: true })),
  ]);
  return runDir;
}

export interface RunSummary {
  id: string;
  dir: string;
  startedAt: string;
  prompt: string;
  converged: boolean;
  rounds: number;
  panel: string[];
}

/** Saved runs, newest first. */
export async function listRuns(dir = ".consensus/runs"): Promise<RunSummary[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: RunSummary[] = [];
  for (const id of names.sort().reverse()) {
    try {
      const run = JSON.parse(await readFile(join(dir, id, "run.json"), "utf8")) as ConsensusRun;
      out.push({ id, dir: join(dir, id), startedAt: run.startedAt, prompt: run.prompt, converged: run.converged, rounds: run.rounds.length, panel: Object.values(run.labels) });
    } catch {
      /* in-progress or broken run dir */
    }
  }
  return out;
}

/**
 * The newest saved run that answered this exact question with this exact panel,
 * within `maxAgeDays`. Used by `--reuse`; never consulted unless asked.
 */
export async function findReusableRun(key: string, maxAgeDays: number, dir = ".consensus/runs"): Promise<{ run: ConsensusRun; dir: string; ageDays: number } | undefined> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return undefined;
  }
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  for (const id of names.sort().reverse()) {
    try {
      const run = JSON.parse(await readFile(join(dir, id, "run.json"), "utf8")) as ConsensusRun;
      if (run.key !== key || !run.synthesis) continue;
      const when = Date.parse(run.finishedAt ?? run.startedAt);
      if (!Number.isFinite(when) || when < cutoff) continue;
      return { run, dir: join(dir, id), ageDays: (Date.now() - when) / 86_400_000 };
    } catch {
      /* in-progress or broken run dir */
    }
  }
  return undefined;
}

/** Load one run by id, or the latest when id is "latest" / omitted. */
export async function loadRun(id: string | undefined, dir = ".consensus/runs"): Promise<{ run: ConsensusRun; dir: string }> {
  let target = id;
  if (!target || target === "latest") {
    const runs = await listRuns(dir);
    if (!runs.length) throw new Error(`No saved runs in ${dir}`);
    target = runs[0]!.id;
  }
  const runDir = join(dir, target);
  const run = JSON.parse(await readFile(join(runDir, "run.json"), "utf8")) as ConsensusRun;
  return { run, dir: runDir };
}

/** Very small markdown-to-HTML for a self-contained shareable debate page (no external assets). */
export function markdownToHtml(md: string): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = md.split("\n");
  const out: string[] = [];
  let inCode = false;
  let inList = false;
  let inTable = false;
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  const closeTable = () => { if (inTable) { out.push("</table>"); inTable = false; } };
  const inline = (t: string) => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>").replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");
  for (const raw of lines) {
    if (raw.startsWith("```")) { closeList(); closeTable(); out.push(inCode ? "</code></pre>" : "<pre><code>"); inCode = !inCode; continue; }
    if (inCode) { out.push(esc(raw)); continue; }
    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); closeTable(); out.push(`<h${h[1]!.length}>${inline(h[2]!)}</h${h[1]!.length}>`); continue; }
    if (/^\s*[-*]\s+/.test(raw)) { closeTable(); if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${inline(raw.replace(/^\s*[-*]\s+/, ""))}</li>`); continue; }
    if (/^\|.*\|\s*$/.test(raw)) { closeList(); if (/^\|[\s:|-]+\|\s*$/.test(raw)) continue; const first = !inTable; if (!inTable) { out.push("<table>"); inTable = true; } const tag = first ? "th" : "td"; out.push("<tr>" + raw.slice(1, -1).split("|").map((c) => `<${tag}>${inline(c.trim())}</${tag}>`).join("") + "</tr>"); continue; }
    if (raw.trim() === "---") { closeList(); closeTable(); out.push("<hr>"); continue; }
    if (raw.startsWith("<details") || raw.startsWith("</details") || raw.startsWith("<summary")) { out.push(raw); continue; }
    if (!raw.trim()) { closeList(); closeTable(); continue; }
    closeList(); closeTable(); out.push(`<p>${inline(raw)}</p>`);
  }
  closeList(); closeTable();
  return out.join("\n");
}

export function renderRunHtml(run: ConsensusRun): string {
  const body = markdownToHtml(renderReport(run, { transcript: true }));
  const title = `consensus: ${run.prompt.replace(/\s+/g, " ").slice(0, 80)}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title.replace(/</g, "&lt;")}</title>
<style>body{max-width:52rem;margin:2rem auto;padding:0 1rem;font:16px/1.55 system-ui,sans-serif;color:#1a1a1a;background:#fff}h1,h2,h3,h4{line-height:1.25}h1{font-size:1.7rem}h2{margin-top:2.2rem;border-bottom:1px solid #ddd;padding-bottom:.25rem}pre{background:#f4f4f4;padding:.75rem;overflow-x:auto;border-radius:6px}code{font:0.92em ui-monospace,monospace}table{border-collapse:collapse;margin:1rem 0}td{border:1px solid #ddd;padding:.3rem .6rem}hr{border:0;border-top:1px solid #ddd;margin:2rem 0}details{margin:.5rem 0 1rem;padding:.5rem .75rem;background:#fafafa;border:1px solid #e5e5e5;border-radius:6px}summary{cursor:pointer}@media (prefers-color-scheme:dark){body{background:#111;color:#e8e8e8}pre,details{background:#1c1c1c;border-color:#333}td,h2,hr{border-color:#333}}</style></head><body>
<p><small>Generated by consensus · run ${run.id} · ${run.startedAt}</small></p>
${body}
</body></html>`;
}
