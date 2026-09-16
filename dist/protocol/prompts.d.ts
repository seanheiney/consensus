import type { Critique, Moderation } from "../types.js";
export declare const CAPTAIN_PROMPT = "You are the captain of a panel of independent AI models debating a problem. You did not write any of the answers. Your duties: moderate (find the disputes that matter and cut the ones that don't), referee (settle a dispute when the evidence or a checkable argument settles it, and say so plainly), and report (assemble the best compilation of what survived). You are rigorous, neutral between answers, and allergic to vague consensus: a dispute is either settled with a reason or carried forward with a concrete ask. Never invent claims that no answer made.";
export declare function moderatorPrompt(args: {
    prompt: string;
    context?: string;
    round: number;
    answers: Record<string, string>;
    critiques: Record<string, Critique>;
    /** True when this is the last scheduled round (the captain may request one more). */
    lastScheduled?: boolean;
}): string;
export declare function moderationBlock(m: Moderation, forSeat?: string): string;
export declare const SYSTEM_PROMPT = "You are one member of a panel of independent AI models convened to produce the best possible answer to a problem. The panel is adversarial by design: members try to find flaws in each other's reasoning, and only claims that survive scrutiny reach the final answer.\n\nGround rules:\n- Be rigorous and specific. Prefer verifiable reasoning, concrete evidence, and worked examples over confident assertion.\n- Say what you are uncertain about and why. Do not manufacture certainty.\n- Never defer to another answer because it is longer, more confident, or more polished. Change your position only when given a reason that is actually better than yours.\n- Never keep a position you can no longer defend. Conceding a good point is a win for the panel, not a loss for you.\n- Distinguish substance from style. Different wording, structure, or emphasis is not a disagreement. Different conclusions, recommendations, facts, or reasoning are.\n- Do not mention which company or model you are. Panelists are anonymous.";
export declare function problemBlock(prompt: string, context?: string): string;
export declare function proposePrompt(prompt: string, context?: string): string;
export declare function answersBlock(answers: Record<string, string>, own?: string): string;
export declare function critiquePrompt(args: {
    prompt: string;
    context?: string;
    round: number;
    answers: Record<string, string>;
    own: string;
}): string;
export declare function revisePrompt(args: {
    prompt: string;
    context?: string;
    round: number;
    answers: Record<string, string>;
    critiques: Record<string, Critique>;
    own: string;
    moderation?: Moderation;
}): string;
export declare function synthesizePrompt(args: {
    prompt: string;
    context?: string;
    rounds: number;
    converged: boolean;
    answers: Record<string, string>;
    lastCritiques?: Record<string, Critique>;
    /** Captain's briefs per round, when a captain moderated. */
    moderations?: {
        round: number;
        moderation: Moderation;
    }[];
    /** Per-round revision facts; empty when no revise phase ran. */
    revisions?: {
        round: number;
        label: string;
        positionChanged: boolean;
        conceded: string[];
        rebutted: string[];
    }[];
}): string;
