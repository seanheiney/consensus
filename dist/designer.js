/**
 * Panel designer: turn a plain-English brief ("five panelists, a security
 * expert, a distributed-systems engineer and a PM, frontier models") into a
 * profile with personas, seated across the vendors you have connected.
 */
import { z } from "zod";
import { CATALOG_VENDORS, pickSeatable } from "./catalog.js";
import { PERSONAS } from "./personas.js";
import { extractJson } from "./protocol/json.js";
import { toStrictJsonSchema } from "./protocol/engine.js";
export const DesignSchema = z.object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
    description: z.string(),
    seats: z
        .array(z.object({
        expertise: z.string(),
        /** A built-in persona name when one fits, otherwise a new lowercase name. */
        persona_name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
        /** Empty when persona_name is a built-in. */
        persona_prompt: z.string(),
        tier: z.enum(["frontier", "standard", "budget"]),
    }))
        .min(2)
        .max(8),
    rounds: z.number().int().min(1).max(5),
    judge: z.enum(["external", "seat"]),
    rationale: z.string(),
});
export const TIER_WORDS = { frontier: "frontier", best: "frontier", strongest: "frontier", balanced: "standard", standard: "standard", mid: "standard", commodity: "budget", cheap: "budget", budget: "budget", cheapest: "budget" };
export function designPrompt(brief, statuses, tierHint) {
    const builtins = Object.values(PERSONAS).map((p) => `- ${p.name}: ${p.description}`).join("\n");
    const connected = statuses.filter((s) => s.connected).map((s) => s.label).join(", ") || "none";
    return `Design a debate panel for the brief below. The panel is a set of seats; each seat is one model with a persona (a preprompt giving it a perspective and expertise). Seats argue adversarially, so pick perspectives that will genuinely disagree and cover the brief's blind spots.

## Brief

${brief.trim()}

## Constraints

- Between 2 and 8 seats. Use the number the brief asks for; otherwise choose what the problem needs (usually 3 to 5).
- Model tier per seat: "frontier" (strongest, expensive), "standard" (strong mid-tier), "budget" (cheap). ${tierHint ? `The user asked for ${tierHint} models: use that tier unless a seat has a strong reason not to.` : "Infer the tier from the brief; default to standard."}
- Prefer these built-in personas when one matches an expertise (set persona_prompt to an empty string then):
${builtins}
- For any other expertise write a new persona: a lowercase dashed persona_name and a persona_prompt of 2 to 4 sentences in the second person that gives the seat a concrete vantage point, what it optimizes for, what it distrusts, and what it always checks. No celebrity impersonations. No instruction to be agreeable.
- rounds: 1 for a quick check, 2 or 3 for real decisions, up to 5 for high stakes.
- judge: "external" when the brief needs a neutral synthesis (most cases), "seat" when one seat is explicitly the decision owner.
- Connected vendors on this machine (models are assigned later, you only choose tiers): ${connected}.

Respond with ONLY a JSON object of this shape:
{"name": "<lowercase-dashed-profile-name>", "description": "<one line>", "seats": [{"expertise": "...", "persona_name": "...", "persona_prompt": "...", "tier": "frontier|standard|budget"}], "rounds": 3, "judge": "external|seat", "rationale": "<two sentences on why this panel>"}`;
}
/** Template personas for --no-llm. */
export function templateDesign(brief, n, expertise, tier, rounds) {
    const seats = expertise.slice(0, Math.max(n, 2)).map((e) => {
        const key = e.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "expert";
        const builtin = PERSONAS[key];
        return {
            expertise: e.trim(),
            persona_name: builtin ? key : key,
            persona_prompt: builtin ? "" : `You are a seasoned ${e.trim()}. Judge every option from that vantage point: what it gets right and wrong for the concerns you are responsible for, what it silently assumes, and what you would insist on checking before agreeing. Say plainly when something is outside your expertise.`,
            tier,
        };
    });
    while (seats.length < Math.max(n, 2))
        seats.push({ expertise: "generalist", persona_name: "generalist-" + (seats.length + 1), persona_prompt: "You are a broad, careful generalist. Look for what the specialists are missing, keep the whole picture in view, and insist that the recommendation is something a competent team could actually execute.", tier });
    return { name: (brief.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "designed-panel"), description: brief.trim().slice(0, 120), seats, rounds, judge: "external", rationale: "Template personas (no model call)." };
}
export async function askDesigner(designer, brief, statuses, tierHint) {
    const res = await designer.complete({
        system: "You design expert review panels. You are precise, concrete, and you never pad.",
        messages: [{ role: "user", content: designPrompt(brief, statuses, tierHint) }],
        json: true,
        jsonSchema: toStrictJsonSchema(DesignSchema),
        effort: "medium",
        phase: "propose",
    });
    return DesignSchema.parse(extractJson(res.text));
}
/** Assign models to seats, rotating across connected vendors so the panel is as diverse as your connections allow. */
export function materializeDesign(d, statuses) {
    const vendors = CATALOG_VENDORS.filter((v) => statuses.some((s) => s.vendor === v && s.connected) || statuses.some((s) => s.vendor === "openrouter" && s.connected));
    const panel = [];
    const personas = {};
    const seatsExplained = [];
    const unseated = [];
    const effortFor = { frontier: "max", standard: "high", budget: "medium" };
    let vi = 0;
    const used = new Set();
    for (const seat of d.seats) {
        let spec;
        for (let k = 0; k < Math.max(vendors.length, 1) && !spec; k++) {
            const vendor = vendors[(vi + k) % vendors.length];
            if (!vendor)
                break;
            const pick = pickSeatable(vendor, seat.tier, statuses);
            if (pick) {
                spec = pick.spec(effortFor[seat.tier]);
                vi = (vi + k + 1) % vendors.length;
            }
        }
        if (!spec) {
            unseated.push(`${seat.expertise} (${seat.tier}: no connected vendor can seat it)`);
            continue;
        }
        let name = seat.persona_name;
        if (!PERSONAS[name] && seat.persona_prompt.trim())
            personas[name] = seat.persona_prompt.trim();
        else if (!PERSONAS[name])
            name = "pragmatist"; // model named a persona it did not define: fall back to a built-in
        let member = `${spec}+${name}`;
        if (used.has(member))
            member = `${spec}+${name}-${used.size + 1}`; // same model+persona twice: keep ids unique
        used.add(member);
        panel.push(member);
        seatsExplained.push(`${seat.expertise}: ${member}`);
    }
    const profile = {
        description: d.description,
        panel,
        rounds: d.rounds,
        judge: d.judge === "external" ? "external:auto" : panel[0]?.replace(/#\w+(?=\+|$)/, ""),
    };
    return { name: d.name, profile, personas, seatsExplained, unseated };
}
