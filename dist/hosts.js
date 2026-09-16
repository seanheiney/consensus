/**
 * Agent hosts (IDEs and local agent environments) that can be taught about
 * consensus: where their MCP config lives and where they read skills from.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./providers/cli.js";
import { onPath } from "./providers/index.js";
import { CURSOR_RULE, RULES_BLOCK, SKILL_MD, SKILL_NAME, removeBlock, upsertBlock, writeSkill } from "./skillpack.js";
import { rm } from "node:fs/promises";
import { standaloneLauncher } from "./install-receipt.js";
async function removeMcpJson(file) {
    let cfg;
    try {
        cfg = JSON.parse(await readFile(file, "utf8"));
    }
    catch {
        return undefined;
    }
    const servers = cfg.mcpServers;
    if (!servers || !(SKILL_NAME in servers))
        return undefined;
    delete servers[SKILL_NAME];
    await writeFile(file, JSON.stringify(cfg, null, 2) + "\n");
    return `${file}: removed mcpServers.${SKILL_NAME}`;
}
async function rmSkill(dir) {
    if (!existsSync(dir))
        return undefined;
    await rm(dir, { recursive: true, force: true });
    // Drop the now-empty skills folder too, so uninstall leaves no trace.
    try {
        const { readdir, rmdir } = await import("node:fs/promises");
        if ((await readdir(dirname(dir))).length === 0)
            await rmdir(dirname(dir));
    }
    catch {
        /* keep */
    }
    return `removed ${dir}`;
}
async function viaCliRemove(bin, args) {
    const r = await runCommand(bin, args).catch(() => undefined);
    return r && r.code === 0 ? `${bin} ${args.slice(0, 2).join(" ")} ok` : undefined;
}
const home = homedir();
function vscodeUserDir() {
    switch (platform()) {
        case "darwin":
            return join(home, "Library", "Application Support", "Code", "User");
        case "win32":
            return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Code", "User");
        default:
            return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "Code", "User");
    }
}
function zedSettingsPath() {
    return platform() === "win32" ? join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Zed", "settings.json") : join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "zed", "settings.json");
}
/** Merge into a JSON file under an arbitrary key (VS Code `servers`, Zed `context_servers`). */
async function mergeJsonKey(file, key, entry) {
    let cfg = {};
    let existing;
    try {
        existing = await readFile(file, "utf8");
    }
    catch {
        await mkdir(dirname(file), { recursive: true });
    }
    if (existing !== undefined && existing.trim()) {
        try {
            cfg = JSON.parse(existing);
        }
        catch (err) {
            throw new Error(`${file} is not plain JSON (${err.message.split("\n")[0]}); not touching it. Add under "${key}": ${JSON.stringify({ [SKILL_NAME]: entry })}`);
        }
        await writeFile(`${file}.bak`, existing);
    }
    const bucket = (cfg[key] ??= {});
    bucket[SKILL_NAME] = entry;
    await writeFile(file, JSON.stringify(cfg, null, 2) + "\n");
    return `wrote ${file}${existing ? ` (backup: ${file}.bak)` : ""}`;
}
async function removeJsonKey(file, key) {
    let cfg;
    try {
        cfg = JSON.parse(await readFile(file, "utf8"));
    }
    catch {
        return undefined;
    }
    const bucket = cfg[key];
    if (!bucket || !(SKILL_NAME in bucket))
        return undefined;
    delete bucket[SKILL_NAME];
    await writeFile(file, JSON.stringify(cfg, null, 2) + "\n");
    return `${file}: removed ${key}.${SKILL_NAME}`;
}
function claudeDesktopConfigPath() {
    switch (platform()) {
        case "darwin":
            return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
        case "win32":
            return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
        default:
            return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "Claude", "claude_desktop_config.json");
    }
}
/**
 * Merge `mcpServers.consensus` into a JSON config file, creating it if missing.
 * Never overwrites a file it cannot parse (comments, trailing commas): that
 * would silently drop the user's other MCP servers.
 */
