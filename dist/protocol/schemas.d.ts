import { z } from "zod";
export declare const DisputeSchema: z.ZodObject<{
    claim: z.ZodString;
    problem: z.ZodString;
    correction: z.ZodDefault<z.ZodString>;
    severity: z.ZodDefault<z.ZodEnum<{
        major: "major";
        minor: "minor";
    }>>;
}, z.core.$strip>;
export declare const ReviewSchema: z.ZodObject<{
    answer: z.ZodString;
    verdict: z.ZodEnum<{
        agree: "agree";
        disagree: "disagree";
    }>;
    strengths: z.ZodDefault<z.ZodArray<z.ZodString>>;
    disputes: z.ZodDefault<z.ZodArray<z.ZodObject<{
        claim: z.ZodString;
        problem: z.ZodString;
        correction: z.ZodDefault<z.ZodString>;
        severity: z.ZodDefault<z.ZodEnum<{
            major: "major";
            minor: "minor";
        }>>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export declare const CritiqueSchema: z.ZodObject<{
    self_review: z.ZodDefault<z.ZodObject<{
        errors: z.ZodDefault<z.ZodArray<z.ZodString>>;
        gaps: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    reviews: z.ZodArray<z.ZodObject<{
        answer: z.ZodString;
        verdict: z.ZodEnum<{
            agree: "agree";
            disagree: "disagree";
        }>;
        strengths: z.ZodDefault<z.ZodArray<z.ZodString>>;
        disputes: z.ZodDefault<z.ZodArray<z.ZodObject<{
            claim: z.ZodString;
            problem: z.ZodString;
            correction: z.ZodDefault<z.ZodString>;
            severity: z.ZodDefault<z.ZodEnum<{
                major: "major";
                minor: "minor";
            }>>;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const RevisionSchema: z.ZodObject<{
    responses: z.ZodDefault<z.ZodArray<z.ZodObject<{
        from: z.ZodString;
        claim: z.ZodString;
        action: z.ZodEnum<{
            concede: "concede";
            partial: "partial";
            rebut: "rebut";
        }>;
        reason: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>>>;
    position_changed: z.ZodDefault<z.ZodBoolean>;
    answer: z.ZodString;
}, z.core.$strip>;
export declare const ModerationSchema: z.ZodObject<{
    settled: z.ZodDefault<z.ZodArray<z.ZodString>>;
    key_disputes: z.ZodDefault<z.ZodArray<z.ZodObject<{
        topic: z.ZodString;
        positions: z.ZodString;
        ruling: z.ZodDefault<z.ZodString>;
        ask: z.ZodString;
    }, z.core.$strip>>>;
    guidance: z.ZodDefault<z.ZodString>;
    questions_for_seats: z.ZodDefault<z.ZodArray<z.ZodObject<{
        seat: z.ZodString;
        question: z.ZodString;
    }, z.core.$strip>>>;
    request_extra_round: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export declare const MODERATION_SHAPE = "{\n  \"settled\": [\"<claims every answer now shares, stated once>\"],\n  \"key_disputes\": [\n    { \"topic\": \"<the disagreement in one line>\",\n      \"positions\": \"<who holds what, by answer label, and the strongest argument each gave>\",\n      \"ruling\": \"<if you can settle it on the evidence or by a checkable argument, say who is right and why; otherwise empty>\",\n      \"ask\": \"<exactly what the seats must do about it in their revision>\" }\n  ],\n  \"guidance\": \"<two or three sentences steering the next round: what to stop arguing about, what to test, what a converged answer must contain>\",\n  \"questions_for_seats\": [ { \"seat\": \"<answer label>\", \"question\": \"<a direct question that forces that seat to defend, test, or concede a specific point>\" } ],\n  \"request_extra_round\": <true only if this is the last scheduled round, the debate is still productive, and one more exchange would likely resolve a key dispute>\n}";
/** Human-readable schema descriptions embedded in prompts. */
export declare const CRITIQUE_SHAPE = "{\n  \"self_review\": { \"errors\": [\"...\"], \"gaps\": [\"...\"] },\n  \"reviews\": [\n    {\n      \"answer\": \"B\",\n      \"verdict\": \"agree\" | \"disagree\",\n      \"strengths\": [\"...\"],\n      \"disputes\": [\n        { \"claim\": \"<quote or paraphrase of the specific claim>\",\n          \"problem\": \"<why it is wrong, unsupported, or missing>\",\n          \"correction\": \"<what is right instead>\",\n          \"severity\": \"major\" | \"minor\" }\n      ]\n    }\n  ]\n}";
export declare const REVISION_SHAPE = "{\n  \"responses\": [\n    { \"from\": \"B\", \"claim\": \"<the disputed claim>\", \"action\": \"concede\" | \"rebut\" | \"partial\", \"reason\": \"<specific reason>\" }\n  ],\n  \"position_changed\": true | false,\n  \"answer\": \"<your full revised answer in markdown>\"\n}";
