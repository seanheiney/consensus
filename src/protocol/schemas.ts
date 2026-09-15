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
    .array(
      z.object({
        from: str,
        claim: str,
        action: z.enum(["concede", "rebut", "partial"]),
        reason: str.default(""),
      }),
    )
    .default([]),
  position_changed: z.boolean().default(false),
  answer: str.min(1),
});

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
