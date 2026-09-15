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
 * A `consensus` binary on PATH is preferred; otherwise the absolute path of
 * this very install (works for a git checkout and for npx caches alike).
 */
export declare function mcpLaunchCommand(opts?: {
    absolute?: boolean;
}): string[];
export declare function listHosts(): Host[];
/** Make sure `.consensus/` (saved debates contain verbatim prompts and context) is ignored. */
export declare function ensureGitignore(cwd?: string): Promise<string | undefined>;
/** Project-level install: files that travel with the repo. */
export declare function installProjectSkills(cwd?: string): Promise<string[]>;
/** Project-level MCP config: .mcp.json (Claude Code) and .cursor/mcp.json. */
export declare function installProjectMcp(cwd?: string): Promise<string[]>;
