# consensus

Throw a hard problem at a panel of frontier models. They answer independently, attack each other's answers, concede or rebut, revise, and repeat until they agree — and you get one answer the whole panel signed off on, with the disagreements that survived laid out honestly.

It runs on the **AI subscriptions you already pay for** (Claude Pro/Max, ChatGPT Plus/Pro, SuperGrok) as well as API keys or OpenRouter, by driving each vendor's own CLI headless in a clean room.
*Subscription seats spend the same rate limits as your interactive use of those CLIs, and vendors' terms govern that use — Anthropic's terms restrict third-party products from relying on claude.ai logins. [Read this before you rely on it.](docs/faq.md#does-it-use-my-subscription-and-am-i-allowed-to-do-that)*

```
# illustrative transcript: a 3-round debate that revises once and converges
$ consensus "Optimistic locking or a distributed lock for inventory holds?"

panel (balanced): claude:claude-opus-5#high, codex:gpt-5.6-sol#high, grok:grok-4.5#high, gemini:gemini-3.8-flash#high
judge: claude:claude-opus-5  rounds: 3  cost: subscription quota; roughly 28 model calls at most
debate log: .consensus/runs/20260916T094012Z-a1b2c3/debate.md  (tail -f to watch)
▶ propose
  ✓ A claude:claude-opus-5   41.2s
  ✓ B codex:gpt-5.6-sol      38.7s
  ...
▶ critique (round 1)
  4 disputes open after round 1
▶ revise (round 1)
▶ critique (round 2)
  panel converged in round 2
▶ synthesize
```

You get back: the answer, a confidence level, what the panel agreed on, what it could not settle, and what changed during review. Every run is saved and replayable.

---

## Quickstart (90 seconds)

```bash
# 1. install: one download (no Node, npm or sudo needed), then the setup wizard
curl -fsSL https://raw.githubusercontent.com/seanheiney/consensus/main/install.sh | sh

# 2. setup connects your accounts, builds profiles, teaches your IDEs, and runs
#    a first debate so you see a real result. Then ask it something:
consensus "Should we move this queue from Postgres SKIP LOCKED to Redis/BullMQ?" -c src/queue.ts

# 3. read it again later
consensus runs          # list past debates
consensus log           # replay the latest in full
consensus log --html    # one self-contained page you can send to someone
```

Not connected to anything yet? `consensus doctor` says what is missing and how to fix it. You need **at least two seats** for a panel; one OpenRouter key (`OPENROUTER_API_KEY`) is enough to reach every vendor at once.

Want a panel shaped for your problem? Describe it and a model drafts the seats and personas:

```bash
consensus profile design "4 panelists: security, distributed systems, a PM, a skeptic; frontier models; 2 rounds"
consensus "…" --profile <the name it chose>
```

## Install

| Platform | Command |
|---|---|
| macOS / Linux | `curl -fsSL https://raw.githubusercontent.com/seanheiney/consensus/main/install.sh \| sh` |
| macOS / Linux, unattended | `curl -fsSL https://raw.githubusercontent.com/seanheiney/consensus/main/install.sh \| sh -s -- --yes` |
| Windows (PowerShell) | `irm https://raw.githubusercontent.com/seanheiney/consensus/main/install.ps1 \| iex` |
| npm (you manage Node 22+) | `npm install -g https://github.com/seanheiney/consensus/archive/refs/heads/main.tar.gz && consensus setup` (`consensus-panel` on npm once published) |
| From source | `git clone https://github.com/seanheiney/consensus && cd consensus && pnpm install && pnpm build && npm link` |

The one-liners need **no Node, no npm and no sudo**: they download a self-contained build (the official Node 22 runtime plus the bundled CLI, about 38 MB), verify it against the release's `SHA256SUMS`, install it under `~/.consensus` with a `~/.local/bin/consensus` link, add one marked line to your shell rc files, and start `consensus setup` in the same terminal. Re-running upgrades in place (and runs `consensus doctor` instead of the wizard). Your own Node, if any, is never used or changed. No telemetry. Later: `consensus update`, `consensus uninstall --all`.

You need at least two model connections for a panel. Installer options: `--help`, `--yes`, `--no-setup`, `--version <x.y.z>`, `--no-modify-path`, `--dir`, and `CONSENSUS_*` environment equivalents.

Full details — what the installer writes where, verifying releases, proxies, air-gapped installs, upgrading, uninstalling, and a troubleshooting table: **[docs/install.md](docs/install.md)**.

## What `consensus setup` does

1. **Finds your accounts.** Vendor CLIs you already use (Claude Code, Codex, Gemini CLI, Grok) and whether they are logged in, plus any API keys. For anything missing it offers to log you in through the vendor's own CLI, install that CLI, or store an API key in `~/.config/consensus/credentials.json` (mode 600). Your subscription auth stays inside the vendor's CLI; consensus never sees a token.
2. **Builds model profiles** from what is connected, and asks which is the default.
3. **Teaches your tools.** Registers the MCP server and drops a skill pack into Claude Code, Codex, Gemini CLI, Grok, Cursor, Windsurf, Claude Desktop, and the cross-tool `~/.agents/skills` directory. Your agent then knows the panel exists and when to reach for it.
4. **Runs a first debate** so you see a real result and where the log lives.

`consensus setup --yes` does all of it with no questions. `consensus doctor --probe` shows what is connected and makes one tiny call through each to prove it. `consensus uninstall [--all] [--purge]` reverses every change.

## How your subscriptions are used

| Vendor | Subscription path | API key path |
|---|---|---|
| Anthropic | `claude` (Claude Code) logged in with Claude Pro/Max | `ANTHROPIC_API_KEY` |
| OpenAI | `codex` logged in with ChatGPT Plus/Pro | `OPENAI_API_KEY` |
| xAI | `grok` CLI logged in | `XAI_API_KEY` |
| Google | Google retired the free individual Gemini CLI login | `GEMINI_API_KEY` |
| OpenRouter | — | `OPENROUTER_API_KEY` (covers any vendor you have not connected) |

A subscription-backed seat is that vendor's CLI run headless in an empty temp directory as a clean room: Claude Code with no tools, no settings sources, `--safe-mode` and no MCP servers; Codex with `--ignore-user-config`, `--ignore-rules`, a read-only sandbox and its shell/browser/computer-use/app tools disabled; Gemini in plan mode. Panelists see only the prompt you give them — not your files, CLAUDE.md, AGENTS.md, your other MCP servers, or your shell's other keys (each seat gets an allow-listed environment). Every run records per-seat isolation receipts, and `consensus doctor --isolation` shows them live.

**Read this before relying on subscription seats.** Every seat call spends the same rate limits as your interactive use of that CLI (Claude Code's rolling 5-hour and weekly caps, Codex's ChatGPT limits), and a three-round frontier debate can consume a meaningful slice of a daily cap. Vendors' terms govern this use: Anthropic's published terms restrict third-party products from offering or relying on claude.ai logins without approval. consensus is a local tool you run on your own machine under your own login, not a hosted service, but checking your plan's terms is your responsibility — and you should use API keys for anything shared, automated, or run on someone else's behalf. Keys saved by `setup` are handed only to the matching API client and are never exported into a vendor CLI's environment, so a saved key cannot silently move your subscription CLI onto per-token billing.

## Use it from Claude Code, Codex, Cursor…

After `setup`, your agent has a `consensus` MCP tool plus a skill telling it when to use it. Just ask: *"Get a panel consensus on whether we should migrate this queue to Kafka; include the producer code."*

```bash
claude mcp add -s user consensus -- consensus mcp      # manual registration, if you prefer
codex mcp add consensus -- consensus mcp
gemini mcp add -s user consensus consensus mcp
grok mcp add consensus consensus -- mcp
```

Cursor, Windsurf, and Claude Desktop take `{"command": "consensus", "args": ["mcp"]}` under `mcpServers`. The server exposes `consensus` (run a panel) and `consensus_profiles` (list profiles and connections). See [docs/usage.md](docs/usage.md#mcp-server).

## How the protocol works

1. **Propose.** Every panelist answers independently and in parallel. No anchoring.
2. **Critique.** Each panelist sees all answers, anonymized as Answer A, B, C (labels shuffled once per run; a panelist knows only which is its own). It must attack every other answer with specific, falsifiable disputes, review its own, and return a verdict per answer: *agree* (substantively equivalent, no major error) or *disagree*.
3. **Converged?** Only when every panelist marks every other answer *agree* with no major dispute. One dissenter keeps the debate going.
4. **Revise.** Each panelist gets every dispute raised against it and must **concede** or **rebut** each one with a reason, then rewrite its answer.
5. Repeat critique → revise up to `--rounds` times.
6. **Synthesize.** The judge writes the unified answer with a fixed structure: the answer, confidence, where the panel agreed, unresolved disagreements with each side's strongest case, and what changed during review.

Design choices: panelists are anonymous so no one defers to a brand; concede-or-rebut is mandatory so critiques cannot be ignored; disagreement is reported rather than hidden; a panelist that errors out is dropped and the run continues while two remain (and the run exits 2 so a script notices); every model gets identical prompts.

With `--rounds 1` the panel critiques but never revises — see [why](docs/faq.md#why-was-there-no-revision-with---rounds-1).

## Cost and time

A 3-model, 3-round run is roughly 20 model calls, each carrying the full set of answers. On subscriptions that is quota; on API keys, expect a few dollars at frontier tier. Every run prints the seats and effort it will use **before** starting and the estimated list-price cost **after**; `--max-cost 2` aborts mid-run if the estimate crosses a ceiling. A bare single word is refused as a prompt so a typo cannot start a paid run. Use the `budget` or `fast` profile for cheap passes.

No benchmark claims are made here: `consensus bench` is the tool for producing them on your own problems, and the ablation against single-model baselines has not been run yet.

## Documentation

| | |
|---|---|
| [docs/install.md](docs/install.md) | Every install path, what the installer writes, upgrading, uninstalling, troubleshooting |
| [docs/usage.md](docs/usage.md) | CLI reference by task, the `provider[:model][#effort][+persona]` grammar, the model-id spelling rule |
| [docs/faq.md](docs/faq.md) | Does it actually help, what it costs, subscriptions and terms, privacy, CI, API |
| [PACKS.md](PACKS.md) | Sharing a panel as one JSON file |
| [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [CHANGELOG.md](CHANGELOG.md) | Development, reporting issues, releases |
| [docs/qa/](docs/qa/) | The expert UX-validation runs behind the current design |

## Library

```ts
import { runConsensus, resolveRun, loadConfig, renderReport } from "consensus-panel";

const cfg = await loadConfig();
const { panel, judge, rounds, effort } = await resolveRun({ cfg, profile: "frontier" });
const run = await runConsensus("Design a rate limiter for a multi-tenant API", { panel, judge, rounds, effort });
console.log(renderReport(run));
```

Bring your own model by implementing `Panelist` (`id`, `provider`, `model`, `complete(request)`). See [docs/usage.md](docs/usage.md#library).

## Development

```bash
pnpm install
pnpm test          # protocol, profiles, packs, installer tests; no keys needed
pnpm dev "..."     # run from source
pnpm build && npm link   # `consensus` on PATH from this checkout
```

See [CONTRIBUTING.md](CONTRIBUTING.md). MIT licensed.
