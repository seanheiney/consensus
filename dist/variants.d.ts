/**
 * Prompt ensembles: seat the same model (or a small panel) several times, each
 * under a different angle on the problem, so a debate needs one subscription
 * rather than four. `--variants 4` spreads the general angles across the panel;
 * `--for code-review` uses the angles that suit a kind of work.
 *
 * Both are opt-in. Without them a panel is exactly what the profile says.
 */
import type { Member } from "./config.js";
/** General-purpose reasoning angles, in the order variants are handed out. */
export declare const ANGLES: readonly ["first-principles", "skeptic", "pragmatist", "enumerator", "alternate-method", "contrarian", "economist", "maintainer"];
export interface TaskPreset {
    description: string;
    angles: string[];
    rounds?: number;
}
/** `--for <task>`: the angles worth having in the room for a kind of work. */
export declare const TASKS: Record<string, TaskPreset>;
export declare function taskNames(): string;
/**
 * Spread `angles` across `members`, producing `count` seats.
 *
 * Every (model, angle) pair is distinct, so seat ids stay unique: with two
 * models and four seats each model argues two angles. A member that already
 * carries a persona is left exactly as it is.
 */
export declare function expandVariants(members: Member[], count: number, angles?: readonly string[]): Member[];
/** The panel `--for <task>` asks for: one seat per angle, spread over whatever models are available. */
export declare function expandTask(members: Member[], task: string): {
    members: Member[];
    preset: TaskPreset;
};
