# consensus

Throw a problem at a panel of frontier models. They answer independently, tear each other's answers apart, revise, and repeat until they agree. You get one answer the whole panel signed off on, with the disagreements that survived laid out honestly.

Works with the **subscriptions you already pay for** (Claude Pro/Max, ChatGPT Plus/Pro, SuperGrok, Google) or with API keys. Runs as a **CLI**, an **MCP server**, and a **library**, and installs a **skill pack** into your IDEs and agents so they know it's there and when to reach for it.

```
$ consensus "Optimistic locking or a distributed lock for inventory holds?"

panel (balanced): claude:claude-opus-5, codex:gpt-5.6-sol, grok:grok-4.5, gemini:gemini-3.8-flash
▶ propose
  ✓ A claude:claude-opus-5  41.2s
  ✓ B codex:gpt-5.6-sol  38.7s
  ...
▶ critique (round 1)
  4 disputes open after round 1
▶ revise (round 1)
▶ critique (round 2)
  panel converged in round 2
▶ synthesize
```

## Install

One line, nothing else needed (installs Node 22+ if you don't have it, then the CLI, then walks you through setup and a first debate):

```bash
curl -fsSL https://raw.githubusercontent.com/seanheiney/consensus/main/install.sh | sh
```

Non-interactive: `curl -fsSL … | sh -s -- --yes`. Windows: `irm https://raw.githubusercontent.com/seanheiney/consensus/main/install.ps1 | iex`.

With Node 22+ already installed, this is the equivalent by hand (the npm package is not released yet, so install from the repo tarball):

```bash
npm install -g https://github.com/seanheiney/consensus/archive/refs/heads/main.tar.gz && consensus setup
```

`consensus setup` does everything:

1. **Finds your accounts.** It looks for the vendor CLIs you already use (Claude Code, Codex, Gemini CLI, Grok) and whether they're logged in, plus any API keys. For anything missing it offers to log you in through the vendor's own CLI, install that CLI, or store an API key (`~/.config/consensus/credentials.json`, mode 600). Your subscription auth stays inside the vendor's CLI; consensus never sees a token.
2. **Builds model profiles** from what's connected (see below) and asks which should be the default.
3. **Teaches your tools.** It registers the MCP server and drops a skill pack into every IDE and agent it finds: Claude Code, Codex, Gemini CLI, Grok, Cursor, Windsurf, Claude Desktop, and the cross-tool `~/.agents/skills` directory that Copilot and others read. After that your agent knows a consensus panel exists, when to use it, and how to write a good prompt for it.
4. **Runs a first debate** on a sample problem so you see a real result and where the log lives (also under `--yes`; skip with `--no-first-run`).

`consensus setup --yes` does all of that with no questions. `consensus doctor --probe` shows what's connected and makes one tiny call through each to prove it.

## How your subscriptions are used

| Vendor | Subscription path | API key path |
|---|---|---|
| Anthropic | `claude` (Claude Code) logged in with Claude Pro/Max | `ANTHROPIC_API_KEY` |
| OpenAI | `codex` logged in with ChatGPT Plus/Pro | `OPENAI_API_KEY` |
| xAI | `grok` CLI logged in | `XAI_API_KEY` |
| Google | `gemini` CLI (Google retired the free individual login; use a key) | `GEMINI_API_KEY` |
| OpenRouter | — | `OPENROUTER_API_KEY` |

**One OpenRouter key covers everything you haven't connected directly.** Presets, auto-detect, and the profile picker route any unconnected vendor through OpenRouter using verified ids (`openrouter:x-ai/grok-4.6`, `openrouter:google/gemini-3.1-pro-preview`, ...), and always prefer a direct subscription or key when you have one.

Subscription-backed seats are the vendor CLI run headless in an empty temp directory as a clean room: Claude Code with `--tools ""`, `--safe-mode` and no MCP servers; Codex with `--ignore-user-config`, `--ignore-rules`, its shell, browser, computer-use and app tools disabled, no MCP servers and a read-only sandbox; Gemini in plan mode with no MCP servers. They see only the prompt you give them, not your files, CLAUDE.md, AGENTS.md, or your other MCP servers (including consensus itself). When both a logged-in CLI and a key exist, the CLI is preferred (no per-token bill). **Read this before relying on subscription seats:** every seat call spends the same rate limits as your interactive use of that CLI (Claude Code's rolling 5-hour and weekly caps, Codex's ChatGPT limits), a three-round frontier debate can consume a meaningful slice of a daily cap, and vendors' terms govern this use. Anthropic's published terms restrict third-party products from offering or relying on claude.ai logins without approval; consensus is a local tool you run on your own machine under your own login, not a hosted service, but it is your responsibility to check your plan's terms, and you should use API keys for anything shared, automated, or run on someone else's behalf. Keys saved by `setup` are handed only to the matching API client and never exported into the environment of a vendor CLI, so a saved key cannot silently move your subscription CLI onto per-token billing. OpenRouter, Ollama, and any OpenAI-compatible endpoint (`compat:<model>@<url>`) also work.

## Profiles

A profile is a named panel: which models, at what reasoning effort, who judges, how many rounds. Switch per run with `--profile`, or set a default.

```bash
consensus profiles                      # list yours (* = default)
consensus profile presets               # built-in presets your connections can satisfy
consensus profile create --preset deep  # materialize a preset
consensus profile create mine           # interactive model picker with prices
consensus profile use frontier          # set the default
consensus "..." --profile budget        # one-off
```

Built-in presets (created by `setup` when your connections allow):

| Preset | Panel | Effort | Rounds |
|---|---|---|---|
| `frontier` | best model per connected vendor (Fable 5.1, GPT-6 Astra, Grok 4.6, Gemini 3.1 Pro) | max | 3 |
| `balanced` | Opus 5, GPT-5.6 Sol, Grok 4.5, Gemini 3.8 Flash | high | 3 |
| `budget` | Haiku 4.5, GPT-5.6 Luna, Grok 4.3, Gemini 3.5 Flash Lite | medium | 2 |
| `fast` | same as budget | low | 1 |
| `deep` | same as frontier | max | 5 |
| `claude-family`, `gpt-family`, `gemini-family`, `grok-family` | every model of one vendor debating each other; works with a single subscription | high | 3 |

Panelist specs are `provider[:model][#effort][+persona]`, so a profile can mix anything: `claude:claude-fable-5-1#max`, `codex:gpt-5.6-sol#high`, `xai:grok-4.6`, `ollama:qwen3#low`, `claude:claude-opus-5+skeptic`. A seat written as `any:<model>` (for example `any:claude-opus-5#high+skeptic`) is portable: it is routed at run time to whatever you have for that vendor, and the run fails loudly if nothing can seat it.

## Packs: share a panel

A pack is one JSON file with profiles, the personas they use, and optionally a bench suite that shows what it is good for. Seats are portable, so a pack resolves to your connections.

```bash
consensus pack list                              # installed, plus the packs shipped with consensus
consensus pack add security-council              # shipped pack: attacker vs defender vs pragmatist vs generalist
consensus pack add startup-advisors              # economist, operator, skeptic, user advocate on one Claude seat
consensus pack add product-review                # the expert review panel that validated consensus itself (6 archetypes + verifier)
consensus pack add <owner>/<repo>                # consensus-pack.json at the root of any GitHub repo
consensus pack add ./my-pack.json                # a file or URL
consensus pack create my-council -p frontier,perspectives   # bundle what you built
```

`pack add` prints everything it would install, including every persona's full text (a persona is an instruction your models will follow on your quota), then asks. It never overwrites your own profiles or personas: a name clash is installed as `<pack>/<name>`. See `PACKS.md` for publishing yours.

For a team, `consensus init --from-profile <name>` freezes a profile into a committed `consensus.config.json` (and gitignores `.consensus/`), so everyone in the repo gets the same panel.

## Personas: many seats, any models

A seat on the panel is a model **plus an optional preprompt**. That means a panel can be:

- many models, no personas (the default presets),
- **one model seated several times under different personas** (the `perspectives` preset: Fable 5.1 as first-principles, skeptic, pragmatist, security reviewer, and user advocate, debating each other),
- many models each with the same persona, or each with its own.

Different preprompts change the answer, so the same model under five perspectives is a real panel, and it works with a single subscription.

```bash
consensus personas                                   # built-in: first-principles, skeptic, pragmatist, security,
                                                     #   performance, user-advocate, maintainer, economist, contrarian, teacher
consensus "..." --panel "claude+skeptic,claude+pragmatist,codex+security"
consensus profile create council                     # the picker asks: no personas / same set on every model / per model
```

Your own personas go in `~/.config/consensus/config.json` and are then usable by name anywhere:

```json
{
  "personas": { "einstein": "You are Albert Einstein. Reason with thought experiments, seek the simplest law that explains everything, and distrust complexity." },
  "profiles": {
    "physicists": { "panel": ["claude:claude-fable-5-1#max+einstein", "claude:claude-fable-5-1#max+skeptic", { "model": "codex:gpt-6-astra", "persona": "You are Richard Feynman…", "name": "feynman" }], "rounds": 3 }
  }
}
```

The persona applies during propose, critique, and revise. The judge writes the synthesis without it.

## Benchmark profiles

Which profile is worth its cost for which kind of problem? Run a suite and see:

```bash
consensus bench                                   # every profile × the built-in starter suite
consensus bench -P fast,balanced,frontier -c dice,pagination
consensus bench init && $EDITOR consensus.bench.json   # add your own cases
consensus bench --grader claude:claude-opus-5 --parallel
```

Each case runs through each profile; then one grader model scores all profiles' answers for that case **blind and side by side**: accuracy 0–10 when the case has a reference answer, quality 0–10 (reasoning, completeness, specificity, honesty) always. The report shows per profile: accuracy, quality, convergence rate, average time, tokens, and estimated cost at API list price (subscription seats don't bill per token, so treat cost as the equivalent API spend), plus a per-case matrix and the grader's notes. Everything is saved under `.consensus/bench/<timestamp>/` with each run's full debate.

