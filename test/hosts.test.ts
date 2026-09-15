import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RULES_BLOCK, SKILL_MD, upsertBlock } from "../src/skillpack.js";
import { installProjectSkills, installProjectMcp } from "../src/hosts.js";

describe("skill packs", () => {
  it("SKILL.md has agentskills frontmatter and names the MCP tool", () => {
    expect(SKILL_MD.startsWith("---\nname: consensus\ndescription: ")).toBe(true);
    expect(SKILL_MD).toContain("MCP tool `consensus`");
    expect(SKILL_MD).toContain("Unresolved disagreements");
  });

  it("upsertBlock creates, updates idempotently, and preserves surrounding text", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cs-"));
    const f = join(dir, "AGENTS.md");
    expect(await upsertBlock(f)).toBe("created");
    expect(await upsertBlock(f)).toBe("unchanged");
    const before = "# My rules\n\nkeep me\n";
    await (await import("node:fs/promises")).writeFile(f, before);
    expect(await upsertBlock(f)).toBe("updated");
    const text = await readFile(f, "utf8");
    expect(text.startsWith(before.trimEnd())).toBe(true);
    expect(text.split("consensus:start")).toHaveLength(2);
    expect(await upsertBlock(f, RULES_BLOCK.replace("Consensus panel available", "Consensus panel v2"))).toBe("updated");
    expect((await readFile(f, "utf8")).split("consensus:start")).toHaveLength(2);
  });

  it("project install writes skills, cursor rule, AGENTS/CLAUDE blocks, and mcp json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cs-"));
    const files = await installProjectSkills(dir);
    expect(files.map((f) => f.slice(dir.length + 1)).sort()).toEqual(
      [".agents/skills/consensus/SKILL.md", ".claude/skills/consensus/SKILL.md", ".cursor/rules/consensus.mdc", ".gitignore", "AGENTS.md", "CLAUDE.md"].sort(),
    );
    expect(await readFile(join(dir, ".gitignore"), "utf8")).toContain(".consensus/");
    expect(await readFile(join(dir, ".cursor/rules/consensus.mdc"), "utf8")).toMatch(/^---\ndescription: /);
    await installProjectMcp(dir);
    const mcp = JSON.parse(await readFile(join(dir, ".mcp.json"), "utf8"));
    expect(mcp.mcpServers.consensus.args).toContain("mcp");
  });
});

describe("mcp json merge safety", () => {
  it("refuses to overwrite a config it cannot parse and backs up one it can", async () => {
    const { mkdtemp, readFile, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { installProjectMcp } = await import("../src/hosts.js");
    const dir = await mkdtemp(join(tmpdir(), "cs-"));
    await writeFile(join(dir, ".mcp.json"), '{ "mcpServers": { "github": { "command": "gh" } }, // comment\n}');
    await expect(installProjectMcp(dir)).rejects.toThrow(/not plain JSON/);
    expect(await readFile(join(dir, ".mcp.json"), "utf8")).toContain("github");
    await writeFile(join(dir, ".mcp.json"), '{ "mcpServers": { "github": { "command": "gh" } } }');
    await installProjectMcp(dir);
    const merged = JSON.parse(await readFile(join(dir, ".mcp.json"), "utf8"));
    expect(Object.keys(merged.mcpServers).sort()).toEqual(["consensus", "github"]);
    expect(await readFile(join(dir, ".mcp.json.bak"), "utf8")).toContain("github");
  });
});
