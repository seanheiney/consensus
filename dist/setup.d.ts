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
export declare function connectVendor(s: VendorStatus): Promise<void>;
export interface SetupOptions {
    yes?: boolean;
    project?: boolean;
    probe?: boolean;
    /** Skip the guided first debate (default: run it, also under --yes). */
    firstRun?: boolean;
}
export declare function runSetup(o?: SetupOptions): Promise<void>;