async function mergeMcpJson(file, cmd) {
    let cfg = {};
    let existing;
    try {
        existing = await readFile(file, "utf8");
    }
    catch {
        await mkdir(dirname(file), { recursive: true });
    }
    if (existing !== undefined && existing.trim()) {
        try {
            cfg = JSON.parse(existing);
        }
        catch (err) {
            throw new Error(`${file} is not plain JSON (${err.message.split("\n")[0]}); not touching it. Add this entry by hand under "mcpServers": ${JSON.stringify({ [SKILL_NAME]: { command: cmd[0], args: cmd.slice(1) } })}`);
        }
        if (typeof cfg !== "object" || cfg === null || Array.isArray(cfg))
            throw new Error(`${file} does not contain a JSON object; not touching it.`);
        await writeFile(`${file}.bak`, existing);
    }
    const servers = (cfg.mcpServers ??= {});
    servers[SKILL_NAME] = { command: cmd[0], args: cmd.slice(1) };
    await writeFile(file, JSON.stringify(cfg, null, 2) + "\n");
    return `wrote ${file}${existing ? ` (backup: ${file}.bak)` : ""}`;
}
/** Register via a vendor CLI: remove any stale entry first, then add. */
async function viaCli(bin, removeArgs, addArgs) {
    await runCommand(bin, removeArgs).catch(() => undefined);
    const res = await runCommand(bin, addArgs);
    if (res.code !== 0)
        throw new Error(`${bin} ${addArgs[0]} ${addArgs[1]} failed: ${(res.stderr || res.stdout).trim().slice(-300)}`);
    return `${bin} ${addArgs.slice(0, 2).join(" ")} ok`;
}
/**
 * The command other tools should launch to start our MCP server.
 *
 * - Standalone install (install.sh / install.ps1): always the absolute stable
 *   launcher (~/.local/bin/consensus, or ~/.consensus/current/bin/consensus).
 *   It survives upgrades, never depends on a versioned Node path, and does not
 *   rely on the host inheriting a shell PATH.
 * - Otherwise a `consensus` binary on PATH is preferred, then the absolute
 *   path of this very install (source checkout, npm global, npx cache).
 *
 * `absolute` is for GUI apps (Cursor, Windsurf, Claude Desktop, VS Code, Zed),
 * which do not inherit a shell PATH. `portable` is for project files
 * (.mcp.json) that get committed and must not contain a home-directory path.
 */
