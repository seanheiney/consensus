import { type Config } from "./config.js";
import { type VendorStatus } from "./doctor.js";
export interface SummaryInput {
    statuses: VendorStatus[];
    cfg: Config;
    cfgPath: string;
    wired: string[];
    mcpCommand: string[];
    ready: boolean;
    env?: NodeJS.ProcessEnv;
}
/** The end-of-setup "what happened" screen: every row is something setup or the installer actually did. */
export declare function setupSummary(i: SummaryInput): string;
export declare function statusLine(s: VendorStatus): string;
/** No browser to open: SSH sessions and Linux without a display. */
export declare function isHeadless(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): boolean;
/** The login command for a vendor CLI, switched to device-code auth when no browser can open. */
export declare function loginArgs(cli: string, loginCommand: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): string[];
/** Default choice when connecting a vendor: log in if its CLI is already there, otherwise paste a key. Installing a CLI is never the default. */
export declare function defaultConnectChoice(s: Pick<VendorStatus, "cli">): "login" | "key";
export declare function connectVendor(s: VendorStatus): Promise<void>;
export interface SetupOptions {
    yes?: boolean;
    project?: boolean;
    probe?: boolean;
    /** Skip the guided first debate (default: run it, also under --yes). */
    firstRun?: boolean;
}
export declare function runSetup(o?: SetupOptions): Promise<void>;
