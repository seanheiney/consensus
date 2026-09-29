import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createRequire } from "node:module";
import { join } from "node:path";
import { answerSection } from "./bench.js";
import { OUTCOMES, recordOutcome, runProfile } from "./calibration.js";
import { describeCost, estimateCost } from "./cost.js";
import { loadConfig, resolveRun } from "./config.js";
import { credentialEnv, loadCredentials } from "./credentials.js";
import { openDebateLog } from "./debatelog.js";
import { scanVendors } from "./doctor.js";
import { describeProfile } from "./profiles.js";
import { ConsensusEngine } from "./protocol/engine.js";
import { runWithEscalation } from "./escalate.js";
import { isolationSummary } from "./providers/isolation.js";
import { cleanRooms } from "./providers/cleanroom.js";
import { renderReport } from "./report.js";
import { statusLine } from "./setup.js";
import { saveRun } from "./store.js";
import type { ConsensusEvent } from "./types.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

function progressMessage(e: ConsensusEvent): string | undefined {
  switch (e.type) {
    case "phase":
      return `${e.phase}${e.round ? ` (round ${e.round})` : ""}`;
    case "panelist:done":
      return `${e.phase}: ${e.panelist} done (${(e.ms / 1000).toFixed(0)}s)`;
    case "panelist:error":
      return `${e.panelist} failed: ${e.error}`;
    case "converged":
      return `converged in round ${e.round}`;
    case "not-converged":
      return `${e.openDisputes} disputes open after round ${e.round}`;
    default:
      return undefined;
  }
}

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "consensus", version });

  server.registerTool(
    "consensus",
    {
      title: "Panel consensus",
      description:
        "Send a hard question, design decision, or plan to a panel of independent frontier models (Claude, GPT, Grok, Gemini, ...). " +
        "They answer independently, critique each other adversarially, revise, and repeat until they agree. " +
        "Returns the panel's answer, confidence, unresolved disagreements, and where the full debate was saved. " +
        "Slow: typically 1-4 minutes for 2-3 seats and one round, up to 10+ minutes for frontier profiles with 3 rounds; set client timeouts accordingly (progress notifications with a total are sent when the client passes a progressToken). " +
        "It spends money or the user's own subscription quota (Claude Code / Codex rate limits): call it for decisions that matter, tell the user, and pass `max_cost` / `max_spend` when in doubt. " +
        "Put everything the panel needs in `prompt` and `context`; panelists cannot read files or the conversation.",
      inputSchema: {
        prompt: z.string().describe("The problem or question, fully self-contained."),
        context: z.string().optional().describe("Supporting material: relevant code, constraints, prior attempts, requirements. Paste, don't describe."),
        profile: z.string().optional().describe("Named model profile (see consensus_profiles). Omit for the user's default."),
        panel: z.array(z.string()).optional().describe("Override the panel with seats like 'claude', 'codex:gpt-5.6-sol', 'openai:gpt-6-astra#max', 'claude+skeptic'."),
        rounds: z.number().int().min(1).max(10).optional().describe("Max critique/revise rounds (default from profile, else 3). 1 = critique only, no revision."),
        effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional().describe("Reasoning effort for seats without their own."),
        transcript: z.boolean().optional().describe("Return the full report and debate transcript instead of the short summary."),
        max_cost: z.number().positive().optional().describe("Abort once spend billed to API keys exceeds this many USD (default from the user's config)."),
        max_spend: z.number().positive().optional().describe("Abort once billed spend plus the list-price equivalent of subscription seats exceeds this many USD."),
        captain: z.string().optional().describe("Captain spec, 'auto' (default: best available model, as a separate thread even if a seat uses it), 'neutral' (prefer a vendor not on the panel) or 'none'. The captain moderates each round, referees disputes, facilitates, and writes the report."),
        variants: z.number().int().min(2).max(8).optional().describe("Opt-in: seat the panel's model(s) this many times, each under a different reasoning angle. Lets one vendor hold a real debate; cheap and fast with a small model."),
        task: z.enum(["code-review", "architecture", "debug", "security", "product", "estimate"]).optional().describe("Opt-in: seat the angles that suit this kind of work (also sets a sensible round count)."),
        escalate_to: z.string().optional().describe("Opt-in: answer with the chosen panel first and, only if that leaves the question unsettled, re-run with this (stronger) profile seeded with the first answer. Cheap by default, expensive only when it matters."),
        escalate_when: z.enum(["unsettled", "disputed", "always"]).optional().describe("When to promote (default 'unsettled': not converged, disputes left open, or confidence below high)."),
        verify: z.boolean().optional().describe("Opt-in: after the report, check its load-bearing claims against the prompt and context you supplied, and return which ones that material does not establish. Useful when the panel is reasoning over pasted code or docs."),
      },
      annotations: { title: "Panel consensus", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ prompt, context, profile, panel, rounds, effort, transcript, max_cost, max_spend, captain, variants, task, escalate_to, escalate_when, verify }, extra) => {
      const cfg = await loadConfig();
      const r = await resolveRun({ cfg, panel, profile, rounds, effort, captain, variants, task, env: credentialEnv() });
      const runsDir = cfg.runsDir ?? ".consensus/runs";
      const token = extra._meta?.progressToken;
      let debate: Awaited<ReturnType<typeof openDebateLog>> | undefined;
      let pending: ConsensusEvent[] = [];
      let step = 0;
      // phases + per-seat completions: a rough total so hosts can draw a bar, not just a spinner
      const total = 1 + r.rounds * 2 + 1 + r.panel.length * (1 + 2 * r.rounds) + 2;
      const onEvent = (e: ConsensusEvent): void => {
        if (e.type === "start") {
          pending.push(e);
          openDebateLog(join(runsDir, e.runId)).then((d) => {
            debate = d;
            for (const p of pending) d.onEvent(p);
            pending = [];
          });
        } else if (debate) debate.onEvent(e);
        else pending.push(e);
        const msg = progressMessage(e);
        if (msg && token !== undefined) {
          step++;
          void extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: Math.min(step, total - 1), total, message: msg } }).catch(() => undefined);
        }
      };
      const runOnce = (resolved: typeof r, p: string, c: string | undefined): Promise<import("./types.js").ConsensusRun> => {
        const engine = new ConsensusEngine({ panel: resolved.panel, judge: resolved.judge, captain: resolved.captain, rounds: resolved.rounds, effort: resolved.effort, maxTokens: cfg.maxTokens, maxCostUsd: max_cost ?? cfg.maxCostUsd, maxSpendUsd: max_spend ?? cfg.maxSpendUsd, verify: !!verify, onEvent, signal: extra.signal });
        return engine.run(p, c);
      };
      let run: import("./types.js").ConsensusRun;
      try {
        run = escalate_to
          ? await runWithEscalation({
              first: r,
              when: escalate_when,
              prompt,
              context,
              resolveTarget: () => resolveRun({ cfg, profile: escalate_to, captain, effort, env: credentialEnv() }),
              onFirstPass: async (first) => {
                await debate?.close();
                first.profile ??= r.profile;
                debate = undefined;
                pending = [];
                await saveRun(first, runsDir).catch(() => "");
              },
              runOnce: (resolved, p, c) => runOnce(resolved, p, c),
            })
          : await runOnce(r, prompt, context);
      } catch (err) {
        await debate?.close();
        const partial = (err as { partial?: import("./types.js").ConsensusRun }).partial;
        const reason = (err as Error).message.split("\n")[0];
        if (partial) {
          partial.synthesis = `(no synthesis: ${reason})`;
          const dir = await saveRun(partial, runsDir).catch(() => "");
          return { isError: true, content: [{ type: "text" as const, text: `${(err as Error).message}${dir ? `\nPartial debate saved (completed turns, dropped seats, usage): ${dir}/debate.md` : ""}` }] };
        }
        throw err;
      }
      await debate?.close();
      let saved = "";
      run.profile ??= runProfile(run, r.profile, escalate_to);
      try {
        saved = await saveRun(run, runsDir);
      } catch {
        /* best-effort */
      }
      if (transcript) {
        return { content: [{ type: "text", text: renderReport(run, { transcript: true }) + (saved ? `\n\n_Saved to ${saved}_` : "") }] };
      }
      const cost = estimateCost(run.usage);
      const structured = /^# Answer/m.test(run.synthesis) && /^# Confidence/m.test(run.synthesis);
      if (!structured) {
        const text = `${run.synthesis}\n\n---\n(The judge did not use the expected sections; the full synthesis is shown above.)\nPanel: ${run.seats.map((s) => s.id).join(", ")}. ${run.converged ? "Converged." : "Did not fully converge."}${saved ? ` Full debate: ${saved}/debate.md` : ""}`;
        return { content: [{ type: "text", text }] };
      }
      const unresolved = run.synthesis.match(/# Unresolved disagreements\s*\n([\s\S]*?)(?=\n# |$)/)?.[1]?.trim() ?? "";
      const confidence = run.synthesis.match(/# Confidence\s*\n([\s\S]*?)(?=\n# |$)/)?.[1]?.trim() ?? "";
      const seats = run.seats.map((s) => `${s.id}${s.effort ? `#${s.effort}` : ""}`).join(", ");
      const summary = [
        `# Answer\n\n${answerSection(run.synthesis)}`,
        `# Confidence\n\n${confidence || "(not stated)"}`,
        `# Unresolved disagreements\n\n${unresolved || "(none stated)"}`,
        `---`,
        run.escalation ? `Escalated from ${run.escalation.fromSeats.join(", ")} because ${run.escalation.reason} (first pass: run ${run.escalation.fromRunId}).` : "",
        `Panel: ${seats}.${run.captain ? ` Captain: ${run.captain}.` : ""} ${run.converged ? `Converged after ${run.rounds.length} round(s).` : `Did not fully converge after ${run.rounds.length} round(s).`}${Object.keys(run.dropped).length ? ` Dropped: ${Object.keys(run.dropped).join(", ")}.` : ""}`,
        `Cost: ${describeCost(cost)}.`,
        run.verification ? `Grounding check: ${run.verification.claims.filter((c) => c.support === "supported").length}/${run.verification.claims.length} load-bearing claims are established by the material you supplied; ${run.verification.claims.filter((c) => c.support === "contradicted").length} contradicted. Full list in the report.` : "",
        (run.cleanRooms ?? cleanRooms(run.isolation))?.line ?? "",
        isolationSummary(run.isolation) ?? "",
        saved ? `Full debate: ${saved}/debate.md  (or \`consensus log ${run.id}\`). Call again with transcript=true for the whole report.` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      return { content: [{ type: "text", text: summary }] };
    },
  );

  // A separate tool rather than a mode of `consensus`: that tool's description promises a slow, costly debate and
  // most of its arguments (rounds, transcript, verify, escalation) mean nothing here. Hosts pick tools by description.
  server.registerTool(
    "consensus_check",
    {
      title: "Quick disagreement check",
      description:
        "Fast 'should a human look at this?' signal. Every panel model answers the question once, independently, with a short answer and a one-line rationale; " +
        "one cheap step groups the answers into positions. No debate. Returns the agreement level (unanimous / majority / split), who holds each position, and 'needs human: yes|no'. " +
        "Use it before acting on a judgment call, or to decide whether a full `consensus` debate is worth its cost: disagreement between independent models is a cheap uncertainty signal. " +
        "Agreement is not proof of correctness. Costs one call per seat plus at most one comparison call. Put everything the models need in `prompt` and `context`.",
      inputSchema: {
        prompt: z.string().describe("The question, fully self-contained. Works best when it has a short answer: a choice, a verdict, a number."),
        context: z.string().optional().describe("Supporting material: code, diff, constraints. Paste, don't describe."),
        profile: z.string().optional().describe("Named model profile (see consensus_profiles). Omit for the user's default."),
        panel: z.array(z.string()).optional().describe("Override the panel with seats like 'claude', 'codex:gpt-5.6-sol', 'claude+skeptic'."),
        variants: z.number().int().min(2).max(8).optional().describe("Seat the panel's model(s) this many times under different reasoning angles."),
        task: z.enum(["code-review", "architecture", "debug", "security", "product", "estimate"]).optional().describe("Seat the angles that suit this kind of work."),
        effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional().describe("Reasoning effort for seats without their own."),
        captain: z.string().optional().describe("Who groups differing answers: a spec, 'auto' (default), 'neutral' or 'none' (plain comparison, unless an external judge is configured)."),
        max_cost: z.number().positive().optional().describe("Skip the comparison call once spend billed to API keys exceeds this many USD."),
      },
      annotations: { title: "Quick disagreement check", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ prompt, context, profile, panel, variants, task, effort, captain, max_cost }, extra) => {
      const { renderCheck, runCheck } = await import("./check.js");
      const cfg = await loadConfig();
      const r = await resolveRun({ cfg, panel, profile, effort, captain, variants, task, env: credentialEnv() });
      const comparer = r.captain ?? (r.panel.some((x) => x.id === r.judge.id) ? undefined : r.judge);
      const token = extra._meta?.progressToken;
      const total = r.panel.length + 1;
      let step = 0;
      const result = await runCheck(prompt, context, {
        panel: r.panel,
        comparer,
        effort: r.effort,
        maxTokens: cfg.maxTokens,
        maxCostUsd: max_cost ?? cfg.maxCostUsd,
        signal: extra.signal,
        onEvent: (e) => {
          if (token === undefined) return;
          const message = e.type === "seat:done" ? `${e.seat} answered` : e.type === "seat:error" ? `${e.seat} failed: ${e.error}` : `${e.by} is grouping the answers`;
          void extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: Math.min(++step, total - 1), total, message } }).catch(() => undefined);
        },
      });
      return { content: [{ type: "text" as const, text: renderCheck(result) }] };
    },
  );

  server.registerTool(
    "consensus_design",
    {
      title: "Design a panel from a brief",
      description: "Turn a plain-English brief (how many panelists, what expertise, frontier or commodity models, rounds) into a saved profile with personas, seated across the user's connected vendors. Returns the profile name to pass to `consensus`.",
      inputSchema: {
        brief: z.string().describe("e.g. '5 panelists: a security expert, a distributed-systems engineer, a PM, a skeptic; frontier models; 3 rounds'"),
        name: z.string().optional().describe("Profile name; default chosen by the designer."),
        overwrite: z.boolean().optional().describe("Replace an existing profile of the same name (default: a numbered name is chosen instead)."),
      },
      annotations: { title: "Design a panel", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ brief, name, overwrite }) => {
      const { askDesigner, materializeDesign, TIER_WORDS } = await import("./designer.js");
      const { autoDetectSpecs, loadUserConfig, saveUserConfig } = await import("./config.js");
      const { createPanelist } = await import("./providers/index.js");
      const statuses = await scanVendors(credentialEnv());
      const specs = await autoDetectSpecs(credentialEnv());
      if (!specs.length) return { content: [{ type: "text", text: "No connected model to design with; run `consensus setup`." }] };
      let tier: import("./catalog.js").Tier | undefined;
      for (const [w, t] of Object.entries(TIER_WORDS)) if (!tier && new RegExp(`\\b${w}\\b`, "i").test(brief)) tier = t;
      const design = await askDesigner(createPanelist(specs[0]!, { effort: "medium", env: credentialEnv() }), brief, statuses, tier);
      const built = materializeDesign(design, statuses);
      if (built.profile.panel.length < 2) return { content: [{ type: "text", text: `Could not seat the panel: ${built.unseated.join("; ")}` }] };
      const cfg = await loadUserConfig();
      let profileName = name ?? built.name;
      if (cfg.profiles?.[profileName] && !overwrite) {
        let n = 2;
        while (cfg.profiles[`${profileName}-${n}`]) n++;
        profileName = `${profileName}-${n}`;
      }
      cfg.personas = { ...cfg.personas, ...built.personas };
      cfg.profiles = { ...cfg.profiles, [profileName]: built.profile };
      await saveUserConfig(cfg);
      const notes = built.unseated.filter((u) => u.startsWith("note:"));
      const missing = built.unseated.filter((u) => !u.startsWith("note:"));
      return { content: [{ type: "text", text: `Saved profile "${profileName}" (${design.description}).\nSeats:\n${built.seatsExplained.map((s) => `- ${s}`).join("\n")}\nJudge: ${built.profile.judge}; rounds: ${built.profile.rounds}.${missing.length ? `\nNot seated: ${missing.join("; ")}` : ""}${notes.length ? `\n${notes.join("\n")} (see consensus_profiles for connections)` : ""}\n${design.rationale}\nUse it: call consensus with profile="${profileName}".` }] };
    },
  );

  server.registerTool(
    "consensus_profiles",
    {
      title: "List consensus profiles and connections",
      description: "List the user's model profiles (which models sit on the panel for each) and which vendors are connected. Cheap; call before a long consensus run.",
      inputSchema: {},
      annotations: { title: "List profiles", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const cfg = await loadConfig();
      const names = Object.keys(cfg.profiles ?? {});
      const profiles = names.length ? names.map((n) => describeProfile(n, cfg.profiles![n]!, n === cfg.profile)).join("\n") : "No profiles defined (auto-detect is used).";
      const statuses = await scanVendors(credentialEnv());
      return { content: [{ type: "text", text: `Profiles (* = default):\n${profiles}\n\nConnections:\n${statuses.map(statusLine).join("\n")}` }] };
    },
  );

  server.registerTool(
    "consensus_outcome",
    {
      title: "Record how a panel decision turned out",
      description: "When the user says how a decision backed by a consensus run actually went, record it against that run (right, wrong or partial). Outcomes feed `consensus calibration`, which shows whether the panel's stated confidence can be trusted. Re-recording replaces the verdict and keeps the old one in history.",
      inputSchema: {
        run_id: z.string().describe("Run id from the consensus result ('Full debate: .consensus/runs/<id>/...') or 'latest'."),
        outcome: z.enum(OUTCOMES).describe("right: the panel's answer held up; wrong: it did not; partial: some of it did."),
        note: z.string().optional().describe("One sentence on what happened, in the user's words."),
      },
      annotations: { title: "Record outcome", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ run_id, outcome, note }) => {
      try {
        const cfg = await loadConfig();
        const { record, previous } = await recordOutcome(run_id, outcome, { note, dir: cfg.runsDir });
        return { content: [{ type: "text" as const, text: `Recorded ${record.outcome} for run ${record.runId}${previous ? ` (replacing ${previous.outcome}; the earlier verdict stays in history)` : ""}. \`consensus calibration\` shows how the panel's confidence has held up.` }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text" as const, text: (err as Error).message }] };
      }
    },
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  await loadCredentials();
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}
