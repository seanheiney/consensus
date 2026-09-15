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
/** Human-readable schema descriptions embedded in prompts. */
export declare const CRITIQUE_SHAPE = "{\n  \"self_review\": { \"errors\": [\"...\"], \"gaps\": [\"...\"] },\n  \"reviews\": [\n    {\n      \"answer\": \"B\",\n      \"verdict\": \"agree\" | \"disagree\",\n      \"strengths\": [\"...\"],\n      \"disputes\": [\n        { \"claim\": \"<quote or paraphrase of the specific claim>\",\n          \"problem\": \"<why it is wrong, unsupported, or missing>\",\n          \"correction\": \"<what is right instead>\",\n          \"severity\": \"major\" | \"minor\" }\n      ]\n    }\n  ]\n}";
export declare const REVISION_SHAPE = "{\n  \"responses\": [\n    { \"from\": \"B\", \"claim\": \"<the disputed claim>\", \"action\": \"concede\" | \"rebut\" | \"partial\", \"reason\": \"<specific reason>\" }\n  ],\n  \"position_changed\": true | false,\n  \"answer\": \"<your full revised answer in markdown>\"\n}";
