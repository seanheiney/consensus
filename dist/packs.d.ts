import { z } from "zod";
import { type Config, type Member } from "./config.js";
export declare const PackSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    name: z.ZodString;
    version: z.ZodDefault<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    author: z.ZodOptional<z.ZodString>;
    homepage: z.ZodOptional<z.ZodString>;
    personas: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    profiles: z.ZodRecord<z.ZodString, z.ZodObject<{
        description: z.ZodOptional<z.ZodString>;
        panel: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
            model: z.ZodString;
            persona: z.ZodOptional<z.ZodString>;
            name: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>]>>;
        judge: z.ZodOptional<z.ZodString>;
        rounds: z.ZodOptional<z.ZodNumber>;
        effort: z.ZodOptional<z.ZodEnum<{
            high: "high";
            low: "low";
            max: "max";
            medium: "medium";
        }>>;
        personas: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        substitutions: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    suite: z.ZodOptional<z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        cases: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            prompt: z.ZodString;
            context: z.ZodOptional<z.ZodString>;
            expected: z.ZodOptional<z.ZodString>;
            rubric: z.ZodOptional<z.ZodString>;
            tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type Pack = z.infer<typeof PackSchema>;
/** Build a pack from profiles in the current config, bundling the personas they reference. */
export declare function createPack(cfg: Config, names: string[], meta: {
    name: string;
    version?: string;
    description?: string;
    author?: string;
}): Pack;
/** Rewrite a concrete seat to its portable form when the model is a known catalog model. */
export declare function portable(m: Member): Member;
/** Resolve a pack source: local path, http(s) URL, or GitHub shorthand owner/repo[/path/to/pack.json]. */
export declare function packSourceUrl(source: string): {
    kind: "file" | "url";
    location: string;
};
export declare function readPack(source: string): Promise<{
    pack: Pack;
    from: string;
}>;
export interface PackDiff {
    newProfiles: string[];
    conflictingProfiles: string[];
    newPersonas: string[];
    conflictingPersonas: string[];
    builtinPersonaOverrides: string[];
    suiteCases: number;
}
export declare function diffPack(cfg: Config, pack: Pack): PackDiff;
/**
 * Merge a pack into the config. Never clobbers an existing profile or persona:
 * conflicts are installed under `<pack>/<name>` unless `force` is set.
 */
export declare function installPack(cfg: Config, pack: Pack, source: string, opts?: {
    force?: boolean;
}): {
    cfg: Config;
    installedProfiles: string[];
    installedPersonas: string[];
    renamed: string[];
};
export declare function removePack(cfg: Config, name: string): Config;
export declare function describePack(pack: Pack, from?: string): string;
