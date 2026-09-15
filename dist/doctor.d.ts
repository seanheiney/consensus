import { type Vendor } from "./providers/index.js";
import type { Panelist } from "./types.js";
export interface CliStatus {
    name: string;
    bin: string;
    installed: boolean;
    loggedIn: boolean;
    /** False when login was inferred from files rather than confirmed by the CLI. */
    verified: boolean;
    detail: string;
    /** CLI version when known (used for model compatibility checks). */
    version?: string;
}
export interface VendorStatus {
    vendor: Vendor;
    label: string;
    /** Absent for key-only vendors such as OpenRouter. */
    cli?: CliStatus;
    apiProvider: string;
    apiKey: boolean;
    connected: boolean;
    via?: "cli" | "api";
    /** Spec to use for this vendor (CLI preferred). */
    spec?: string;
}
export declare function cliStatus(name: string, env?: NodeJS.ProcessEnv): Promise<CliStatus>;
export declare function scanVendors(env?: NodeJS.ProcessEnv): Promise<VendorStatus[]>;
export interface ProbeResult {
    id: string;
    ok: boolean;
    ms: number;
    sample?: string;
    error?: string;
}
/** Make one tiny real call through a panelist. */
export declare function probe(panelist: Panelist, timeoutMs?: number): Promise<ProbeResult>;
export declare function probeSpecs(specs: string[], env?: NodeJS.ProcessEnv): Promise<ProbeResult[]>;
/**
 * Check every seat's route before spending anything: CLI logged in, key
 * present, model driveable by the installed CLI. Returns one line per problem.
 */
export declare function preflight(panel: Panelist[], statuses: VendorStatus[], env?: NodeJS.ProcessEnv): string[];
