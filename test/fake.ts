import type { CompletionRequest, CompletionResult, Panelist } from "../src/types.js";

export type Script = (req: CompletionRequest, call: number) => string | Promise<string>;

/** A scripted panelist for tests. `script` receives the request and the call index. */
export function fakePanelist(id: string, script: Script): Panelist & { calls: CompletionRequest[] } {
  const calls: CompletionRequest[] = [];
  return {
    id,
    provider: id.split(":")[0]!,
    model: id.split(":")[1] ?? id,
    calls,
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      calls.push(req);
      const text = await script(req, calls.length - 1);
      return { text, usage: { inputTokens: 10, outputTokens: 5 } };
    },
  };
}

/** Which phase a prompt belongs to, by its wording. */
export function phaseOf(req: CompletionRequest): "propose" | "critique" | "revise" | "synthesize" | "repair" {
  const last = req.messages[req.messages.length - 1]!.content;
  if (last.startsWith("Your previous response could not be used")) return "repair";
  if (last.includes("You are the panel's synthesizer")) return "synthesize";
  if (last.includes("## Critiques raised against your answer")) return "revise";
  if (last.includes("Examine every answer other than your own") || last.includes("## Your task (follow-up round)")) return "critique";
  return "propose";
}

/** The label the prompt assigns to this panelist ("this is YOUR answer"). */
export function ownLabel(req: CompletionRequest): string {
  const m = req.messages[0]!.content.match(/### Answer (\w) \(this is YOUR answer\)/);
  if (!m) throw new Error("no own label in prompt");
  return m[1]!;
}

export function otherLabels(req: CompletionRequest): string[] {
  const text = req.messages[0]!.content;
  const own = ownLabel(req);
  return [...text.matchAll(/### Answer (\w)/g)].map((m) => m[1]!).filter((l) => l !== own);
}

export function agreeAll(req: CompletionRequest): string {
  return JSON.stringify({
    self_review: { errors: [], gaps: [] },
    reviews: otherLabels(req).map((answer) => ({ answer, verdict: "agree", strengths: ["fine"], disputes: [] })),
  });
}

export function disagreeAll(req: CompletionRequest, claim = "X is wrong"): string {
  return JSON.stringify({
    self_review: { errors: [], gaps: [] },
    reviews: otherLabels(req).map((answer) => ({
      answer,
      verdict: "disagree",
      strengths: [],
      disputes: [{ claim, problem: "because", correction: "Y", severity: "major" }],
    })),
  });
}

export function revision(answer: string, changed = true): string {
  return JSON.stringify({ responses: [], position_changed: changed, answer });
}
