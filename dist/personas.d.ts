/**
 * Personas: a preprompt applied to one panel member. The same model can sit
 * on the panel several times under different personas, and different models
 * can share one persona. Member spec: provider[:model][#effort][+persona].
 */
import type { Panelist } from "./types.js";
export interface Persona {
    name: string;
    description: string;
    prompt: string;
}
export declare const PERSONAS: Record<string, Persona>;
export declare function personaSystemPrompt(base: string, persona: Persona): string;
/** Wrap a panelist so every non-synthesis call carries the persona preprompt. */
export declare function withPersona(panelist: Panelist, persona: Persona): Panelist;
/**
 * Resolve a persona reference: a name in `library` (user config first, then
 * built-ins), inline prompt text, or several names joined with commas
 * ("power-user,review-format"), which stack into one preprompt named after the first.
 */
export declare function resolvePersona(ref: string, library?: Record<string, string | Persona>, name?: string): Persona;
