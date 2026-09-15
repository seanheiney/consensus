export declare function configDir(): string;
export declare function credentialsPath(): string;
export declare function readCredentials(): Promise<Record<string, string>>;
/**
 * Load keys saved by `consensus setup` into an in-process cache. They are NOT
 * exported to process.env: vendor CLIs spawned as subscription seats must not
 * see other vendors' keys, and a saved ANTHROPIC_API_KEY must not silently
 * switch Claude Code from your subscription to per-token billing.
 */
export declare function loadCredentials(): Promise<Record<string, string>>;
/** @deprecated keys are no longer exported to process.env; use loadCredentials + credentialEnv. */
export declare const loadCredentialsIntoEnv: typeof loadCredentials;
/** A read-only view of the environment with stored keys filled in where the shell has none. */
export declare function credentialEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export declare function saveCredential(key: string, value: string): Promise<string>;
export declare function deleteCredential(key: string): Promise<void>;