export function mcpLaunchCommand(opts = {}) {
    const env = opts.env ?? process.env;
    const launcher = standaloneLauncher(env);
    if (launcher)
        return opts.portable ? ["consensus", "mcp"] : [launcher, "mcp"];
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/cli.js for tsc builds, app/cli.mjs for the esbuild bundle (this code is inlined into it).
    const cli = [join(here, "cli.js"), join(here, "cli.mjs")].find((f) => existsSync(f));
    // GUI apps (Cursor, Windsurf, Claude Desktop) don't inherit a shell PATH, so
    // they need the node binary and script spelled out.
    if (opts.absolute && cli)
        return [process.execPath, cli, "mcp"];
    if (onPath("consensus", env))
        return ["consensus", "mcp"];
    return cli ? [process.execPath, cli, "mcp"] : ["npx", "-y", "consensus-panel", "mcp"];
}
function fileHas(path, needle) {
    try {
        return readFileSync(path, "utf8").includes(needle);
    }
    catch {
        return false;
    }
}
export function listHosts() {
    return [
        {
            id: "claude-code",
            name: "Claude Code",
            detected: onPath("claude") || existsSync(join(home, ".claude")),
            installed: () => ({ mcp: fileHas(join(home, ".claude.json"), `"${SKILL_NAME}"`), skill: existsSync(join(home, ".claude", "skills", SKILL_NAME, "SKILL.md")) }),
            installMcp: (cmd) => viaCli("claude", ["mcp", "remove", "-s", "user", SKILL_NAME], ["mcp", "add", "-s", "user", SKILL_NAME, "--", ...cmd]),
            installSkill: async () => [await writeSkill(join(home, ".claude", "skills", SKILL_NAME))],
            uninstall: async () => [await viaCliRemove("claude", ["mcp", "remove", "-s", "user", SKILL_NAME]), await rmSkill(join(home, ".claude", "skills", SKILL_NAME))].filter((x) => !!x),
        },
        {
            id: "codex",
            name: "Codex CLI",
            detected: onPath("codex") || existsSync(join(home, ".codex")),
            installed: () => ({ mcp: fileHas(join(home, ".codex", "config.toml"), `mcp_servers.${SKILL_NAME}`), skill: existsSync(join(home, ".codex", "skills", SKILL_NAME, "SKILL.md")) }),
            installMcp: (cmd) => viaCli("codex", ["mcp", "remove", SKILL_NAME], ["mcp", "add", SKILL_NAME, "--", ...cmd]),
            installSkill: async () => [await writeSkill(join(home, ".codex", "skills", SKILL_NAME))],
            uninstall: async () => [await viaCliRemove("codex", ["mcp", "remove", SKILL_NAME]), await rmSkill(join(home, ".codex", "skills", SKILL_NAME))].filter((x) => !!x),
        },
        {
            id: "gemini-cli",
            name: "Gemini CLI",
            detected: onPath("gemini") || existsSync(join(home, ".gemini")),
            installed: () => ({ mcp: fileHas(join(home, ".gemini", "settings.json"), `"${SKILL_NAME}"`), skill: existsSync(join(home, ".agents", "skills", SKILL_NAME, "SKILL.md")) }),
            installMcp: (cmd) => viaCli("gemini", ["mcp", "remove", "-s", "user", SKILL_NAME], ["mcp", "add", "-s", "user", SKILL_NAME, ...cmd]),
            // Gemini CLI discovers skills from the cross-tool ~/.agents/skills directory.
            installSkill: async () => [await writeSkill(join(home, ".agents", "skills", SKILL_NAME))],
            uninstall: async () => [await viaCliRemove("gemini", ["mcp", "remove", "-s", "user", SKILL_NAME])].filter((x) => !!x),
        },
        {
            id: "grok",
            name: "Grok CLI",
            detected: onPath("grok") || existsSync(join(home, ".grok")),
            installed: () => ({ mcp: fileHas(join(home, ".grok", "config.toml"), SKILL_NAME) || fileHas(join(home, ".grok", "mcp.json"), `"${SKILL_NAME}"`), skill: existsSync(join(home, ".grok", "skills", SKILL_NAME, "SKILL.md")) }),
            installMcp: (cmd) => viaCli("grok", ["mcp", "remove", SKILL_NAME], ["mcp", "add", SKILL_NAME, cmd[0], "--", ...cmd.slice(1)]),
            installSkill: async () => [
                await writeSkill(join(home, ".grok", "skills", SKILL_NAME)),
                ...(await upsertBlock(join(home, ".grok", "AGENTS.md"), RULES_BLOCK).then(() => [join(home, ".grok", "AGENTS.md")])),
            ],
            uninstall: async () => [await viaCliRemove("grok", ["mcp", "remove", SKILL_NAME]), await rmSkill(join(home, ".grok", "skills", SKILL_NAME)), (await removeBlock(join(home, ".grok", "AGENTS.md"))) ? `removed block from ${join(home, ".grok", "AGENTS.md")}` : undefined].filter((x) => !!x),
        },
        {
            id: "cursor",
            name: "Cursor",
            detected: existsSync(join(home, ".cursor")),
            installed: () => ({ mcp: fileHas(join(home, ".cursor", "mcp.json"), `"${SKILL_NAME}"`), skill: existsSync(join(home, ".cursor", "skills", SKILL_NAME, "SKILL.md")) }),
            installMcp: () => mergeMcpJson(join(home, ".cursor", "mcp.json"), mcpLaunchCommand({ absolute: true })),
            installSkill: async () => [await writeSkill(join(home, ".cursor", "skills", SKILL_NAME))],
            uninstall: async () => [await removeMcpJson(join(home, ".cursor", "mcp.json")), await rmSkill(join(home, ".cursor", "skills", SKILL_NAME))].filter((x) => !!x),
        },
        {
            id: "windsurf",
            name: "Windsurf",
            detected: existsSync(join(home, ".codeium", "windsurf")),
            installed: () => ({ mcp: fileHas(join(home, ".codeium", "windsurf", "mcp_config.json"), `"${SKILL_NAME}"`), skill: fileHas(join(home, ".codeium", "windsurf", "memories", "global_rules.md"), "consensus:start") }),
            installMcp: () => mergeMcpJson(join(home, ".codeium", "windsurf", "mcp_config.json"), mcpLaunchCommand({ absolute: true })),
            installSkill: async () => {
                const f = join(home, ".codeium", "windsurf", "memories", "global_rules.md");
                await upsertBlock(f, RULES_BLOCK);
                return [f];
            },
            uninstall: async () => [await removeMcpJson(join(home, ".codeium", "windsurf", "mcp_config.json")), (await removeBlock(join(home, ".codeium", "windsurf", "memories", "global_rules.md"))) ? "removed Windsurf rules block" : undefined].filter((x) => !!x),
        },
        {
            id: "claude-desktop",
            name: "Claude Desktop",
            detected: existsSync(claudeDesktopConfigPath()),
            installed: () => ({ mcp: fileHas(claudeDesktopConfigPath(), `"${SKILL_NAME}"`) }),
            installMcp: () => mergeMcpJson(claudeDesktopConfigPath(), mcpLaunchCommand({ absolute: true })),
            uninstall: async () => [await removeMcpJson(claudeDesktopConfigPath())].filter((x) => !!x),
        },
        {
            id: "vscode",
            name: "VS Code (Copilot agent mode)",
            detected: existsSync(vscodeUserDir()),
            installed: () => ({ mcp: fileHas(join(vscodeUserDir(), "mcp.json"), `"${SKILL_NAME}"`), skill: existsSync(join(home, ".agents", "skills", SKILL_NAME, "SKILL.md")) }),
            // User-level MCP servers live in <User>/mcp.json under "servers"; Copilot reads skills from ~/.agents/skills.
            installMcp: () => {
                const cmd = mcpLaunchCommand({ absolute: true });
                return mergeJsonKey(join(vscodeUserDir(), "mcp.json"), "servers", { type: "stdio", command: cmd[0], args: cmd.slice(1) });
            },
            installSkill: async () => [await writeSkill(join(home, ".agents", "skills", SKILL_NAME))],
            uninstall: async () => [await removeJsonKey(join(vscodeUserDir(), "mcp.json"), "servers")].filter((x) => !!x),
        },
        {
            id: "zed",
            name: "Zed",
            detected: existsSync(dirname(zedSettingsPath())),
            installed: () => ({ mcp: fileHas(zedSettingsPath(), `"${SKILL_NAME}"`) }),
            installMcp: () => {
                const cmd = mcpLaunchCommand({ absolute: true });
                return mergeJsonKey(zedSettingsPath(), "context_servers", { source: "custom", command: cmd[0], args: cmd.slice(1) });
            },
            uninstall: async () => [await removeJsonKey(zedSettingsPath(), "context_servers")].filter((x) => !!x),
        },
        {
            id: "agents-standard",
            name: "Any agent reading ~/.agents/skills (Copilot, Cursor, Gemini, Codex...)",
            detected: true,
            installed: () => ({ skill: existsSync(join(home, ".agents", "skills", SKILL_NAME, "SKILL.md")) }),
            installSkill: async () => [await writeSkill(join(home, ".agents", "skills", SKILL_NAME))],
            uninstall: async () => [await rmSkill(join(home, ".agents", "skills", SKILL_NAME))].filter((x) => !!x),
        },
    ];
}
/** Make sure `.consensus/` (saved debates contain verbatim prompts and context) is ignored. */
export async function ensureGitignore(cwd = process.cwd()) {
    const f = join(cwd, ".gitignore");
    let current = "";
    try {
        current = await readFile(f, "utf8");
    }
    catch {
        /* create */
    }
    if (/^\.consensus\/?$/m.test(current))
        return undefined;
    await writeFile(f, current.replace(/\s*$/, current ? "\n" : "") + ".consensus/\n");
    return f;
}
/** Project-level install: files that travel with the repo. */
export async function installProjectSkills(cwd = process.cwd()) {
    const written = [];
    const gi = await ensureGitignore(cwd);
    if (gi)
        written.push(gi);
    written.push(await writeSkill(join(cwd, ".claude", "skills", SKILL_NAME), SKILL_MD));
    written.push(await writeSkill(join(cwd, ".agents", "skills", SKILL_NAME), SKILL_MD));
    const rule = join(cwd, ".cursor", "rules", `${SKILL_NAME}.mdc`);
    await mkdir(dirname(rule), { recursive: true });
    await writeFile(rule, CURSOR_RULE);
    written.push(rule);
    for (const f of ["AGENTS.md", "CLAUDE.md"]) {
        await upsertBlock(join(cwd, f), RULES_BLOCK);
        written.push(join(cwd, f));
    }
    return written;
}
/** Project-level MCP config: .mcp.json (Claude Code) and .cursor/mcp.json. */
export async function installProjectMcp(cwd = process.cwd()) {
    const cmd = mcpLaunchCommand({ portable: true });
    const out = [];
    out.push(await mergeMcpJson(join(cwd, ".mcp.json"), cmd));
    out.push(await mergeMcpJson(join(cwd, ".cursor", "mcp.json"), cmd));
    return out;
}
