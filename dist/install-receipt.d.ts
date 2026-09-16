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
export type InstallKind = "standalone" | "archive" | "npm" | "source";
/** Where the installers put versions: $CONSENSUS_ROOT, else ~/.consensus (%LOCALAPPDATA%\consensus on Windows). */
export declare function defaultInstallRoot(env?: NodeJS.ProcessEnv): string;
/** The install root this process was launched from, when it runs from <root>/versions/<version>. */
export declare function runningRoot(env?: NodeJS.ProcessEnv): string | undefined;
export declare function readReceipt(root: string): InstallReceipt | undefined;
/** The receipt of the install this process runs from, or else of the default location. */
export declare function findReceipt(env?: NodeJS.ProcessEnv): {
    root: string;
    receipt?: InstallReceipt;
} | undefined;
export declare function installKind(env?: NodeJS.ProcessEnv, selfPath?: string): InstallKind;
/**
 * Stable launcher for MCP hosts when running from the standalone install:
 * the receipt's link (~/.local/bin/consensus) if it still exists, else
 * <root>/current/bin/consensus. Both survive upgrades and Node version managers,
 * unlike process.execPath. Undefined when not running standalone.
 */
export declare function standaloneLauncher(env?: NodeJS.ProcessEnv): string | undefined;
/** The exact line install.sh appends: `. "$HOME/.consensus/env"  # consensus`. */
export declare function rcLine(envRef: string): string;
export declare function isConsensusRcLine(line: string): boolean;
/** Append the guarded line unless an identical one exists (mirrors install.sh). */
export declare function addRcLine(text: string, envRef: string): {
    text: string;
    added: boolean;
};
/** Remove only the lines the installer added; everything else is byte-for-byte kept. */
export declare function stripRcLines(text: string): {
    text: string;
    removed: number;
};
/** Rc files an install may have touched: the receipt's list plus every file install.sh considers. */
export declare function candidateRcFiles(receipt: InstallReceipt | undefined, env?: NodeJS.ProcessEnv): string[];
/**
 * Remove the standalone install: launcher link, rc lines, fish drop-in, versions,
 * env files and receipt. Anything else under the root (e.g. runs saved by running
 * consensus in your home directory) is kept, and the root is removed only if empty.
 * Returns one human-readable line per thing removed.
 */
export declare function uninstallStandalone(env?: NodeJS.ProcessEnv): Promise<string[]>;