Cases are simple JSON: `prompt`, optional `context`, `expected` (turns on accuracy scoring) or `rubric` (guides quality scoring). The starter suite mixes objective cases (counting, probability, a bug, a leak) with a judgment case (pagination design), because cheap profiles often tie on objective cases and lose on judgment ones.

## CLI

```bash
consensus "your question"                 # default profile (or auto-detect)
consensus -f problem.md -c src/schema.sql # prompt from a file, plus context
cat plan.md | consensus -                 # stdin
consensus run "..." --panel claude,codex:gpt-5.6-sol --rounds 2 --effort max   # `run` is the default; a bare single word is refused so a typo can't start a paid run
consensus "..." --transcript              # append the full debate
consensus "..." --json                    # machine-readable run
consensus models                          # catalog with prices and how each vendor is connected
consensus runs / consensus log [id]       # list past debates, replay one in full
consensus install --project               # project-level skill files + .mcp.json for this repo
```

Every run writes `debate.md` live under `.consensus/runs/<id>/` (tail it while the panel argues), and `--verbose` streams each verdict, dispute, concession, and rebuttal to the terminal.

Every run is saved under `.consensus/runs/<id>/` as `run.json` and `report.md` with the full transcript, so you can audit who claimed what and who conceded.

## Use it from your agent

