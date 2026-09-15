import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createRequire } from "node:module";
import { join } from "node:path";
import { answerSection, estimateCost } from "./bench.js";
import { loadConfig, resolveRun } from "./config.js";
import { credentialEnv, loadCredentials } from "./credentials.js";
import { openDebateLog } from "./debatelog.js";
import { scanVendors } from "./doctor.js";
import { describeProfile } from "./profiles.js";
import { ConsensusEngine } from "./protocol/engine.js";
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
            "Slow: typically 1-4 minutes for 2-3 seats and one round, up to 10+ minutes for frontier profiles with 3 rounds; set client timeouts accordingly (progress notifications are sent when the client passes a progressToken). " +
            "Put everything the panel needs in `prompt` and `context`; panelists cannot read files or the conversation.",
        inputSchema: {
            prompt: z.string().describe("The problem or question, fully self-contained."),
            context: z.string().optional().describe("Supporting material: relevant code, constraints, prior attempts, requirements. Paste, don't describe."),
            profile: z.string().optional().describe("Named model profile (see consensus_profiles). Omit for the user's default."),
            panel: z.array(z.string()).optional().describe("Override the panel with seats like 'claude', 'codex:gpt-5.6-sol', 'openai:gpt-6-astra#max', 'claude+skeptic'."),
            rounds: z.number().int().min(1).max(10).optional().describe("Max critique/revise rounds (default from profile, else 3). 1 = critique only, no revision."),
            effort: z.enum(["low", "medium", "high", "max"]).optional().describe("Reasoning effort for seats without their own."),
            transcript: z.boolean().optional().describe("Return the full report and debate transcript instead of the short summary."),
        },
    }, async ({ prompt, context, profile, panel, rounds, effort, transcript }, extra) => {
        const cfg = await loadConfig();
        const r = await resolveRun({ cfg, panel, profile, rounds, effort, env: credentialEnv() });
        const runsDir = cfg.runsDir ?? ".consensus/runs";
        const token = extra._meta?.progressToken;
        let debate;
        let pending = [];
        let step = 0;
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
                void extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: step, message: msg } }).catch(() => undefined);
            }
        };
        const engine = new ConsensusEngine({ panel: r.panel, judge: r.judge, rounds: r.rounds, effort: r.effort, maxTokens: cfg.maxTokens, onEvent, signal: extra.signal });
        const run = await engine.run(prompt, context);
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
            `Panel: ${seats}. ${run.converged ? `Converged after ${run.rounds.length} round(s).` : `Did not fully converge after ${run.rounds.length} round(s).`}${Object.keys(run.dropped).length ? ` Dropped: ${Object.keys(run.dropped).join(", ")}.` : ""}`,
            `Cost: ${cost.usd !== null ? `~$${cost.usd.toFixed(2)} at API list price` : "n/a"}${cost.unpriced.length ? ` (subscription seats not priced: ${cost.unpriced.join(", ")})` : ""}.`,
            saved ? `Full debate: ${saved}/debate.md  (or \`consensus log ${run.id}\`). Call again with transcript=true for the whole report.` : "",
        ]
            .filter(Boolean)
            .join("\n\n");
        return { content: [{ type: "text", text: summary }] };
    });
    server.registerTool("consensus_profiles", {
        title: "List consensus profiles and connections",
        description: "List the user's model profiles (which models sit on the panel for each) and which vendors are connected. Cheap; call before a long consensus run.",
        inputSchema: {},
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
