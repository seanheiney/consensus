# FAQ

Questions a skeptical developer asks before installing, and the ones that come up right after the first run.

**Before you install**

- [Does it actually improve answers?](#does-it-actually-improve-answers)
- [How is this different from just asking three models myself?](#how-is-this-different-from-just-asking-three-models-myself)
- [How much does it cost?](#how-much-does-it-cost)
- [Does it use my subscription, and am I allowed to do that?](#does-it-use-my-subscription-and-am-i-allowed-to-do-that)
- [What does the clean room actually block?](#what-does-the-clean-room-actually-block)
- [Can panelists see my files?](#can-panelists-see-my-files)
- [Where do my prompts go?](#where-do-my-prompts-go)
- [How do I keep prompts out of git?](#how-do-i-keep-prompts-out-of-git)

**After the first run**

- [Why did a seat get dropped?](#why-did-a-seat-get-dropped)
- [Why does a panelist say "agree" and then list disputes?](#why-does-a-panelist-say-agree-and-then-list-disputes)
- [Why was there no revision with `--rounds 1`?](#why-was-there-no-revision-with---rounds-1)
- [How do I add my own model?](#how-do-i-add-my-own-model)
- [How do I share a panel with my team?](#how-do-i-share-a-panel-with-my-team)
- [Can I run it in CI?](#can-i-run-it-in-ci)
- [Is there an API?](#is-there-an-api)

---

## Does it actually improve answers?

**No benchmark has been run, and none is claimed here.** Anyone telling you a number for this without showing the suite is guessing.

What is true is the mechanism, and you can inspect every step of it in `debate.md`:

- Panelists answer independently and in parallel first, so nobody anchors on anybody.
- Critique is adversarial and structured: each panelist must produce specific, falsifiable disputes against each other answer, with a severity, and a verdict.
- Answers are anonymized as A, B, C (labels shuffled once per run), so no seat defers to a brand.
- Revision is concede-or-rebut: a panelist must respond to every dispute raised against it with a reason before rewriting. It cannot quietly ignore a critique.
- Disagreement that survives is reported, not smoothed over.

Empirically, what you will see is: panels converge on easy questions in one round (where the debate bought you little beyond a cross-check), and on genuinely contested questions they either converge after real concessions — visible in the transcript — or they hand you back an explicit unresolved disagreement, which is itself more useful than a confident single answer.

If you want a number for *your* problems, that is what `consensus bench` is for, and it has baseline arms specifically so the comparison is honest:

```bash
consensus bench init                       # start from the sample suite, then add your own cases
consensus bench -P fast,balanced \
  -b claude:claude-opus-5,codex:gpt-5.6-sol \
  --trials 3 --grader google:gemini-3.1-pro-preview
```

`-b/--baseline` arms are a single model answering once with no debate. If the panel does not beat them on your cases, that is the answer, and the report will say so.

## How is this different from just asking three models myself?

Asking three models gives you three answers and leaves the reconciliation to you — and if you paste one model's answer into another, you have anchored it.

The difference is in the parts that are tedious to do by hand:

| Doing it manually | consensus |
|---|---|
| You see who said what, so you weight by brand | Answers are anonymized and shuffled |
| Model 2 sees model 1's answer and drifts toward it | Everyone proposes independently first |
| "Looks fine to me" | Every panelist must raise specific, falsifiable disputes with a severity, on every other answer |
| A critique can be ignored | Every dispute must be conceded or rebutted with a reason before the answer is rewritten |
| You decide when they agree | Convergence is a defined condition: every seat marks every other answer *agree* with no major dispute |
| You merge the answers | A judge writes one answer in a fixed structure, including what it could not settle |
| Nothing is kept | Full audit record: who claimed what, who conceded, what changed |

It is also 20-ish model calls carrying the full answer set, which is exactly the kind of thing you do not want to drive by hand.

## How much does it cost?

Two separate currencies, and a run can spend both:

- **Subscription seats** (`claude`, `codex`, `gemini`, `grok`) spend the vendor's **rate limits**, not money. A three-round frontier debate can consume a meaningful slice of a daily or five-hour cap.
- **API-key seats** (`anthropic`, `openai`, `google`, `xai`, `openrouter`, `compat`) spend **money**, per token.

Order of magnitude: a 3-seat, 3-round run is roughly 20 model calls, each carrying the whole set of answers, so context grows through the run. On frontier API models expect a few dollars; on budget models, cents.

You are told before and after, and you can put a hard ceiling on it:

```
judge: claude:claude-opus-5  rounds: 3  cost: subscription quota + API tokens; roughly 21 model calls at most; ceiling $2
…
cost: ~$1.42 at API list price (not priced: codex:gpt-5.6-sol); subscription seats bill quota, not tokens
```

```bash
consensus "..." --max-cost 2          # aborts mid-run once the estimate crosses $2
consensus "..." --profile fast        # cheap models, low effort, one critique round
consensus "..." --rounds 1            # critique only, no revision
```

Cost accounting is deliberately conservative: a seat that reports no usage at all (Codex only prints a combined total) is listed as **unpriced**, never counted as `$0`, and the cost line names it. `--max-cost` can only count what it can price, so unpriced subscription seats do not contribute to the ceiling.

Also: `consensus` refuses a bare single word as a prompt, so a mistyped subcommand cannot start a paid run.

## Does it use my subscription, and am I allowed to do that?

**Yes, it can, and you need to read this part rather than skim it.**

How it works: a subscription seat is your vendor's own CLI (`claude`, `codex`, `gemini`, `grok`), already logged in as you, run headless in a temp directory. The CLI owns the auth; consensus never sees a token and never stores one for those seats.

What that costs you: **every seat call spends the same rate limits as your interactive use of that CLI** — Claude Code's rolling 5-hour and weekly caps, Codex's ChatGPT limits. A frontier panel at three rounds is not a cheap background task; it is a chunk of your day's quota.

What the terms say: vendors' terms govern this use, and they differ. **Anthropic's published terms restrict third-party products from offering or relying on claude.ai logins without approval.** consensus is a local tool you run on your own machine under your own login, not a hosted service reselling access — but checking your own plan's terms is your responsibility, not this README's.

The safe defaults:

- Personal, interactive use on your own machine: subscription seats are the convenience they look like.
- **Anything shared, automated, CI, or run on someone else's behalf: use API keys or OpenRouter.** One `OPENROUTER_API_KEY` can seat every vendor.

One protection worth knowing: API keys you save with `consensus setup` are handed only to the matching API client and are **never** exported into a vendor CLI's environment. A stored `ANTHROPIC_API_KEY` therefore cannot silently switch Claude Code from your subscription to per-token billing behind your back.

## What does the clean room actually block?

Each subscription seat runs in a fresh empty temp directory, with an allow-listed environment (below) and these flags:

| Seat | Flags | Effect |
|---|---|---|
| `claude` (Claude Code) | `-p --output-format stream-json --verbose --tools "" --no-session-persistence --setting-sources "" --safe-mode --strict-mcp-config --mcp-config '{"mcpServers":{}}'` | No built-in tools, no settings files, no CLAUDE.md / skills / plugins / hooks, no user MCP servers (including consensus's own), no session left behind. |
| `codex` (Codex CLI) | `exec --skip-git-repo-check --ephemeral --ignore-user-config --ignore-rules --disable shell_tool --disable browser_use --disable computer_use --disable apps -s read-only -c mcp_servers={}` | Your `~/.codex/config.toml` is ignored entirely (approval policy, MCP servers, features), rules files are ignored, shell/browser/computer-use/app tools are off, sandbox is read-only, and the cwd is an empty temp dir. |
| `gemini` (Gemini CLI) | `-p -o json --approval-mode plan --allowed-mcp-server-names __consensus_none__` | Plan (read-only) mode, and an MCP allow-list naming a server that does not exist. |
| `grok` (Grok CLI) | `--prompt-file … --output-format json --tools "" --system-prompt-override …` | No tools. |

The clean room is identical whether a debate starts from the `consensus` CLI or from an agent calling the MCP server. It is applied per seat, not per entry point: both build the same engine and the same seats. The MCP server is its own process that receives only the tool arguments, and it never uses MCP sampling, roots or elicitation, so it cannot read the host agent's conversation or reach its tools. The one way host context gets to a panelist is the `prompt` and `context` the agent chooses to write. Checked from inside a Claude Code session with around 80 MCP tools and user skills loaded: a nested Claude seat started with `tools: []`, `mcp_servers: []`, no installed plugins, and a 418-token prompt.

**Environment.** Seats do not inherit the environment of consensus or of the agent that launched it. Each vendor CLI gets an allow-list: what any CLI needs to start (`PATH`, `HOME`, `USER`, `SHELL`, temp dirs, locale, `XDG_*`, proxy and CA-certificate variables, and the Windows equivalents) plus that vendor's own auth and routing variables (`ANTHROPIC_*`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CONFIG_DIR` and the Bedrock/Vertex switches for Claude; `OPENAI_*` and `CODEX_HOME` for Codex; `GEMINI_*` and `GOOGLE_*` project/credential variables for Gemini; `XAI_*` and `GROK_*` for Grok). Everything else is withheld: another vendor's keys, `GITHUB_TOKEN`, `SSH_AUTH_SOCK`, and the host agent's own session state (`CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, its messaging socket and token). To pass something extra, list its name in `CONSENSUS_SEAT_ENV="NAME1,NAME2"`. A vendor's own key still reaches its seat, so an `ANTHROPIC_API_KEY` in the shell that launched consensus still switches the Claude seat to per-token billing; consensus warns about that before a run.

**Receipts.** Every seat call returns an isolation receipt, and each run records them per seat in `run.json` (`isolation`), the report and the MCP summary (`Isolation: 3/3 seats clean …`). Claude seats are *observed*: Claude Code reports at startup which tools, MCP servers and plugins it loaded, and a seat is marked not clean if any appear. The exceptions are Claude Code's structured-output tool and its own built-in plugins (`agents-md`, `telemetry`), which are listed but don't count against it. Codex, Gemini and Grok don't report their tool list, so their receipts record the lockdown flags and environment only. API seats send requests with no tools attached. `consensus doctor --isolation` makes one tiny live call per subscription seat and prints its receipt, the exact flags, and examples of what was withheld; it exits 1 if a seat is not clean or could not be checked.

One thing still carries over from the host: the MCP server reads the project `consensus.config.json` from the directory the host launched it in, which can change who sits on the panel. It adds no tools or context.

What this does **not** do: it is a configuration clean room, not a sandbox. It relies on the vendor CLI honouring its own flags. It does not use OS-level isolation, containers, or seccomp. If you need a hard boundary, run consensus itself inside your own container.

The Gemini row is the weakest: `--allowed-mcp-server-names` is an allow-list rather than a disable switch, and that behaviour has not been verified against a live Gemini CLI connection. It is recorded as an open item in [docs/qa/](qa/).

## Can panelists see my files?

No. A panelist receives exactly two things: the protocol's system prompt (plus its persona, if it has one) and the text you sent — your `prompt` and whatever you passed in `--context` / the MCP `context` argument.

There is no file tool, no repo access, no web access, and no conversation history from your agent. That is why the skill pack tells agents to *paste* the real code rather than describe it: a panelist cannot go and look.

Panelists also cannot see each other's identities, only anonymized answers.

One consequence worth stating: **whatever you paste is sent to every seat.** Strip secrets before pasting, exactly as you would before pasting into a chat window. Context you paste is wrapped in a delimited block and the panel is instructed to treat it as data, not as instructions — but that is a mitigation, not a guarantee, so do not paste untrusted text and assume it is inert.

## Where do my prompts go?

Two places, and only two.

**To the model routes you connected**, and nowhere else:

- Subscription seats: your prompt goes to the vendor CLI on your machine, which sends it over the vendor's own connection under your own login. consensus makes no network call for those seats.
- API-key seats: directly to that vendor's API (`api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com`, `api.x.ai`, `openrouter.ai`) or to the base URL you gave a `compat:` seat.

**To disk on your machine**, under `.consensus/runs/<id>/` in the directory you ran from: `debate.md`, `report.md`, `run.json`, and `debate.html` if you asked for it. These contain your **verbatim** prompt and context.

There is no consensus-operated server, no telemetry, no analytics, no usage reporting, no account. Nothing phones home. See [SECURITY.md](../SECURITY.md).

## How do I keep prompts out of git?

`.consensus/` is added to `.gitignore` automatically the first time a run saves inside a git repo, and again by `consensus init` and `consensus install --project`. Check it:

```bash
grep -n '^\.consensus/' .gitignore
git check-ignore -v .consensus/runs      # prints the rule that ignores it
```

To be certain, or to keep debates off the project disk entirely:

```bash
# don't save at all
consensus "..." --no-save

# save somewhere outside the repo: consensus.config.json
{ "runsDir": "/Users/you/.local/state/consensus/runs" }
```

If a run was committed before you noticed, remember that `report.md` and `run.json` contain the full prompt and context, so treat it as a leaked paste and rotate anything sensitive.

## Why did a seat get dropped?

A seat that throws an error is retried once if the error looks transient (429, rate limit, 529/503, overloaded, timeout, connection reset), and otherwise removed from the panel. The debate continues as long as **two** seats remain; if it drops below two, the run fails.

You will know:

```
panel shrank: 1 seat(s) dropped (codex:gpt-6-astra); 2 of 3 answered. Exit code 2.
```

and the report lists each dropped seat with its error, and the run exits with code `2` so a script notices.

Common causes and fixes:

| Error | Fix |
|---|---|
| `codex produced no answer … newer version of Codex` | `npm install -g @openai/codex@latest`, or seat `codex:gpt-5.6-sol`. |
| `gemini produced no answer … Ineligible…` | Google retired the free individual login; set `GEMINI_API_KEY` (`consensus connect google`). |
| `not logged in` | `claude auth login` / `codex login` / `grok login`. |
| Rate limited repeatedly | You are out of quota on that subscription. Switch that seat to an API key or OpenRouter, or use a cheaper profile. |
| `hit max_tokens before finishing` | Raise `--max-tokens`, or lower `--effort`. |

Pre-flight catches most of these *before* the run spends anything; `--no-retry` disables the retry if you would rather fail fast.

## Why does a panelist say "agree" and then list disputes?

Because the verdict and the disputes answer different questions.

- **`agree`** means: *this answer is substantively equivalent to mine and contains no major error.* It is a judgement about the bottom line.
- **Disputes** are raised on every answer regardless of verdict, each with a severity, because the protocol asks each panelist to attack everything it can. A `minor` dispute beside an `agree` is the normal, healthy case: "I would reach the same conclusion, and here are three things I would still fix."

Convergence requires every panelist to mark every other answer `agree` **with no major dispute open**. So minor disputes do not block convergence; major ones do. If you see `agree` alongside something that reads like a serious objection, the severity field is the thing to look at.

## Why was there no revision with `--rounds 1`?

`--rounds` counts **critique → revise** cycles, and the loop stops as soon as the panel converges.

With `--rounds 1` the panel proposes, critiques once, and then synthesizes. There is no second critique to test a revision against, so revising would produce an answer nobody had reviewed — worse than synthesizing from answers that were all reviewed. So round 1 is a cross-check, not a debate.

If you want models to actually change their minds, you need at least `--rounds 2`. The `fast` preset is deliberately `rounds: 1`: it is a sanity check, not a decision tool. `balanced` and `frontier` are 3; `deep` is 5.

The run record is honest about this: the judge is told what actually changed during review, so a single-round run will not claim a revision history it does not have.

## How do I add my own model?

Three options, cheapest first:

**1. It speaks the OpenAI chat-completions API** — use `compat:`:

```bash
export COMPAT_API_KEY=...            # omit if the endpoint needs no key
consensus "..." --panel "compat:my-model@https://llm.internal/v1,claude"
```

**2. It is running in Ollama locally**:

```bash
consensus "..." --panel "ollama:qwen3,ollama:llama3.3+skeptic"
```

**3. Anything else** — implement `Panelist` and use the library:

```ts
import type { Panelist } from "consensus-panel";

const mine: Panelist = {
  id: "mine:my-model", provider: "mine", model: "my-model",
  async complete(req) { return { text: await callMyModel(req) }; },
};
```

`req` carries `system`, `messages`, `effort`, `maxTokens`, `json` (true when the phase needs strict JSON), `signal`, and `phase`. Throw to fail a call; the engine retries transient errors once and otherwise drops the seat. Full shape in [docs/usage.md](usage.md#bring-your-own-model).

Prices for unknown models are not in the catalog, so those seats show as unpriced in cost estimates.

## How do I share a panel with my team?

Two mechanisms, for two different situations.

**Same repo, same panel** — commit a project config:

```bash
consensus init --from-profile balanced    # writes consensus.config.json, gitignores .consensus/
git add consensus.config.json .gitignore
```

Project config overrides user config, so every teammate who runs `consensus` in that repo gets the same seats, judge, rounds and effort, resolved against their own connections.

**Anyone, anywhere** — publish a pack:

```bash
consensus pack create my-council -p frontier,perspectives -o consensus-pack.json
# commit consensus-pack.json at a repo root, tag the repo with the GitHub topic `consensus-pack`
```

Others install it with `consensus pack add you/repo`. Seats are stored portably (`any:<model>`), so the pack resolves to whatever each installer has. `pack add` shows the full diff — including every persona's complete text — and asks before writing, and never overwrites someone's existing profiles. See [PACKS.md](../PACKS.md).

## Can I run it in CI?

Technically yes; there are two things to get right.

**1. Use API keys, not subscription seats.** CI is automation on someone else's machine — exactly the case where vendors' terms point you at API access. Subscription CLIs will not be logged in on a runner anyway.

```yaml
env:
  OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
steps:
  - run: curl -fsSL https://raw.githubusercontent.com/seanheiney/consensus/main/install.sh | sh -s -- --no-setup
  - run: echo "$HOME/.local/bin" >> "$GITHUB_PATH"
  - run: consensus setup --yes --no-first-run
  - run: |
      consensus -f rfc.md --panel "openrouter:anthropic/claude-opus-5,openrouter:openai/gpt-5.6-sol,openrouter:x-ai/grok-4.5" \
        --rounds 2 --max-cost 3 --quiet --json -o consensus.json
```

**2. Treat it as advisory, and bound it.** Use `--max-cost`, `--rounds`, and `--quiet`; parse `--json` (or `run.json`) for `converged`, `synthesis`, `dropped`. Exit code `2` means the panel shrank — decide whether that should fail your job. Runs take minutes, so do not put one on every push; a manual dispatch or a label on a design PR is the sane trigger.

Do not point CI at a repo's `.consensus/` directory: those files contain verbatim prompts.

## Is there an API?

There is no hosted HTTP API, and that is a deliberate choice rather than a missing feature: a hosted service would have to answer "whose subscription is this?", and consumer plans' terms make proxying them a non-starter.

What exists instead, all local:

- **The MCP server** (`consensus mcp`) — the API for agents, and where most people actually use it. Tools: `consensus` and `consensus_profiles`.
- **The library** (`import … from "consensus-panel"`) — the API for harnesses and evaluation code. The engine, providers, protocol schemas, bench runner and pack helpers are all exported from the root.
- **The CLI with `--json`** — the API for shell scripts.

If a local HTTP surface is ever added it will be a `localhost` server in the same process, with the same trust model.
