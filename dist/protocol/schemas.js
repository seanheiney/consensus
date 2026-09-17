import { z } from "zod";
const str = z.string();
const strList = z.array(str).default([]);
export const DisputeSchema = z.object({
    claim: str,
    problem: str,
    correction: str.default(""),
    severity: z.enum(["minor", "major"]).default("major"),
});
export const ReviewSchema = z.object({
    answer: str,
    verdict: z.enum(["agree", "disagree"]),
    strengths: strList,
    disputes: z.array(DisputeSchema).default([]),
});
export const CritiqueSchema = z.object({
    self_review: z
        .object({ errors: strList, gaps: strList })
        .default({ errors: [], gaps: [] }),
    reviews: z.array(ReviewSchema),
});
export const RevisionSchema = z.object({
    responses: z
        .array(z.object({
        from: str,
        claim: str,
        action: z.enum(["concede", "rebut", "partial"]),
        reason: str.default(""),
    }))
        .default([]),
    position_changed: z.boolean().default(false),
    answer: str.min(1),
});
export const ModerationSchema = z.object({
    settled: z.array(str).default([]),
    key_disputes: z
        .array(z.object({
        topic: str,
        positions: str,
        ruling: str.default(""),
        ask: str,
    }))
        .default([]),
    guidance: str.default(""),
    questions_for_seats: z.array(z.object({ seat: str, question: str })).default([]),
    request_extra_round: z.boolean().default(false),
    stop_debate: z.boolean().default(false),
});
export const MODERATION_SHAPE = `{
  "settled": ["<claims every answer now shares, stated once>"],
  "key_disputes": [
    { "topic": "<the disagreement in one line>",
      "positions": "<who holds what, by answer label, and the strongest argument each gave>",
      "ruling": "<if you can settle it on the evidence or by a checkable argument, say who is right and why; otherwise empty>",
      "ask": "<exactly what the seats must do about it in their revision>" }
  ],
  "guidance": "<two or three sentences steering the next round: what to stop arguing about, what to test, what a converged answer must contain>",
  "questions_for_seats": [ { "seat": "<answer label>", "question": "<a direct question that forces that seat to defend, test, or concede a specific point>" } ],
  "request_extra_round": <true only if this is the last scheduled round, the debate is still productive, and one more exchange would likely resolve a key dispute>,
  "stop_debate": <true only after round 1, when every remaining dispute is a judgment call or already ruled on and another revision is unlikely to move either seat; the report will present them as unresolved>
}`;
/** Human-readable schema descriptions embedded in prompts. */
export const CRITIQUE_SHAPE = `{
  "self_review": { "errors": ["..."], "gaps": ["..."] },
  "reviews": [
    {
      "answer": "B",
      "verdict": "agree" | "disagree",
      "strengths": ["..."],
      "disputes": [
        { "claim": "<quote or paraphrase of the specific claim>",
          "problem": "<why it is wrong, unsupported, or missing>",
          "correction": "<what is right instead>",
          "severity": "major" | "minor" }
      ]
    }
  ]
}`;
export const REVISION_SHAPE = `{
  "responses": [
    { "from": "B", "claim": "<the disputed claim>", "action": "concede" | "rebut" | "partial", "reason": "<specific reason>" }
  ],
  "position_changed": true | false,
  "answer": "<your full revised answer in markdown>"
}`;
