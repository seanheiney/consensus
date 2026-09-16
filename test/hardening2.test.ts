import { describe, expect, it } from "vitest";
import { ConsensusEngine } from "../src/protocol/engine.js";
import { CostLimitError, estimateCost } from "../src/cost.js";
import { agreeAll, fakePanelist, phaseOf } from "./fake.js";
import { buildPanel } from "../src/config.js";
import { markdownToHtml } from "../src/store.js";
import { removeBlock, upsertBlock } from "../src/skillpack.js";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CompletionRequest } from "../src/types.js";

const std = (name: string) => (req: CompletionRequest) => (phaseOf(req) === "critique" ? agreeAll(req) : phaseOf(req) === "synthesize" ? `synth by ${name}` : `${name} answer`);

describe("spend ceiling", () => {
  it("aborts once estimated list-price cost exceeds --max-cost", async () => {
    const pricey = (id: string) => {
      const p = fakePanelist(id, std(id));
      const inner = p.complete.bind(p);
      p.complete = async (req) => ({ ...(await inner(req)), usage: { inputTokens: 1_000_000, outputTokens: 0 } });
      return p;
    };
    const a = pricey("anthropic:claude-opus-5");
    const b = pricey("openai:gpt-6-astra");
    await expect(new ConsensusEngine({ panel: [a, b], maxCostUsd: 1 }).run("q")).rejects.toBeInstanceOf(CostLimitError);
    // the same spend on subscription seats never trips the ceiling
    const subA = pricey("claude:claude-opus-5");
    const subB = pricey("codex:gpt-5.6-sol");
    await expect(new ConsensusEngine({ panel: [subA, subB], maxCostUsd: 1 }).run("q")).resolves.toBeDefined();
    expect(estimateCost({ "anthropic:claude-opus-5": { inputTokens: 1_000_000, outputTokens: 0 } }).usd).toBe(5);
    expect(estimateCost({ "claude:claude-opus-5": { inputTokens: 0, outputTokens: 0 } })).toEqual({ usd: null, subscriptionEquivUsd: null, unpriced: ["claude:claude-opus-5"] });
    // subscription seats are quota, never billed: they must not count toward --max-cost
    const sub = estimateCost({ "claude:x": { inputTokens: 1, outputTokens: 1, costUsd: 0.42 } });
    expect(sub.usd).toBeNull();
    expect(sub.subscriptionEquivUsd).toBe(0.42);
  });
});

describe("retry and external judge", () => {
  it("retries a seat once on a transient error", async () => {
    let calls = 0;
    const flaky = fakePanelist("a:m", (req) => {
      if (phaseOf(req) === "propose" && calls++ === 0) throw new Error("429 rate limit exceeded");
      return std("A")(req);
    });
    const b = fakePanelist("b:m", std("B"));
    const run = await new ConsensusEngine({ panel: [flaky, b] }).run("q");
    expect(Object.keys(run.dropped)).toEqual([]);
    expect(run.proposals).toBeDefined();
  });
  it("does not retry non-transient errors, and --no-retry disables retry", async () => {
    const bad = fakePanelist("a:m", () => { throw new Error("invalid request"); });
    const b = fakePanelist("b:m", std("B"));
    const c = fakePanelist("c:m", std("C"));
    const run = await new ConsensusEngine({ panel: [bad, b, c] }).run("q");
    expect(run.dropped["a:m"]).toContain("invalid request");
    let n = 0;
    const flaky = fakePanelist("d:m", () => { n++; throw new Error("429"); });
    await new ConsensusEngine({ panel: [flaky, b, c], retry: false }).run("q");
    expect(n).toBe(1);
  });
  it("an external judge synthesizes without having debated", async () => {
    const a = fakePanelist("a:m", std("A"));
    const b = fakePanelist("b:m", std("B"));
    const j = fakePanelist("judge:m", (req) => (phaseOf(req) === "synthesize" ? "external synthesis" : "should not be called"));
    const run = await new ConsensusEngine({ panel: [a, b], judge: j }).run("q");
    expect(run.synthesis).toBe("external synthesis");
    expect(run.judge).toBe("judge:m");
    expect(j.calls).toHaveLength(1);
    expect(Object.keys(run.proposals)).toHaveLength(2);
    const env = { ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k", PATH: "/nonexistent" };
    const { judge } = buildPanel(["anthropic", "openai"], "high", "external:anthropic:claude-sonnet-5+teacher", env);
    expect(judge.id).toBe("anthropic:claude-sonnet-5+teacher");
  });
});

describe("share page and uninstall helpers", () => {
  it("renders markdown to a self-contained page", () => {
    const html = markdownToHtml("# T\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n```\ncode <b>\n```\n\nplain **bold** `c`");
    expect(html).toContain("<h1>T</h1>");
    expect(html).toContain("<li>a</li>");
    expect(html).toContain("<td>1</td>");
    expect(html).toContain("code &lt;b&gt;");
    expect(html).toContain("<strong>bold</strong>");
  });
  it("removeBlock strips only the marked block", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cs-"));
    const f = join(dir, "AGENTS.md");
    await (await import("node:fs/promises")).writeFile(f, "# mine\n\nkeep\n");
    await upsertBlock(f);
    expect(await removeBlock(f)).toBe(true);
    const after = await readFile(f, "utf8");
    expect(after).toContain("keep");
    expect(after).not.toContain("consensus:start");
    expect(await removeBlock(f)).toBe(false);
  });
});
