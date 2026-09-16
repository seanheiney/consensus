import { type Preset } from "./catalog.js";
import { type Member, type Profile } from "./config.js";
import type { VendorStatus } from "./doctor.js";
/** Materialize one preset against the connected vendors; undefined if it can't be satisfied. */
export declare function materializePreset(preset: Preset, statuses: VendorStatus[]): Profile | undefined;
/** Every preset your connections can satisfy. Judges rotate across seats so no vendor is always the judge. */
export declare function starterProfiles(statuses: VendorStatus[]): Record<string, Profile>;
/** Walk the user through building a profile. `existing` pre-fills the editor. */
export declare function editProfile(statuses: VendorStatus[], existing?: Profile, name?: string): Promise<{
    name: string;
    profile: Profile;
}>;
export declare function memberLabel(m: Member): string;
export declare function describeProfile(name: string, prof: Profile, active: boolean): string;
