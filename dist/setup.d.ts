import { type VendorStatus } from "./doctor.js";
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
