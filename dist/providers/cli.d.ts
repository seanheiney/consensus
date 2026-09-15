import type { ChatMessage, Effort, Panelist } from "../types.js";
/** A single headless call is killed after this long unless the caller overrides it. */
export declare const DEFAULT_TIMEOUT_MS: number;
export interface RunResult {
    stdout: string;
    stderr: string;
    code: number | null;
}
export declare function runCommand(bin: string, args: string[], opts?: {
    stdin?: string;
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
}): Promise<RunResult>;
/** Single-turn CLIs get the conversation flattened into one prompt. */
export declare function flattenMessages(messages: ChatMessage[]): string;
export interface CliPanelistOptions {
    model?: string;
    effort?: Effort;
    /** Override the binary path. */
    bin?: string;
    timeoutMs?: number;
}
export declare function createClaudeCliPanelist(opts?: CliPanelistOptions): Panelist;
export declare function createCodexCliPanelist(opts?: CliPanelistOptions): Panelist;
export declare function createGeminiCliPanelist(opts?: CliPanelistOptions): Panelist;
export declare function createGrokCliPanelist(opts?: CliPanelistOptions): Panelist;