After `setup`, your agent has a `consensus` MCP tool and a skill that tells it when to use it. Just ask: *"Get a panel consensus on whether we should migrate this queue to Kafka; include the producer code."* The skill teaches the agent to put the whole problem and the real code in the prompt, to report the panel's confidence and dissent rather than presenting the answer as its own, and not to use it for routine work.

Manual registration, if you'd rather:

```bash
claude mcp add -s user consensus -- consensus mcp
codex mcp add consensus -- consensus mcp
gemini mcp add -s user consensus consensus mcp
grok mcp add consensus consensus -- mcp
```

Cursor, Windsurf, and Claude Desktop take `{"command": "consensus", "args": ["mcp"]}` in their `mcpServers`. The MCP server exposes `consensus` (run a panel; accepts `prompt`, `context`, `profile`, `panel`, `rounds`, `effort`) and `consensus_profiles` (list profiles and connections).

## Library

```ts
import { runConsensus, resolveRun, loadConfig, renderReport } from "consensus-panel";

const cfg = await loadConfig();
const { panel, judge, rounds, effort } = await resolveRun({ cfg, profile: "frontier" });
const run = await runConsensus("Design a rate limiter for a multi-tenant API", { panel, judge, rounds, effort });
console.log(renderReport(run));
```

Bring your own model by implementing `Panelist` (`id`, `provider`, `model`, `complete(request)`).

## How the protocol works

1. **Propose.** Every panelist answers independently and in parallel. No anchoring.
2. **Critique.** Each panelist sees all answers, anonymized as Answer A, B, C (labels shuffled per run; it knows only which is its own). It must attack every other answer with specific, falsifiable disputes, review its own, and give a verdict per answer: *agree* (substantively equivalent, no major error) or *disagree*.
3. **Converged?** Only when every panelist marks every other answer *agree* with no major dispute. One dissenter keeps the debate going.
4. **Revise.** Each panelist gets every dispute raised against it and must **concede** or **rebut** each one with a reason, then rewrite its answer, adopting what it now believes and defending what it still holds.
5. Repeat critique → revise up to `rounds` times.
6. **Synthesize.** The judge writes the unified answer with a fixed structure: the answer, confidence, where the panel agreed, unresolved disagreements with each side's strongest case, and what changed during review.

Design choices: panelists are anonymous so no one defers to a brand; concede-or-rebut is mandatory so critiques can't be ignored; disagreement is reported rather than hidden; a panelist that errors out is dropped and the run continues while two remain; every model gets identical prompts.

## Cost and time

A 3-model, 3-round run is roughly 20 calls, each carrying the full set of answers. On subscriptions that's quota; on API keys, expect a few dollars at frontier tier. Every run prints the seats and effort it will use before starting and the estimated cost at API list price when it ends; `run.json` records what each seat actually ran (model, effort, persona). With `--rounds 1` the panel critiques but never revises. Use `budget` or `fast` for cheap passes. This is a tool for decisions that matter.

## Development

```bash
pnpm install
pnpm test          # protocol, profiles, and installer tests; no keys needed
pnpm dev "..."     # run from source
pnpm build && npm link   # `consensus` on PATH from this checkout
```

MIT.
