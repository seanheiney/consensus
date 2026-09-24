import { splitMember } from "./config.js";
/** General-purpose reasoning angles, in the order variants are handed out. */
export const ANGLES = ["first-principles", "skeptic", "pragmatist", "enumerator", "alternate-method", "contrarian", "economist", "maintainer"];
/** `--for <task>`: the angles worth having in the room for a kind of work. */
export const TASKS = {
    "code-review": { description: "Correctness, then the things reviewers miss: security, operability, and the next maintainer.", angles: ["skeptic", "security", "maintainer", "performance"], rounds: 2 },
    architecture: { description: "Derive from constraints, cost it, and keep whoever inherits it in mind.", angles: ["first-principles", "pragmatist", "economist", "maintainer"], rounds: 3 },
    debug: { description: "Trace it, distrust the obvious cause, and reach the same answer a second way.", angles: ["enumerator", "skeptic", "alternate-method"], rounds: 2 },
    security: { description: "Threat-model it, argue the attacker's case, and check what operations must live with.", angles: ["security", "contrarian", "skeptic", "maintainer"], rounds: 3 },
    product: { description: "Whose problem it solves, what it costs, and what ships.", angles: ["user-advocate", "economist", "pragmatist"], rounds: 2 },
    estimate: { description: "Count it, price it, and stress the assumptions.", angles: ["enumerator", "economist", "skeptic"], rounds: 2 },
};
export function taskNames() {
    return Object.keys(TASKS).join(", ");
}
/**
 * Spread `angles` across `members`, producing `count` seats.
 *
 * Every (model, angle) pair is distinct, so seat ids stay unique: with two
 * models and four seats each model argues two angles. A member that already
 * carries a persona is left exactly as it is.
 */
export function expandVariants(members, count, angles = ANGLES) {
    if (count < 2)
        throw new Error("--variants needs at least 2 seats");
    if (!members.length)
        throw new Error("No panel to build variants from");
    const bases = members.filter((m) => !splitMember(m).persona);
    const kept = members.filter((m) => splitMember(m).persona);
    if (!bases.length)
        return members; // every seat already has an angle: leave the panel alone
    const want = count - kept.length;
    const max = bases.length * angles.length;
    if (want > max)
        throw new Error(`Cannot build ${count} variants from ${bases.length} model(s): at most ${max + kept.length} (${angles.length} angles x ${bases.length} models).`);
    const out = [...kept];
    for (let i = 0; i < want; i++) {
        const base = bases[i % bases.length];
        const angle = angles[Math.floor(i / bases.length) % angles.length];
        const { spec } = splitMember(base);
        out.push(typeof base === "string" ? `${spec}+${angle}` : { ...base, persona: angle, name: angle });
    }
    return out;
}
/** The panel `--for <task>` asks for: one seat per angle, spread over whatever models are available. */
export function expandTask(members, task) {
    const preset = TASKS[task];
    if (!preset)
        throw new Error(`Unknown task "${task}". Known: ${taskNames()}.`);
    const bases = members.filter((m) => !splitMember(m).persona);
    if (!bases.length)
        return { members, preset };
    return { members: expandVariants(members, preset.angles.length + members.length - bases.length, preset.angles), preset };
}
