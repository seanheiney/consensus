import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createRequire } from "node:module";
import { join } from "node:path";
import { answerSection } from "./bench.js";
import { describeCost, estimateCost } from "./cost.js";
import { loadConfig, resolveRun } from "./config.js";
import { credentialEnv, loadCredentials } from "./credentials.js";
import { openDebateLog } from "./debatelog.js";
import { scanVendors } from "./doctor.js";
import { describeProfile } from "./profiles.js";
import { ConsensusEngine } from "./protocol/engine.js";
import { isolationSummary } from "./providers/isolation.js";
import { renderReport } from "./report.js";
import { statusLine } from "./setup.js";
import { saveRun } from "./store.js";
const require = createRequire(import.meta.url);
const { version } = require("../package.json");
function progressMessage(e) {
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
export function createMcpServer() {
    const server = new McpServer({ name: "consensus", version });
    server.registerTool("consensus", {
        title: "Panel consensus",
        description: "Send a hard question, design decision, or plan to a panel of independent frontier models (Claude, GPT, Grok, Gemini, ...). " +
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
        },
        annotations: { title: "Panel consensus", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, async ({ prompt, context, profile, panel, rounds, effort, transcript, max_cost, max_spend, captain }, extra) => {
        const cfg = await loadConfig();
        const r = await resolveRun({ cfg, panel, profile, rounds, effort, captain, env: credentialEnv() });
        const runsDir = cfg.runsDir ?? ".consensus/runs";
        const token = extra._meta?.progressToken;
        let debate;
        let pending = [];
        let step = 0;
        // phases + per-seat completions: a rough total so hosts can draw a bar, not just a spinner
        const total = 1 + r.rounds * 2 + 1 + r.panel.length * (1 + 2 * r.rounds) + 2;
        const onEvent = (e) => {
            if (e.type === "start") {
                pending.push(e);
                openDebateLog(join(runsDir, e.runId)).then((d) => {
                    debate = d;
                    for (const p of pending)
                        d.onEvent(p);
                    pending = [];
                });
            }
            else if (debate)
                debate.onEvent(e);
            else
                pending.push(e);
            const msg = progressMessage(e);
            if (msg && token !== undefined) {
                step++;
                void extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: Math.min(step, total - 1), total, message: msg } }).catch(() => undefined);
            }
        };
        const engine = new ConsensusEngine({ panel: r.panel, judge: r.judge, captain: r.captain, rounds: r.rounds, effort: r.effort, maxTokens: cfg.maxTokens, maxCostUsd: max_cost ?? cfg.maxCostUsd, maxSpendUsd: max_spend ?? cfg.maxSpendUsd, onEvent, signal: extra.signal });
        let run;
        try {
            run = await engine.run(prompt, context);
        }
        catch (err) {
            await debate?.close();
            const partial = err.partial;
            const reason = err.message.split("\n")[0];
            if (partial) {
                partial.synthesis = `(no synthesis: ${reason})`;
                const dir = await saveRun(partial, runsDir).catch(() => "");
                return { isError: true, content: [{ type: "text", text: `${err.message}${dir ? `\nPartial debate saved (completed turns, dropped seats, usage): ${dir}/debate.md` : ""}` }] };
            }
            throw err;
        }
        await debate?.close();
        let saved = "";
        try {
            saved = await saveRun(run, runsDir);
        }
        catch {
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
            `Panel: ${seats}.${run.captain ? ` Captain: ${run.captain}.` : ""} ${run.converged ? `Converged after ${run.rounds.length} round(s).` : `Did not fully converge after ${run.rounds.length} round(s).`}${Object.keys(run.dropped).length ? ` Dropped: ${Object.keys(run.dropped).join(", ")}.` : ""}`,
            `Cost: ${describeCost(cost)}.`,
            isolationSummary(run.isolation) ?? "",
            saved ? `Full debate: ${saved}/debate.md  (or \`consensus log ${run.id}\`). Call again with transcript=true for the whole report.` : "",
        ]
            .filter(Boolean)
            .join("\n\n");
        return { content: [{ type: "text", text: summary }] };
    });
    server.registerTool("consensus_design", {
        title: "Design a panel from a brief",
        description: "Turn a plain-English brief (how many panelists, what expertise, frontier or commodity models, rounds) into a saved profile with personas, seated across the user's connected vendors. Returns the profile name to pass to `consensus`.",
        inputSchema: {
            brief: z.string().describe("e.g. '5 panelists: a security expert, a distributed-systems engineer, a PM, a skeptic; frontier models; 3 rounds'"),
            name: z.string().optional().describe("Profile name; default chosen by the designer."),
            overwrite: z.boolean().optional().describe("Replace an existing profile of the same name (default: a numbered name is chosen instead)."),
        },
        annotations: { title: "Design a panel", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, async ({ brief, name, overwrite }) => {
        const { askDesigner, materializeDesign, TIER_WORDS } = await import("./designer.js");
        const { autoDetectSpecs, loadUserConfig, saveUserConfig } = await import("./config.js");
        const { createPanelist } = await import("./providers/index.js");
        const statuses = await scanVendors(credentialEnv());
        const specs = await autoDetectSpecs(credentialEnv());
        if (!specs.length)
            return { content: [{ type: "text", text: "No connected model to design with; run `consensus setup`." }] };
        let tier;
        for (const [w, t] of Object.entries(TIER_WORDS))
            if (!tier && new RegExp(`\\b${w}\\b`, "i").test(brief))
                tier = t;
        const design = await askDesigner(createPanelist(specs[0], { effort: "medium", env: credentialEnv() }), brief, statuses, tier);
        const built = materializeDesign(design, statuses);
        if (built.profile.panel.length < 2)
            return { content: [{ type: "text", text: `Could not seat the panel: ${built.unseated.join("; ")}` }] };
        const cfg = await loadUserConfig();
        let profileName = name ?? built.name;
        if (cfg.profiles?.[profileName] && !overwrite) {
            let n = 2;
            while (cfg.profiles[`${profileName}-${n}`])
                n++;
            profileName = `${profileName}-${n}`;
        }
        cfg.personas = { ...cfg.personas, ...built.personas };
        cfg.profiles = { ...cfg.profiles, [profileName]: built.profile };
        await saveUserConfig(cfg);
        const notes = built.unseated.filter((u) => u.startsWith("note:"));
        const missing = built.unseated.filter((u) => !u.startsWith("note:"));
        return { content: [{ type: "text", text: `Saved profile "${profileName}" (${design.description}).\nSeats:\n${built.seatsExplained.map((s) => `- ${s}`).join("\n")}\nJudge: ${built.profile.judge}; rounds: ${built.profile.rounds}.${missing.length ? `\nNot seated: ${missing.join("; ")}` : ""}${notes.length ? `\n${notes.join("\n")} (see consensus_profiles for connections)` : ""}\n${design.rationale}\nUse it: call consensus with profile="${profileName}".` }] };
    });
    server.registerTool("consensus_profiles", {
        title: "List consensus profiles and connections",
        description: "List the user's model profiles (which models sit on the panel for each) and which vendors are connected. Cheap; call before a long consensus run.",
        inputSchema: {},
        annotations: { title: "List profiles", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async () => {
        const cfg = await loadConfig();
        const names = Object.keys(cfg.profiles ?? {});
        const profiles = names.length ? names.map((n) => describeProfile(n, cfg.profiles[n], n === cfg.profile)).join("\n") : "No profiles defined (auto-detect is used).";
        const statuses = await scanVendors(credentialEnv());
        return { content: [{ type: "text", text: `Profiles (* = default):\n${profiles}\n\nConnections:\n${statuses.map(statusLine).join("\n")}` }] };
    });
    return server;
}
export async function startMcpServer() {
    await loadCredentials();
    const server = createMcpServer();
    await server.connect(new StdioServerTransport());
}
