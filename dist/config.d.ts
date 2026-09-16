import { z } from "zod";
import type { Effort, Panelist } from "./types.js";
import type { VendorStatus } from "./doctor.js";
/**
 * A panel member: a model spec string `provider[:model][#effort][+persona]`,
 * or an object with an explicit persona (a library name or inline prompt text).
 */
export declare const MemberSchema: z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
    model: z.ZodString;
    persona: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
}, z.core.$strip>]>;
export type Member = z.infer<typeof MemberSchema>;
export declare const ProfileSchema: z.ZodObject<{
    description: z.ZodOptional<z.ZodString>;
    panel: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
        model: z.ZodString;
        persona: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>]>>;
    judge: z.ZodOptional<z.ZodString>;
    captain: z.ZodOptional<z.ZodString>;
    rounds: z.ZodOptional<z.ZodNumber>;
    effort: z.ZodOptional<z.ZodEnum<{
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        xhigh: "xhigh";
    }>>;
    personas: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    substitutions: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type Profile = z.infer<typeof ProfileSchema>;
export declare const ConfigSchema: z.ZodObject<{
    profile: z.ZodOptional<z.ZodString>;
    profiles: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        description: z.ZodOptional<z.ZodString>;
        panel: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
            model: z.ZodString;
            persona: z.ZodOptional<z.ZodString>;
            name: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>]>>;
        judge: z.ZodOptional<z.ZodString>;
        captain: z.ZodOptional<z.ZodString>;
        rounds: z.ZodOptional<z.ZodNumber>;
        effort: z.ZodOptional<z.ZodEnum<{
            high: "high";
            low: "low";
            max: "max";
            medium: "medium";
            xhigh: "xhigh";
        }>>;
        personas: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        substitutions: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>>;
    personas: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    packs: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        source: z.ZodString;
        version: z.ZodOptional<z.ZodString>;
        installedAt: z.ZodString;
        profiles: z.ZodArray<z.ZodString>;
        personas: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>>;
    panel: z.ZodOptional<z.ZodArray<z.ZodString>>;
    judge: z.ZodOptional<z.ZodString>;
    captain: z.ZodOptional<z.ZodString>;
    rounds: z.ZodOptional<z.ZodNumber>;
    effort: z.ZodOptional<z.ZodEnum<{
        high: "high";
        low: "low";
        max: "max";
        medium: "medium";
        xhigh: "xhigh";
    }>>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    maxCostUsd: z.ZodOptional<z.ZodNumber>;
    maxSpendUsd: z.ZodOptional<z.ZodNumber>;
    runsDir: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type Config = z.infer<typeof ConfigSchema>;
export declare const CONFIG_FILENAMES: string[];
export declare function userConfigPath(): string;
/** Problems found in a config file that were skipped rather than fatal. */
export declare const configWarnings: string[];
/**
 * Parse a config leniently: a broken profile is dropped with a one-line warning
 * instead of taking every command down with a schema dump.
 */
export declare function parseConfigLenient(raw: unknown, source: string): Config;
export declare function loadUserConfig(): Promise<Config>;
export declare function saveUserConfig(cfg: Config): Promise<string>;
/** Project config (cwd) overrides user config; profiles merge by name. */
export declare function loadConfig(cwd?: string): Promise<Config>;
export interface ResolveOptions {
    cfg: Config;
    /** Explicit panel members (highest priority). */
    panel?: Member[];
    profile?: string;
    judge?: string;
    /** Captain spec, "auto" or "none"; default from the profile, else "auto". */
    captain?: string;
    rounds?: number;
    effort?: Effort;
    env?: NodeJS.ProcessEnv;
}
export interface ResolvedRun {
    panel: Panelist[];
    judge: Panelist;
    captain?: Panelist;
    rounds: number;
    effort: Effort;
    profile?: string;
    source: "flags" | "profile" | "config" | "auto";
}
/** Split `spec+persona` into the model spec and the persona reference. */
export declare function splitMember(member: Member): {
    spec: string;
    persona?: string;
    name?: string;
};
/** Stable id for a member, e.g. "claude:claude-opus-5+skeptic". */
export declare function memberId(member: Member): string;
export declare function buildPanel(members: Member[], defaultEffort: Effort | undefined, judgeSpec: string | undefined, env: NodeJS.ProcessEnv, personaLibrary?: Record<string, string>): {
    panel: Panelist[];
    judge: Panelist;
};
/**
 * The captain: the best model available, preferring a vendor that is NOT on the
 * panel (neutral), then a different model of a vendor that is, then the strongest
 * seatable model even if a seat uses it (it runs under the captain's own prompt).
 */
export declare function autoCaptain(members: Member[], statuses: VendorStatus[]): Promise<string>;
/**
 * Pick a judge that did not debate: the strongest seatable model of a vendor
 * that is NOT on the panel; failing that, a different model of a vendor that is.
 */
export declare function autoExternalJudge(members: Member[], statuses: VendorStatus[]): Promise<string>;
/**
 * Turn portable `any:<model>` members into concrete specs for this machine:
 * the vendor's logged-in CLI, else its API key, else OpenRouter. Fails loudly
 * when a seat cannot be satisfied instead of silently shrinking the panel.
 */
export declare function resolvePortableMembers(members: Member[], statuses: VendorStatus[]): Member[];
/**
 * Decide who sits on the panel.
 * Priority: --panel flags > --profile / active profile > flat config > auto-detect.
 * Auto-detect prefers a logged-in vendor CLI (subscription) over that vendor's API key.
 */
export declare function resolveRun(o: ResolveOptions): Promise<ResolvedRun>;
/**
 * One spec per reachable vendor: its logged-in CLI, else its API key, else
 * the vendor's default model through OpenRouter. Frontier tier by default.
 */
export declare function autoDetectSpecs(env?: NodeJS.ProcessEnv): Promise<string[]>;
