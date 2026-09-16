/**
 * Skill packs: the text that teaches an agent / IDE that consensus exists,
 * when to reach for it, and how to call it. One canonical SKILL.md (the
 * agentskills.io / Claude Code format) plus a Cursor rule and a plain rules
 * block for AGENTS.md / CLAUDE.md / Windsurf.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const SKILL_NAME = "consensus";

export const SKILL_MD = `---
name: consensus
description: Get a panel of independent frontier models (Claude, GPT, Grok, Gemini) to debate a hard question adversarially and return one answer they all signed off on, with confidence and unresolved disagreements. Use for high-stakes or ambiguous decisions - architecture and design choices, "which approach is best", security or data-model tradeoffs, plans before big refactors, debugging when stuck, or whenever the user says consensus, panel, second opinion, "ask the other models", "what would the other models say", or wants an answer they can trust more than one model's. Not for routine edits, lookups, or anything with an obvious answer.
---

# Consensus panel

\`consensus\` sends a self-contained problem to several frontier models at once. Each answers independently, then they critique each other with specific falsifiable disputes, concede or rebut every challenge, revise, and repeat until every panelist agrees. A judge writes the unified answer. You get back the answer, a confidence level, what the panel agreed on, and any disagreement that survived. Runs take minutes and cost real money (or subscription quota). Use it when being wrong is expensive.

## When to use

- The user asks for consensus, a panel, a second opinion, a debate, or "what do the other models think".
- You are about to commit to a design, architecture, schema, algorithm, or migration that is hard to reverse.
- Two reasonable approaches exist and you cannot confidently pick one.
- You have been stuck on a bug or a failing approach for more than a couple of attempts.
- A plan is large enough that a flawed premise would waste hours.

## When not to use

- Routine code changes, small questions, anything with a clear answer.
- Anything that needs live access to files, the repo, or the web: panelists see only what you put in the prompt.

## How to call it

Preferred: the MCP tool \`consensus\` (server name \`consensus\`). Arguments:
- \`prompt\` (required): the full problem, self-contained. State what a good answer must decide, and what "best" means here (speed, cost, simplicity, safety...).
- \`context\` (optional): the code, schema, constraints, error output, or prior attempts the panel needs. Paste it; do not describe it. Strip secrets.
- \`profile\` (optional): a named model profile, e.g. \`frontier\`, \`balanced\`, \`budget\`, \`perspectives\` (one model seated under several personas). Omit for the user's default; \`consensus_profiles\` lists them.
- \`panel\` (optional): explicit seats like \`["claude+skeptic", "codex:gpt-5.6-sol", "claude+security"]\` when the user asks for particular models or perspectives.
- \`rounds\` (optional, default 3) and \`effort\` (optional, low|medium|high|xhigh|max).

Two companion tools: \`consensus_design\` turns a plain-English brief ("4 panelists: security, distributed systems, a PM, a skeptic; frontier models") into a saved profile with personas and returns its name; \`consensus_profiles\` lists profiles and which vendors are connected (call it first if unsure). Runs take 1-4 minutes for small panels and 10+ for frontier profiles with 3 rounds; if your MCP client supports it, pass \`_meta.progressToken\` on the call to receive progress notifications (phase, seat done, converged) instead of silence.

Fallback if the MCP tool is not available: run the CLI and read stdout.

\`\`\`bash
consensus "<problem>" -c context.md            # or: cat problem.md | consensus -
consensus "<problem>" --profile frontier --rounds 2
consensus profiles                             # list model profiles
\`\`\`

## Writing a good panel prompt

- Give the problem, the constraints, and the success criteria in one message. The panel cannot ask follow-up questions.
- Include concrete material (actual code, actual error text, actual numbers). Vague prompts get vague consensus.
- Say what the user already tried and why it failed, so the panel does not re-propose it.
- Ask for a decision, not a survey: "Which should we do and why" beats "What are the options".

## Reading the result

- Treat "# Answer" as the recommendation. Check "# Confidence" and "# Unresolved disagreements" before acting: an open disagreement means the panel could not settle it, so surface it to the user rather than picking silently.
- Tell the user the panel was consulted, its confidence, and any dissent. Do not present a panel answer as your own.
- Every run is saved under \`.consensus/runs/<id>/\` with \`debate.md\` (the full debate: each answer, every critique and dispute, each concession or rebuttal, the synthesis). If the user wants to dig in, run \`consensus runs\` to list and \`consensus log [id]\` to read one.
`;

/** Cursor rule (.mdc): same content, Cursor frontmatter. */
export const CURSOR_RULE = `---
description: Consult the consensus panel (multiple frontier models debating) for high-stakes or ambiguous decisions, or when the user asks for consensus / a panel / a second opinion.
globs:
alwaysApply: false
---
${SKILL_MD.replace(/^---[\s\S]*?---\n/, "")}`;

const START = "<!-- consensus:start -->";
const END = "<!-- consensus:end -->";

/** Compact block for AGENTS.md / CLAUDE.md / Windsurf global rules. */
export const RULES_BLOCK = `${START}
## Consensus panel available

A \`consensus\` tool is installed (MCP server \`consensus\`, CLI \`consensus\`). It sends a self-contained problem to a panel of independent frontier models that debate adversarially until they agree, and returns one answer with confidence and unresolved disagreements. Use it for high-stakes or ambiguous decisions (architecture, design, hard tradeoffs, being stuck), or whenever the user asks for consensus, a panel, a second opinion, or "what do the other models think". Put the full problem in \`prompt\` and paste real code/errors/constraints in \`context\`; panelists cannot see files or the conversation. It is slow and costs money: not for routine work. Always report the panel's confidence and any dissent to the user.
${END}`;

/** Insert or replace the marked block in a markdown file, creating the file if needed. */
export async function upsertBlock(file: string, block: string = RULES_BLOCK): Promise<"created" | "updated" | "unchanged"> {
  let current = "";
  try {
    current = await readFile(file, "utf8");
  } catch {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, block + "\n");
    return "created";
  }
  const s = current.indexOf(START);
  const e = current.indexOf(END);
  if (s !== -1 && e !== -1) {
    const next = current.slice(0, s) + block + current.slice(e + END.length);
    if (next === current) return "unchanged";
    await writeFile(file, next);
    return "updated";
  }
  await writeFile(file, current.replace(/\s*$/, "\n\n") + block + "\n");
  return "updated";
}

/** Remove the marked block from a file; returns true if something was removed. */
export async function removeBlock(file: string): Promise<boolean> {
  let current: string;
  try {
    current = await readFile(file, "utf8");
  } catch {
    return false;
  }
  const s = current.indexOf(START);
  const e = current.indexOf(END);
  if (s === -1 || e === -1) return false;
  const next = (current.slice(0, s) + current.slice(e + END.length)).replace(/\n{3,}/g, "\n\n").replace(/^\s+$/, "");
  await writeFile(file, next);
  return true;
}

export async function writeSkill(dir: string, content: string = SKILL_MD): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = `${dir}/SKILL.md`;
  await writeFile(file, content);
  return file;
}
