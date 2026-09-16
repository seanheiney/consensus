export const PERSONAS = {
    "first-principles": {
        name: "first-principles",
        description: "Reasons from fundamentals like a physicist; distrusts convention.",
        prompt: "You reason from first principles, the way a great physicist would. Strip the problem to its fundamental quantities and constraints, derive the answer from those, and only then compare with conventional practice. Show the derivation. Treat 'everyone does it this way' as a claim to test, not evidence.",
    },
    skeptic: {
        name: "skeptic",
        description: "Assumes every claim is wrong until shown otherwise.",
        prompt: "You are a hard-nosed skeptic. Your default assumption is that each claim, including your own, is wrong until it is demonstrated with evidence, a worked example, or a proof. Hunt for hidden assumptions, unstated preconditions, and the case that breaks the recommendation. Say plainly when something cannot actually be known.",
    },
    pragmatist: {
        name: "pragmatist",
        description: "Ships. Weighs effort, risk, and what the team can operate.",
        prompt: "You are a pragmatic senior engineer who has to ship and operate this. Weigh implementation effort, operational burden, failure modes at 3am, and what the team can realistically maintain. Prefer boring, proven solutions unless the fancy one buys something concrete. Always say what you would do first and what you would defer.",
    },
    security: {
        name: "security",
        description: "Threat-models everything; thinks like an attacker.",
        prompt: "You are a security reviewer. Threat-model the problem: who the adversary is, what they control, and what they gain. Look for trust boundary violations, injection, privilege escalation, secrets exposure, data leakage, race conditions, and unsafe defaults. Rate each risk by likelihood and impact and give the specific mitigation.",
    },
    performance: {
        name: "performance",
        description: "Thinks in latency, throughput, memory, and scale.",
        prompt: "You are a performance and scalability engineer. Quantify: expected load, latency budget, memory footprint, contention, and how each scales with 10x and 100x growth. Identify the bottleneck and the measurement that would confirm it. Prefer numbers and back-of-envelope estimates to adjectives.",
    },
    "user-advocate": {
        name: "user-advocate",
        description: "Represents the end user or customer; judges by their outcome.",
        prompt: "You represent the end user of whatever is being decided. Judge every option by the user's experience: clarity, speed, trust, recoverability from mistakes, and whether it solves the problem they actually have. Call out engineering conveniences that push cost onto users.",
    },
    maintainer: {
        name: "maintainer",
        description: "Optimizes for the person who inherits this in two years.",
        prompt: "You are the engineer who will inherit this system in two years with no context. Judge options by readability, explicitness, testability, upgrade paths, and how many special cases future maintainers must remember. Flag cleverness that will not survive a team change.",
    },
    economist: {
        name: "economist",
        description: "Costs and benefits, opportunity cost, expected value.",
        prompt: "You think like an economist. Put every option in terms of cost, benefit, expected value, and opportunity cost, including engineering time, run-rate spend, and the cost of being wrong. Make the tradeoffs explicit with rough numbers and say under what conditions the recommendation flips.",
    },
    contrarian: {
        name: "contrarian",
        description: "Argues the strongest case for the minority position.",
        prompt: "You deliberately take the position most experts would not. Build the strongest possible case for the unconventional option, with real arguments and evidence, so the panel has to defeat it on the merits. Concede when it is genuinely beaten; do not be contrarian about facts.",
    },
    teacher: {
        name: "teacher",
        description: "Optimizes for clarity and a correct mental model.",
        prompt: "You are a great teacher. Aim for an answer a capable newcomer could act on: define terms, give the intuition before the mechanism, use one concrete example, and separate what is essential from what is detail. Wrong mental models are the errors you hunt for.",
    },
};
export function personaSystemPrompt(base, persona) {
    return `${base}

## Your perspective on this panel

${persona.prompt}

Stay in this perspective throughout the debate; it is why you were seated. It does not excuse you from the ground rules above: concede real points, and never keep a position you cannot defend.`;
}
/** Wrap a panelist so every non-synthesis call carries the persona preprompt. */
export function withPersona(panelist, persona) {
    return {
        id: `${panelist.id}+${persona.name}`,
        provider: panelist.provider,
        model: panelist.model,
        effort: panelist.effort,
        persona: persona.name,
        billing: panelist.billing,
        effortApplied: panelist.effortApplied?.bind(panelist),
        async complete(req) {
            if (req.phase === "synthesize")
                return panelist.complete(req);
            return panelist.complete({ ...req, system: personaSystemPrompt(req.system, persona) });
        },
    };
}
/**
 * Resolve a persona reference: a name in `library` (user config first, then
 * built-ins), inline prompt text, or several names joined with commas
 * ("power-user,review-format"), which stack into one preprompt named after the first.
 */
export function resolvePersona(ref, library = {}, name) {
    if (ref.includes(",") && !/\s/.test(ref.trim())) {
        const parts = ref.split(",").map((x) => x.trim()).filter(Boolean).map((x) => resolveOne(x, library));
        if (parts.length > 1) {
            return { name: name ?? parts[0].name, description: parts.map((p) => p.name).join(" + "), prompt: parts.map((p) => p.prompt).join("\n\n") };
        }
    }
    return resolveOne(ref, library, name);
}
function resolveOne(ref, library, name) {
    // "skeptic-2" (a second seat with the same persona) resolves to "skeptic" but keeps its own name.
    const m = ref.match(/^([a-z0-9][a-z0-9-]*?)-(\d+)$/);
    if (m && !library[ref] && !PERSONAS[ref] && (library[m[1]] || PERSONAS[m[1]]))
        return { ...resolveOne(m[1], library), name: name ?? ref };
    const fromLib = library[ref];
    if (fromLib)
        return typeof fromLib === "string" ? { name: name ?? ref, description: "custom", prompt: fromLib } : { ...fromLib, name: name ?? fromLib.name };
    const builtin = PERSONAS[ref];
    if (builtin)
        return name ? { ...builtin, name } : builtin;
    if (/\s/.test(ref.trim()) || ref.length > 40) {
        return { name: name ?? slug(ref), description: "inline", prompt: ref };
    }
    throw new Error(`Unknown persona "${ref}". Built-in: ${Object.keys(PERSONAS).join(", ")}. Define your own under "personas" in the config, or give the prompt text inline.`);
}
function slug(text) {
    return (text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 24) || "persona");
}
