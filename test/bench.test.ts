import { describe, expect, it } from "vitest";
import { answerSection, estimateCost, gradePrompt, renderBench, runBench, summarize, SAMPLE_SUITE, BenchSuiteSchema } from "../src/bench.js";
import { fakePanelist, agreeAll, phaseOf } from "./fake.js";

describe("bench", () => {
  it("estimates cost from catalog prices, including openrouter ids, and reports unpriced seats", () => {
    const { usd, unpriced } = estimateCost({
      "anthropic:claude-opus-5": { inputTokens: 1_000_000, outputTokens: 100_000 },
      "openrouter:x-ai/grok-4.6+skeptic": { inputTokens: 500_000, outputTokens: 0 },
      claude: { inputTokens: 10, outputTokens: 10 },
    });
    expect(usd).toBeCloseTo(5 + 2.5 + 1, 5);
    expect(unpriced).toEqual(["claude"]);
    expect(estimateCost({ claude: { inputTokens: 1, outputTokens: 1 } }).usd).toBeNull();
    expect(estimateCost({ "codex:gpt-5.6-sol": { inputTokens: 1_000_000, outputTokens: 0 } })).toMatchObject({ usd: null, subscriptionEquivUsd: 4 });
  });

  it("the starter suite validates and mixes objective and judgment cases", () => {
    expect(() => BenchSuiteSchema.parse(SAMPLE_SUITE)).not.toThrow();
    expect(SAMPLE_SUITE.cases.some((c) => c.expected)).toBe(true);
    expect(SAMPLE_SUITE.cases.some((c) => c.rubric && !c.expected)).toBe(true);
    expect(gradePrompt(SAMPLE_SUITE.cases[0]!, [{ label: "A", text: "60" }])).toContain("Reference answer (ground truth)");
    expect(gradePrompt(SAMPLE_SUITE.cases[4]!, [{ label: "A", text: "x" }])).toContain("Set accuracy to null");
  });

  it("runs profiles over cases, grades blind, and summarizes", async () => {
    const mk = (name: string, answer: string) => fakePanelist(name, (req) => (phaseOf(req) === "critique" ? agreeAll(req) : phaseOf(req) === "synthesize" ? answer : "draft"));
    const profiles = [
      { name: "good", panel: [mk("g1:m", "The answer is 60."), mk("g2:m", "")], judge: undefined as never, rounds: 1, effort: "low" as const },
      { name: "bad", panel: [mk("b1:m", "The answer is 42."), mk("b2:m", "")], judge: undefined as never, rounds: 1, effort: "low" as const },
    ].map((p) => ({ ...p, judge: p.panel[0]! }));
    const grader = fakePanelist("grader:m", (req) => {
      const text = req.messages[0]!.content;
      const labels = [...text.matchAll(/### Answer (\w)\n\n([^\n]*)/g)];
      return JSON.stringify({ grades: labels.map(([, l, t]) => ({ answer: l, accuracy: t!.includes("60") ? 10 : 0, quality: t!.includes("60") ? 9 : 3, notes: "n" })) });
    });
    const suite = { name: "t", cases: [SAMPLE_SUITE.cases[0]!, SAMPLE_SUITE.cases[1]!] };
    const report = await runBench({ suite, profiles, grader });
    expect(report.results).toHaveLength(4);
    const good = report.summaries.find((s) => s.profile === "good")!;
    const bad = report.summaries.find((s) => s.profile === "bad")!;
    expect(good.avgAccuracy).toBe(10);
    expect(bad.avgAccuracy).toBe(0);
    expect(good.convergedRate).toBe(1);
    expect(good.failures).toBe(0);
    expect(grader.calls).toHaveLength(2);
    expect(grader.calls[0]!.phase).toBe("grade");
    const md = renderBench(report);
    expect(md).toContain("| good | 10.0/10 |");
    expect(md).toContain("| bad | 0.0/10 |");
  });

  it("grades only the answer section and supports trials", async () => {
    expect(answerSection("# Answer\nUse X.\n\n# Confidence\nhigh\n\n# Where the panel agreed\n- y")).toBe("Use X.");
    expect(answerSection("no headers at all")).toBe("no headers at all");
    const mk = (name: string) => fakePanelist(name, (req) => (phaseOf(req) === "critique" ? agreeAll(req) : phaseOf(req) === "synthesize" ? "# Answer\n60\n\n# Confidence\nhigh" : "d"));
    const grader = fakePanelist("g:m", (req) => {
      const text = req.messages[0]!.content;
      expect(text).not.toContain("# Confidence");
      return JSON.stringify({ grades: [...text.matchAll(/### Answer (\w)/g)].map(([, l]) => ({ answer: l, accuracy: 10, quality: 8, notes: "" })) });
    });
    const p = mk("a:m");
    const report = await runBench({ suite: { cases: [SAMPLE_SUITE.cases[0]!] }, profiles: [{ name: "p", panel: [p, mk("b:m")], judge: p, rounds: 1, effort: "low" }], grader, trials: 3 });
    expect(report.results).toHaveLength(3);
    expect(report.results.map((r) => r.trial)).toEqual([0, 1, 2]);
    expect(report.summaries[0]!.cases).toBe(3);
    expect(report.summaries[0]!.avgAccuracy).toBe(10);
    expect(grader.calls).toHaveLength(1);
    expect(renderBench(report)).toContain("(trial 2)");
  });

  it("records failures without aborting the suite", async () => {
    const boom = fakePanelist("x:m", () => { throw new Error("down"); });
    const ok = fakePanelist("y:m", (req) => (phaseOf(req) === "critique" ? agreeAll(req) : "a"));
    const grader = fakePanelist("g:m", () => JSON.stringify({ grades: [] }));
    const report = await runBench({ suite: { cases: [SAMPLE_SUITE.cases[1]!] }, profiles: [{ name: "broken", panel: [boom, fakePanelist("z:m", () => { throw new Error("down"); })], judge: boom, rounds: 1, effort: "low" }, { name: "fine", panel: [ok, fakePanelist("w:m", (req) => (phaseOf(req) === "critique" ? agreeAll(req) : "b"))], judge: ok, rounds: 1, effort: "low" }], grader });
    expect(report.results[0]!.ok).toBe(false);
    expect(report.results[0]!.error).toMatch(/Fewer than 2/);
    expect(summarize("broken", report.results.filter((r) => r.profile === "broken")).failures).toBe(1);
    expect(renderBench(report)).toContain("FAILED");
  });
});
