/**
 * Panel designer: turn a plain-English brief ("five panelists, a security
 * expert, a distributed-systems engineer and a PM, frontier models") into a
 * profile with personas, seated across the vendors you have connected.
 */
import { z } from "zod";
import { type Tier } from "./catalog.js";
import type { Profile } from "./config.js";
import type { VendorStatus } from "./doctor.js";
import type { Panelist } from "./types.js";
export declare const DesignSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodString;
    seats: z.ZodArray<z.ZodObject<{
        expertise: z.ZodString;
        persona_name: z.ZodString;
        persona_prompt: z.ZodString;
        tier: z.ZodEnum<{
            budget: "budget";
            frontier: "frontier";
            standard: "standard";
        }>;
    }, z.core.$strip>>;
    rounds: z.ZodNumber;
    judge: z.ZodEnum<{
        external: "external";
        seat: "seat";
    }>;
    rationale: z.ZodString;
}, z.core.$strip>;
export type Design = z.infer<typeof DesignSchema>;
export declare const TIER_WORDS: Record<string, Tier>;
export declare function designPrompt(brief: string, statuses: VendorStatus[], tierHint?: Tier): string;
/** Template personas for --no-llm. */
export declare function templateDesign(brief: string, n: number, expertise: string[], tier: Tier, rounds: number): Design;
export declare function askDesigner(designer: Panelist, brief: string, statuses: VendorStatus[], tierHint?: Tier): Promise<Design>;
export interface Materialized {
    name: string;
    profile: Profile;
    personas: Record<string, string>;
    seatsExplained: string[];
    unseated: string[];
}
/** Assign models to seats, rotating across connected vendors so the panel is as diverse as your connections allow. */
export declare function materializeDesign(d: Design, statuses: VendorStatus[]): Materialized;
