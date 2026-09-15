import { describe, expect, it } from "vitest";
import { PERSONAS, resolvePersona, withPersona } from "../src/personas.js";
import { buildPanel, memberId, splitMember } from "../src/config.js";
import { fakePanelist } from "./fake.js";
import { ConsensusEngine } from "../src/protocol/engine.js";
import { agreeAll, phaseOf } from "./fake.js";

const env = { ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k", PATH: "/nonexistent" };

describe("personas", () => {
  it("splits spec+persona and object members", () => {
    expect(splitMember("claude:claude-opus-5#high+skeptic")).toEqual({ spec: "claude:claude-opus-5#high", persona: "skeptic" });
    expect(splitMember({ model: "claude", persona: "You are Einstein.", name: "einstein" })).toEqual({ spec: "claude", persona: "You are Einstein.", name: "einstein" });
    expect(memberId("anthropic+skeptic")).toBe("anthropic:claude-fable-5-1+skeptic");
    expect(memberId({ model: "anthropic", persona: "You are Einstein, reason with thought experiments." })).toBe("anthropic:claude-fable-5-1+custom");
    expect(memberId({ model: "anthropic", persona: "You are Einstein, reason with thought experiments.", name: "einstein" })).toBe("anthropic:claude-fable-5-1+einstein");
  });

  it("resolves built-ins, user library, and inline text; rejects unknown short names", () => {
    expect(resolvePersona("skeptic").prompt).toBe(PERSONAS.skeptic!.prompt);
    expect(resolvePersona("einstein", { einstein: "Think like Einstein." })).toMatchObject({ name: "einstein", prompt: "Think like Einstein." });
    expect(resolvePersona("skeptic", { skeptic: "my own skeptic" }).prompt).toBe("my own skeptic");
    expect(resolvePersona("You are a pirate who reviews code.").name).toBe("you-are-a-pirate-who-rev");
    expect(() => resolvePersona("nope")).toThrow(/Unknown persona/);
    const stacked = resolvePersona("skeptic,teacher", { fmt: "FORMAT" });
    expect(stacked.name).toBe("skeptic");
    expect(stacked.prompt).toContain(PERSONAS.skeptic!.prompt);
    expect(stacked.prompt).toContain(PERSONAS.teacher!.prompt);
    expect(resolvePersona("skeptic,fmt", { fmt: "FORMAT" }, "reviewer").prompt).toContain("FORMAT");
    expect(memberId("anthropic+skeptic,teacher")).toBe("anthropic:claude-fable-5-1+skeptic");
  });

  it("the same model can hold several seats and the persona reaches the system prompt but not synthesis", async () => {
    const { panel } = buildPanel(["anthropic+skeptic", "anthropic+pragmatist", "openai"], "high", undefined, env);
    expect(panel.map((p) => p.id)).toEqual(["anthropic:claude-fable-5-1+skeptic", "anthropic:claude-fable-5-1+pragmatist", "openai:gpt-6-astra"]);
    expect(() => buildPanel(["anthropic+skeptic", "anthropic+skeptic"], "high", undefined, env)).toThrow(/Duplicate/);

    const inner = fakePanelist("a:m", (req) => (phaseOf(req) === "critique" ? agreeAll(req) : phaseOf(req) === "synthesize" ? "synth" : "answer"));
    const wrapped = withPersona(inner, PERSONAS.skeptic!);
    const other = fakePanelist("b:m", (req) => (phaseOf(req) === "critique" ? agreeAll(req) : "answer b"));
    const run = await new ConsensusEngine({ panel: [wrapped, other], judge: wrapped }).run("q");
    expect(run.converged).toBe(true);
    const systems = inner.calls.map((c) => c.system);
    expect(systems[0]).toContain("Your perspective on this panel");
    expect(systems[0]).toContain(PERSONAS.skeptic!.prompt);
    expect(inner.calls.at(-1)!.phase).toBe("synthesize");
    expect(systems.at(-1)).not.toContain("Your perspective on this panel");
    expect(run.labels).toEqual(expect.objectContaining({}));
    expect(Object.values(run.labels)).toContain("a:m+skeptic");
  });

  it("judge can be matched by spec+persona", () => {
    const { judge } = buildPanel(["anthropic+skeptic", "anthropic+pragmatist"], "high", "anthropic+pragmatist", env);
    expect(judge.id).toBe("anthropic:claude-fable-5-1+pragmatist");
  });
});
