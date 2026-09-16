export interface Host {
    id: string;
    name: string;
    detected: boolean;
    /** Whether consensus's MCP entry / skill are present in this host's config. */
    installed?: () => {
        mcp?: boolean;
        skill?: boolean;
    };
    /** Register the MCP server; returns a one-line description of what was done. */
    installMcp?: (cmd: string[]) => Promise<string>;
    /** Install the skill pack; returns the paths written. */
    installSkill?: () => Promise<string[]>;
    /** Remove everything consensus installed into this host; returns what was removed. */
    uninstall?: () => Promise<string[]>;
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
export declare function mcpLaunchCommand(opts?: {
    absolute?: boolean;
    portable?: boolean;
    env?: NodeJS.ProcessEnv;
}): string[];
export declare function listHosts(): Host[];
/** Make sure `.consensus/` (saved debates contain verbatim prompts and context) is ignored. */
export declare function ensureGitignore(cwd?: string): Promise<string | undefined>;
/** Project-level install: files that travel with the repo. */
export declare function installProjectSkills(cwd?: string): Promise<string[]>;
/** Project-level MCP config: .mcp.json (Claude Code) and .cursor/mcp.json. */
export declare function installProjectMcp(cwd?: string): Promise<string[]>;
