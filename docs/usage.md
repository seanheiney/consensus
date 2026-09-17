# Using consensus

A reference organized by what you are trying to do. Every command here is real; run `consensus <command> --help` for the authoritative flag list.

- [Ask the panel](#ask-the-panel)
- [Watch a run in progress](#watch-a-run-in-progress)
- [Read and replay a run](#read-and-replay-a-run)
- [Seat grammar and the model-id spelling rule](#seat-grammar-and-the-model-id-spelling-rule)
- [Profiles](#profiles)
- [Personas](#personas)
- [Packs](#packs)
- [Benchmarking](#benchmarking)
- [MCP server](#mcp-server)
- [Library](#library)
- [Project and team setup](#project-and-team-setup)
- [Connections and diagnostics](#connections-and-diagnostics)
- [Environment variables](#environment-variables)
- [Exit codes](#exit-codes)

---

## Ask the panel

`run` is the default command, so the question can come straight after `consensus`.

```bash
consensus "Should inventory holds use optimistic locking or a distributed lock?" -c src/inventory.ts
```

Expected output: a header on stderr naming the seats, judge, rounds and cost basis; the debate-log path; live phase progress; then the report on stdout.

```
panel (balanced): claude:claude-opus-5#high, codex:gpt-5.6-sol#high, openrouter:x-ai/grok-4.5#high
judge: claude:claude-opus-5  rounds: 3  cost: subscription quota + API tokens; roughly 21 model calls at most
debate log: .consensus/runs/20260916T112233Z-7f3a1b/debate.md  (tail -f to watch)

▶ propose
  ✓ A codex:gpt-5.6-sol      38.7s
  ✓ B claude:claude-opus-5   41.2s
  ✓ C openrouter:x-ai/grok-4.5  33.9s
▶ critique (round 1)
  4 disputes open after round 1
▶ revise (round 1)
▶ critique (round 2)
  panel converged in round 2
▶ synthesize

# Answer
…
# Confidence
…
# Where the panel agreed
…
# Unresolved disagreements
…
# What changed during review
…

---

_Panel converged after 2 rounds. Panelists: A = codex:gpt-5.6-sol, B = claude:claude-opus-5, C = openrouter:x-ai/grok-4.5. Synthesized by claude:claude-opus-5. Run 20260916T112233Z-7f3a1b._

| Seat | Input tokens | Output tokens |
|---|---:|---:|
| claude:claude-opus-5 | 84,102 | 12,940 |
| codex:gpt-5.6-sol | n/a (subscription CLI) | n/a |

cost: ~$1.42 at API list price (not priced: codex:gpt-5.6-sol); subscription seats bill quota, not tokens
saved .consensus/runs/20260916T112233Z-7f3a1b
```

Where the prompt can come from:

```bash
consensus "your question"                     # argument
consensus -f problem.md                       # a file
cat plan.md | consensus -                     # stdin
consensus "..." -c src/schema.sql             # question plus a context file
```

Shaping the run:

| Flag | What it does |
|---|---|
| `-P, --profile <name>` | Use a named profile instead of the default. |
| `-p, --panel <specs>` | Comma-separated seats, overriding any profile: `--panel claude+skeptic,codex:gpt-5.6-sol`. |
| `-j, --judge <spec>` | Who writes the synthesis. Must be a seat on the panel, unless written `external:<spec>`. |
| `-r, --rounds <n>` | Max critique/revise rounds. `1` means critique only, no revision. |
| `-e, --effort <level>` | `low\|medium\|high\|max` for seats without their own `#effort`. |
| `--max-cost <usd>` | Abort mid-run once the estimated list-price spend crosses this. Unpriced subscription seats are not counted. |
| `--max-tokens <n>` | Cap output tokens per model call. |
| `--no-retry` | Do not retry a seat once on a transient failure (429, 529, timeout). |
| `--force` | Run even when pre-flight found a seat that cannot be reached; those seats are dropped. |
| `-v, --verbose` | Stream each verdict, dispute, concession and rebuttal to stderr as it lands. |
| `-q, --quiet` | No progress output at all. |
| `--json` | Print the full run record as JSON instead of the markdown report. |
| `--transcript` | Append the full debate transcript to the report on stdout. |
| `-o, --output <path>` | Also write the report to a file. |
| `--no-save` | Do not write anything under `.consensus/runs`. |

Two safety behaviours worth knowing:

- **A bare single word is refused.** `consensus profils` would otherwise start a paid debate, so a short argument with no whitespace is rejected unless you write `consensus run "profils"` explicitly.
- **Pre-flight runs before anything is spent.** Every seat's route is checked (CLI installed, logged in, key present, model driveable by the installed CLI version) and the run stops with the exact fix if one cannot work.

## Watch a run in progress

Every run appends a live `debate.md` as it goes. The path is printed in the header.

```bash
tail -f .consensus/runs/20260916T112233Z-7f3a1b/debate.md
```

Or watch in the same terminal:

```bash
consensus "..." --verbose
```

`--verbose` prints, per seat and per phase: each verdict (`agree` / `disagree`) on each anonymized answer, each dispute with severity, and each concession or rebuttal during revision. `Ctrl-C` aborts the run cleanly and still closes the log.

Colour and glyphs follow your terminal: `NO_COLOR=1` turns off colour, and `CONSENSUS_ASCII=1` (or `LANG=C`, or `TERM=dumb`) replaces `✓ ○ ? ✗ ▶` with `[ok] [--] [?] [x] >`.

## Read and replay a run

```bash
consensus runs            # list saved runs, newest first
consensus log             # replay the latest in full
consensus log <id>        # replay a specific one
consensus log --answer    # just the synthesized answer
consensus log --json      # the raw run record
consensus log --html      # a self-contained shareable page
```

`consensus runs` output:

```
20260916T112233Z-7f3a1b  converged 2r  codex:gpt-5.6-sol, claude:claude-opus-5, openrouter:x-ai/grok-4.5
  Should inventory holds use optimistic locking or a distributed lock?
20260915T201801Z-11c0de  open 3r  claude:claude-opus-5, codex:gpt-6-astra
  Is our retry policy safe under partial network partitions?
```

`consensus log --html` writes `<run dir>/debate.html` (or a path you name) with no external assets — one file you can email or drop in a PR comment. It renders the whole debate: every initial answer, every critique with its disputes, every concession and rebuttal, and the synthesis.

Each run directory holds `debate.md` (live log), `report.md` (final report plus transcript), `run.json` (machine-readable: seats with their resolved model, effort and persona; labels; every critique and revision; usage) and, once you ask for it, `debate.html`.

## Seat grammar and the model-id spelling rule

A seat is one panel member: a model, optionally at a given reasoning effort, optionally wearing a persona.

```
provider[:model][#effort][+persona]
```

| Part | Values |
|---|---|
| `provider` | Subscription CLIs: `claude`, `codex`, `gemini`, `grok`. API keys: `anthropic`, `openai`, `google`, `xai`, `openrouter`, `ollama`. Also `compat` (any OpenAI-compatible endpoint) and `any` (portable, resolved at run time). |
| `model` | Optional for CLI providers (they use the CLI's own default) and for API providers (they use a default model). |
| `#effort` | `low`, `medium`, `high`, `max`. Omitted seats inherit the run's `--effort`, else the profile's, else `high`. |
| `+persona` | A built-in persona name, one of your own, several names joined with commas (`skeptic,economist` stacks them), or inline prompt text. |

Two extra forms:

```
compat:<model>@<https base url>      # e.g. compat:qwen3@https://llm.internal/v1   (key: COMPAT_API_KEY)
external:<spec>                      # only for --judge: a judge that did not debate
```

Examples:

```bash
claude                                   # Claude Code CLI, its default model, run effort
claude:claude-opus-5#max                 # explicit model and effort
codex:gpt-5.6-sol                        # Codex CLI driving a specific model
openrouter:x-ai/grok-4.6#high            # OpenRouter
ollama:qwen3#low                         # local Ollama
claude:claude-fable-5-1#max+skeptic      # a persona on top
any:claude-opus-5#high+skeptic           # portable: routed to whatever you have
```

### The spelling rule

**Write a model id exactly as the route you are using spells it — and let `consensus models` be the source of truth, because it prints the exact spec for each model on *your* connections.** There is only one wrinkle, and it has one rule:

- Every route **except** `openrouter:` takes the **vendor's own id**: `claude-opus-5`, `claude-fable-5-1`, `claude-haiku-4-5`, `gpt-6-astra`, `gpt-5.6-sol`, `gemini-3.1-pro-preview`, `gemini-3.8-flash`, `grok-4.6`. Anthropic writes minor versions with a **dash** (`claude-fable-5-1`); OpenAI, Google and xAI write them with a **dot** (`gpt-5.6-sol`, `gemini-3.1-pro-preview`, `grok-4.6`).
- `openrouter:` takes OpenRouter's **`<vendor>/<model>`** id, which is the same id with two differences: the vendor prefix (`anthropic/`, `openai/`, `google/`, `x-ai/` — note the dash in `x-ai`), and Anthropic minor versions written with a **dot**: `anthropic/claude-fable-5.1`, `anthropic/claude-opus-5`, `openai/gpt-6-astra`, `google/gemini-3.1-pro-preview`, `x-ai/grok-4.6`.
- `any:` always takes the **vendor id**, never the OpenRouter form: `any:claude-fable-5-1`. Portable seats are resolved to a concrete route at run time (logged-in CLI → API key → OpenRouter), and the run fails loudly naming the seat if nothing can seat it.

```bash
consensus models     # every known model, its price, and the exact spec for your connections
```

Any model id not in the catalog still works — `provider:model` is passed straight through. The catalog only drives prices, presets, and portability.

### Effort across routes

`#effort` is mapped onto whatever each route actually offers, so `max` does not mean the same thing everywhere:

| Route | `low` | `medium` | `high` | `max` |
|---|---|---|---|---|
| `claude` (Claude Code), `anthropic`, `openai` | low | medium | high | max |
| `codex` (Codex CLI) | low | medium | high | **xhigh** |
| `grok`, `xai`, `openrouter`, `compat`, `ollama` | low | medium | high | **high** (no higher rung) |
| `gemini` (CLI), `google` (API) | not sent — this route has no effort parameter |

The effort each seat actually ran with is recorded per seat in `run.json`.

## Profiles

A profile is a named panel: which seats, at what effort, who judges, how many rounds.

```bash
consensus profiles                        # list yours (* = default)
consensus profile presets                 # built-in presets, and whether you can satisfy them
consensus profile create --preset deep    # materialize a preset
consensus profile create mine             # interactive picker with prices
consensus profile create mine --preset balanced --edit    # start from a preset, then tweak
consensus profile show frontier
consensus profile use frontier            # set the default
consensus profile refresh                 # re-pick preset seats against current connections
consensus profile delete mine
consensus "..." --profile budget          # one-off
```

`consensus profile presets` output:

```
✓ frontier       Most capable model from each vendor at max effort. Slow, expensive, best.
    claude:claude-fable-5-1#max, codex:gpt-6-astra#max, openrouter:google/gemini-3.1-pro-preview#max  rounds 3
✓ balanced       Strong mid-tier models (Opus 5, Sol, Grok 4.5, 3.8 Flash) at high effort.
    claude:claude-opus-5#high, codex:gpt-5.6-sol#high, openrouter:x-ai/grok-4.5#high  rounds 3
○ gemini-family  Gemini Pro, Flash and Flash Lite debating each other.
```

Built-in presets:

| Preset | Panel | Effort | Rounds |
|---|---|---|---|
| `frontier` | best model per connected vendor | max | 3 |
| `balanced` | strong mid-tier model per vendor | high | 3 |
| `budget` | cheapest capable model per vendor | medium | 2 |
| `fast` | same seats as `budget` | low | 1 |
| `deep` | same seats as `frontier` | max | 5 |
| `perspectives` | **one** frontier model seated five times: first-principles, skeptic, pragmatist, security, user-advocate | high | 3 |
| `red-team` | each vendor's standard model, plus a skeptic and a contrarian on the strongest one | high | 3 |
| `claude-family`, `gpt-family`, `gemini-family`, `grok-family` | every catalog model of one vendor debating each other; works with a single subscription | high | 3 |

Presets skip models the installed CLI cannot drive (for example `gpt-6-astra` on Codex < 0.154) and substitute the next tier down, so a `✓` means the seats shown can actually run.

Profiles live in `~/.config/consensus/config.json` and can be written by hand:

```json
{
  "profile": "physicists",
  "profiles": {
    "physicists": {
      "description": "One model, three ways of thinking",
      "panel": ["claude:claude-fable-5-1#max+first-principles", "claude:claude-fable-5-1#max+skeptic", "claude:claude-fable-5-1#max+teacher"],
      "judge": "external:openai:gpt-6-astra",
      "rounds": 3,
      "effort": "max"
    }
  }
}
```

A panel needs at least 2 seats and seat ids must be unique — the same model twice needs different personas or `name`s. A broken profile is skipped with a one-line warning rather than taking every command down.

## Personas

A persona is a preprompt applied to one seat during propose, critique and revise (never during synthesis). The same model under different personas is a real panel, and it works with a single subscription.

```bash
consensus personas                       # built-ins, plus yours
consensus persona add einstein "You are Albert Einstein. Reason with thought experiments…"
consensus persona add reviewer -f ./reviewer-prompt.md
consensus persona remove einstein
consensus "..." --panel "claude+skeptic,claude+pragmatist,codex+security"
```

`--panel` splits on commas, so each comma starts a new seat. **Stacked personas** (`skeptic,economist` on one seat) therefore have to be written in a profile, where a member is a single string:

```json
{ "panel": ["claude:claude-opus-5+skeptic,economist", "codex:gpt-5.6-sol+pragmatist"] }
```

Built-ins: `first-principles`, `skeptic`, `pragmatist`, `security`, `performance`, `user-advocate`, `maintainer`, `economist`, `contrarian`, `teacher`.

Three ways to attach one:

```jsonc
"claude:claude-opus-5+skeptic"                       // by name
"claude:claude-opus-5+skeptic,economist"             // stacked; the seat is named after the first
{ "model": "codex:gpt-6-astra",                      // object form, for inline text and a display name
  "persona": "You are Richard Feynman…",
  "name": "feynman" }
```

Your own personas go under `"personas"` in `~/.config/consensus/config.json` (or in a profile's own `"personas"` block) and override a built-in of the same name.

## Packs

A pack is one JSON file bundling profiles, the personas they use, and optionally a bench suite. Seats are stored portably (`any:<model>`) so a pack resolves against whatever the installer has connected.

```bash
consensus pack list                                  # installed, plus the packs shipped with consensus
consensus pack add security-council                  # a shipped pack
consensus pack add <owner>/<repo>                    # consensus-pack.json at a repo root
consensus pack add <owner>/<repo>/packs/my.json      # any file in a repo
consensus pack add https://example.com/pack.json     # any URL
consensus pack add ./my-pack.json                    # a local file
consensus pack remove security-council
consensus pack create my-council -p frontier,perspectives -o my-council.json
```

`pack add` prints everything it would install — including the **full text of every persona**, because a persona is an instruction your models will follow on your quota — and asks before writing. It never runs anything, and never overwrites a profile or persona you already have: a name clash is installed as `<pack>/<name>` (or use `--force` to overwrite). If the pack ships a suite it is written to `<pack>.bench.json` so you can benchmark it immediately.

See [PACKS.md](../PACKS.md) for the shipped packs and how to publish your own.

## Benchmarking

Which profile is worth its cost for which kind of problem? Run a suite and see.

```bash
consensus bench                                              # every profile × the built-in starter suite
consensus bench -P fast,balanced,frontier -c dice,pagination
consensus bench -P balanced -b claude:claude-opus-5,codex:gpt-5.6-sol   # vs single-model baselines
consensus bench --grader openai:gpt-6-astra --trials 3 --parallel
consensus bench init && $EDITOR consensus.bench.json          # start from the sample suite
```

Each case runs through each arm; then one grader model scores all arms' answers for that case **blind and side by side** — accuracy 0–10 when the case has a reference answer, quality 0–10 (reasoning, completeness, specificity, honesty) always.

Output shape:

```
# Benchmark: starter

| Arm | Accuracy | Quality | Converged | Avg time | Tokens in / out | Est. cost | Failures |
|---|---:|---:|---:|---:|---:|---:|---:|
| balanced | 8.4/10 | 8.1/10 | 80% | 96s | 412,880 / 58,210 | $2.31 | 0 |
| fast | 6.8/10 | 6.2/10 | 100% | 24s | 96,400 / 14,102 | $0.18 | 0 |
| single:claude:claude-opus-5 | 7.9/10 | 7.4/10 | n/a | 31s | 18,220 / 6,140 | $0.24 | 0 |

## Per case
…
```

Everything is saved under `.consensus/bench/<timestamp>/`, including each run's full debate. Read it with care: scores are one grader's opinion, so use `--trials` and a grader from a different vendor before trusting small gaps. The report prints a bias warning when the grader shares a vendor with a graded arm, and a seat that reports no usage is listed as unpriced rather than counted as `$0`.

Cases are plain JSON: `prompt`, optional `context`, `expected` (turns on accuracy scoring) or `rubric` (guides quality scoring).

## MCP server

```bash
consensus mcp        # speaks MCP over stdio; normally launched by your agent, not by you
```

`consensus setup` registers it everywhere it can. Manual registration:

```bash
claude mcp add -s user consensus -- consensus mcp
codex mcp add consensus -- consensus mcp
gemini mcp add -s user consensus consensus mcp
grok mcp add consensus consensus -- mcp
```

Cursor, Windsurf, Claude Desktop, and anything else reading an `mcpServers` object:

```json
{ "mcpServers": { "consensus": { "command": "consensus", "args": ["mcp"] } } }
```

GUI apps do not inherit your shell `PATH`, so `consensus install` writes an absolute `node` + script path for those three instead of a bare `consensus`.

Two tools are exposed:

| Tool | Arguments | Returns |
|---|---|---|
| `consensus` | `prompt` (required), `context`, `profile`, `panel[]`, `rounds`, `effort`, `transcript` | By default a short structured summary: `# Answer`, `# Confidence`, `# Unresolved disagreements`, the seats, whether it converged, the estimated cost, and the path to the full debate. With `transcript: true`, the whole report. |
| `consensus_profiles` | none | The user's profiles and which vendors are connected. Cheap; call it before a long run. |

Runs started over MCP still write `debate.md` under `.consensus/runs/<id>/`, and send MCP progress notifications (phase, seat done, converged) when the client passes a `progressToken`. Expect 1–4 minutes for a small panel and 10+ minutes for a frontier profile at 3 rounds, and set client timeouts accordingly.

## Library

```ts
import { runConsensus, resolveRun, loadConfig, renderReport } from "consensus-panel";

const cfg = await loadConfig();
const { panel, judge, rounds, effort } = await resolveRun({ cfg, profile: "frontier" });
const run = await runConsensus("Design a rate limiter for a multi-tenant API", { panel, judge, rounds, effort });

console.log(renderReport(run));      // markdown report
console.log(run.synthesis);          // just the judge's answer
console.log(run.converged, run.rounds.length, run.seats, run.usage);
```

The root export also gives you `ConsensusEngine` (for `onEvent`, `signal`, `maxCostUsd`, `maxTokens`), `createPanelist`, `parseSpec`, `PRESETS`, `PERSONAS`, `runBench`, the pack helpers, and the protocol schemas (`CritiqueSchema`, `RevisionSchema`).

### Bring your own model

A panelist is a small interface — implement it and it can sit on any panel:

```ts
import type { Panelist, CompletionRequest, CompletionResult } from "consensus-panel";

const mine: Panelist = {
  id: "mine:my-model",           // must be unique on the panel
  provider: "mine",
  model: "my-model",
  effort: "high",                // optional
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    // req.system   — the protocol's ground rules (plus the persona, if any)
    // req.messages — [{ role: "user" | "assistant", content }]
    // req.effort, req.maxTokens, req.json, req.signal, req.phase
    //   phase is "propose" | "critique" | "revise" | "synthesize" | "probe"
    //   json === true means the phase expects strictly parseable JSON
    const text = await callMyModel(req);
    return { text, usage: { inputTokens: 0, outputTokens: 0 } };
  },
};
```

Throw on failure: the engine retries once on a transient error (429, 529, timeout) and otherwise drops that seat and continues while at least two remain.

## Project and team setup

```bash
consensus init --from-profile balanced   # freeze a profile into consensus.config.json
consensus install --project              # skill files + .mcp.json for this repo
```

`init` writes a committable `consensus.config.json` (pinning the panel, judge, rounds and effort, plus any custom personas those seats use) and adds `.consensus/` to `.gitignore`. Project config overrides user config; profiles merge by name. Teammates who `consensus setup` then get the same panel resolved against their own connections.

## Connections and diagnostics

```bash
consensus setup [--yes] [--project] [--probe] [--no-first-run]
consensus connect claude|codex|gemini|grok|openrouter
consensus doctor [--probe]
consensus models
consensus install [--project] [--skills-only] [--mcp-only]
consensus uninstall [--purge]
```

`consensus doctor` prints Accounts, Profiles and Hosts; `--probe` adds one tiny real call through each connection with its latency and reply. It is the right thing to paste into a bug report.

## Environment variables

| Variable | Effect |
|---|---|
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `OPENROUTER_API_KEY` | API-key routes. Keys saved by `setup` are used only when the shell does not already set one. |
| `COMPAT_API_KEY` | Key for `compat:<model>@<url>` seats. |
| `XDG_CONFIG_HOME` | Moves `~/.config/consensus`. |
| `NO_COLOR` | Disable colour. |
| `CONSENSUS_ASCII=1` | ASCII glyphs (also triggered by `LANG=C` or `TERM=dumb`). |

Saved keys are handed only to the matching API client and are **never** exported into the environment of a vendor CLI, so a stored `ANTHROPIC_API_KEY` cannot silently move Claude Code off your subscription.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success. |
| `1` | Error: bad flags, unreachable seats at pre-flight, spend ceiling hit, no prompt, unknown profile or persona. |
| `2` | The run finished, but the panel shrank — one or more seats were dropped after failing. The report names them. |

## Design a panel from a brief

Describe the panel you want and let your strongest connected model draft it:

```bash
consensus profile design "5 panelists: a security expert, a distributed-systems engineer, a PM, a skeptic and a cost hawk; frontier models; 3 rounds"
consensus profile design                    # asks: how many, what expertise, frontier or commodity, rounds
consensus profile design "…" --no-llm       # template personas, no model call
consensus profile design "…" --tier commodity --name cheap-council --yes
```

The designer reuses built-in personas when they fit, writes new ones for other expertise (shown in full before saving), seats them across the vendors you have connected so the panel is as diverse as your connections allow, and defaults the judge to `external:auto` (a model that did not debate). The same is available to agents as the MCP tool `consensus_design`.

## Guardrails and reproducibility (reference)

| Flag / setting | Effect |
|---|---|
| `--max-cost <usd>` | Abort when spend billed to API keys exceeds this. Subscription seats are quota and never count. The partial debate is saved (exit code 3). |
| `--timeout <minutes>` | Kill any single model call after this long (default 20). SIGTERM, then SIGKILL after 10 s. |
| `--no-retry` | Do not retry a seat once on a transient failure (rate limit, overload, timeout). |
| `--force` | Run even if pre-flight finds a seat that cannot be reached (it will be dropped). |
| `--seed <n>` | Seed for label assignment and answer ordering; recorded in `run.json` under `options.seed`. Reuse it to reproduce a run's shuffles. |
| `--judge external:<spec>` / `external:auto` | A judge that did not debate. `auto` picks the strongest seatable model of a vendor not on the panel. |
| `#xhigh` | Effort rung between high and max; Claude, OpenAI and Codex honour it, other routes map it to high. |
| Exit codes | 0 ok · 1 error · 2 a seat was dropped (panel shrank) · 3 stopped by `--max-cost` (partial saved) |
| `CONSENSUS_VERSION` / `CONSENSUS_DOWNLOAD_BASE` | Installer: install a tagged release / download from a mirror. See [install.md](install.md). |

Cost lines separate what API keys will bill from what subscription seats consumed as quota (shown as a list-price equivalent), and name any seat that reported no usage.

## Hosts the installer wires up

Claude Code, Codex CLI, Gemini CLI, Grok CLI, Cursor, Windsurf, Claude Desktop, VS Code (Copilot agent mode, user-level `mcp.json`), Zed (`context_servers`), and the cross-tool `~/.agents/skills` directory read by Copilot and others. `consensus doctor` shows, per host, whether the MCP server is registered and the skill installed; `consensus uninstall` reverses all of it.


> `#xhigh` is a valid effort rung on every flag and spec that accepts effort. `consensus runs` prints to stdout (pipe-friendly); `consensus log --answer` prints only the `# Answer` section. Every report and `run.json` carries the run's cost summary (`cost.summary`). `consensus persona prune` removes custom personas no profile uses.


## The captain

Every run has a captain by default: a single frontier model, chosen as the best available (preferring a vendor that is not on the panel so it is neutral), that moderates, referees, facilitates, and reports. After each critique round it writes a **brief**: what is settled, which disputes matter (duplicates merged, nits dropped), a **referee ruling** wherever a dispute can be settled on evidence or a checkable argument, **direct questions** to seats that are stuck or vague, and exactly what each seat must address in its revision. The brief is injected into every seat's revise prompt (seats may still rebut a ruling with evidence). On the last scheduled round the captain may grant **one extra round** if another exchange would likely settle a dispute that matters. At the end it assembles the **report**: answer, confidence, agreements, unresolved disagreements, referee rulings, and what changed.

```bash
consensus "…"                                    # captain auto (default)
consensus "…" --captain claude:claude-fable-5-1    # name the captain
consensus "…" --captain none                     # no moderation; first seat synthesizes
consensus "…" --judge codex:gpt-5.6-sol          # captain moderates, but this seat writes the report
```

In a profile: `"captain": "auto" | "<spec>" | "none"`. The debate log shows each round's brief and questions under "captain's brief"; `run.json` records the captain and every brief; the report footer counts rounds moderated and rulings made.

> Captain modes: `auto` (default) is the best available model on your machine, run as a separate thread even if a seat uses the same model; `neutral` prefers a vendor that is not on the panel; a spec names one; `none` disables moderation. Benchmark control arms: `--baseline <spec>` (one answer, no debate) and `--self-consistency <spec>xN` (the same model answers N times and merges its own best: more tokens, no debate). A harder judgment suite ships at `suites/judgment.json`.

> How a debate ends: round 1 needs a clean sheet (any dispute forces a revision). From round 2, critics only re-check their earlier disputes and raise new major ones, and the panel converges once no major dispute remains. The captain may end a stalemated debate early (`stop_debate`) or grant one extra round; if the captain's model hits a usage limit it hands off to the next best model. Expect judgment questions at high effort to take 10–30 minutes on subscription CLI seats.
