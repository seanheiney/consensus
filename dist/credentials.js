import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
export function configDir() {
    return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "consensus");
}
export function credentialsPath() {
    return join(configDir(), "credentials.json");
}
let cached;
export async function readCredentials() {
    try {
        return JSON.parse(await readFile(credentialsPath(), "utf8"));
    }
    catch {
        return {};
    }
}
/**
 * Load keys saved by `consensus setup` into an in-process cache. They are NOT
 * exported to process.env: vendor CLIs spawned as subscription seats must not
 * see other vendors' keys, and a saved ANTHROPIC_API_KEY must not silently
 * switch Claude Code from your subscription to per-token billing.
 */
export async function loadCredentials() {
    cached = await readCredentials();
    return cached;
}
/** @deprecated keys are no longer exported to process.env; use loadCredentials + credentialEnv. */
export const loadCredentialsIntoEnv = loadCredentials;
/** A read-only view of the environment with stored keys filled in where the shell has none. */
export function credentialEnv(env = process.env) {
    const out = { ...env };
    for (const [k, v] of Object.entries(cached ?? {}))
        if (!out[k] && v)
            out[k] = v;
    return out;
}
export async function saveCredential(key, value) {
    const path = credentialsPath();
    const current = await readCredentials();
    current[key] = value;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(current, null, 2) + "\n", { mode: 0o600 });
    await chmod(path, 0o600);
    cached = current;
    return path;
}
export async function deleteCredential(key) {
    const current = await readCredentials();
    delete current[key];
    await writeFile(credentialsPath(), JSON.stringify(current, null, 2) + "\n", { mode: 0o600 });
    cached = current;
}
