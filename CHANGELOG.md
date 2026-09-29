# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `--variants <n>` / MCP `variants`: seat the panel's model(s) once per reasoning angle, so one subscription can hold a real debate. `--for <task>` (code-review, architecture, debug, security, product, estimate) seats the angles that suit a kind of work and its round count. New personas: `enumerator`, `alternate-method`.
- `--escalate <profile>` / MCP `escalate_to`: answer with the chosen panel first and promote to a stronger profile only when the first pass is unsettled (not converged, a major dispute open, confidence below high, or seats lost). `--escalate-when unsettled|disputed|always`. Opt-in, never downgrades a run; the promoted panel receives the first answer as a draft to verify and the run records where it came from.
- `--verify` / MCP `verify`: a grounding pass over the final report that marks each load-bearing claim supported, contradicted or unsupported against the problem and context supplied, and only that material.
- `--reuse [days]`: hand back the saved answer when the same question already went to the same panel (`run.key`).
- `consensus adr`: write a run up as `docs/decisions/NNNN-slug.md` — question, decision, confidence, unresolved, panel, grounding check, replay command.
- Presets `groq-fast` and `groq-council`: Groq open-weight models seated under different angles, offered once `GROQ_API_KEY` is set. Presets can now name their seats outright (`shape: "explicit"`). `--profile <preset>` falls back to a built-in preset of that name when no saved profile has it, so CI needs no config file.
- A GitHub Action (`action.yml`) and [docs/ci.md](docs/ci.md): panel review on a pull request, escalation in CI, `/consensus` comments, with `max-cost` defaulted and API-key seats only.
- Isolation receipts: every seat call reports how it was isolated, and runs record them per seat (`run.json` `isolation`, the report, the MCP summary). Claude seats are observed: Claude Code's startup event lists the tools, MCP servers and plugins it loaded, and anything beyond structured output and its own built-ins marks the seat not clean. Codex, Gemini and Grok record their lockdown flags; API seats attach no tools.
- `consensus doctor --isolation`: one tiny live call per subscription seat, printing its receipt, flags and withheld environment; exits 1 if a seat is not clean or could not be checked.
- `.github/dependabot.yml` for GitHub Actions and npm.

- `consensus check "<question>"`: a cheap disagreement signal. Every seat answers once in parallel; answers are grouped into positions (plain comparison, plus one low-effort captain call only when wording differs); output is unanimous / majority / split / insufficient with the seats behind each and `Needs human: yes|no`. Exit 0 unanimous, 1 disagreement, 2 no signal. MCP `consensus_check`; Action `mode: check` with `agreement` and `needs-human` outputs.
- Quarantine mode: `--untrusted <file>` (repeatable; MCP `untrusted`, Action `untrusted-file`) reads third-party material as data inside per-run nonce delimiters with a canary token. Seats report injection attempts, the report adds "Injection attempts observed", and any participant that outputs the canary is excluded (a clean seat rewrites the report if the writer leaked). New `plugin-review` pack and an inert demo in `examples/injection-demo/`.
- `consensus outcome <run|latest> right|wrong|partial [--note]` and `consensus calibration [--json] [-P profile] [--since days]`: record how decisions turned out and score stated confidence, convergence, open disputes and profile against them, saying plainly when a bucket is too small. MCP `consensus_outcome`. Runs record the profile they came from.
- `consensus adr --recheck [paths...|--all] [--dry-run] [--json]`: put recorded decisions to a panel again; a strict-schema judge call classifies the new answer as unchanged, refined or changed, and a dated "Rechecked" section is appended (the original is never edited). Exit 1 if any decision changed, 3 if a recheck failed. Records now carry a `<!-- consensus-adr -->` marker; runs record the context file they read.
- Verified clean rooms: grok seats are "observed" (`grok inspect --json` in a sandbox built like the seat's; not clean if it would load instructions, non-bundled skills, plugins, MCP servers, hooks, user agents, LSP servers or remote settings). Every run records a clean-rooms trust line in run.json, the report and the MCP summary. `consensus doctor --isolation --json`.
- Docs: [quarantine.md](docs/quarantine.md), [decisions.md](docs/decisions.md), [isolation.md](docs/isolation.md).

### Changed
- Subscription seats get an allow-listed environment instead of inheriting the parent's: other vendors' keys, `GITHUB_TOKEN`, `SSH_AUTH_SOCK` and a host agent's session variables (`CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, messaging socket) no longer reach a seat. `CONSENSUS_SEAT_ENV="A,B"` passes extra names.
- Claude seats run with `--output-format stream-json --verbose` so the startup event can be read.
- Grok seats run with an empty `HOME` and `GROK_HOME` holding only a copy of the login. Before, a grok seat loaded the user's global `~/.grok/Agents.md`, skills, plugins (with hooks), MCP servers (including `consensus` itself), and the hooks, skills and permissions it imports from `~/.claude`. A token refreshed during the call is copied back.
- `consensus doctor` explains a grok login that exists but is unreadable (`~/.grok/auth.json` owned by root after `sudo grok login`) instead of reporting plain "not logged in".
- Codex errors reported through `--json` events (for example a usage limit) are shown in full instead of the first event line.
- GitHub Actions are pinned to commit SHAs and `ci.yml` defaults to read-only permissions.

## [0.2.0] — 2026-09-16

### Added
- Captain: a designated model moderates each round, referees disputes, puts direct questions to seats, may grant one extra round, and writes the report. `auto` (best available model, as its own thread even if a seat uses it), `neutral` (prefer an off-panel vendor), a spec, or `none`.
- The auto captain carries ordered stand-ins: when its model hits a usage limit it hands off (logged as a handoff) instead of failing the debate; if every stand-in fails a seat writes the report.
- Natural-language panel designer (`consensus profile design`, MCP `consensus_design`).
- Bench control arms: `--baseline` and `--self-consistency spec[xN]`; per-case paired win/loss cells; debate-activity counts; `suites/judgment.json`.

### Added
- One-paste standalone install: release archives with the official Node 22 runtime and the CLI bundled into one file (`scripts/bundle.mjs`, `scripts/package.mjs`), built for macOS arm64/x64, Linux x64/arm64 and Windows x64/arm64 with `SHA256SUMS` and build-provenance attestations (`release.yml`).
- `install.sh` rewrite: no Node, npm or sudo; Rosetta and musl detection; curl or wget with progress; sha256 verification; `~/.consensus/versions/<ver>` + `current`; `~/.local/bin/consensus`; `~/.consensus/env` + one guarded rc line (zsh, bash, fish, sh); receipt; step counter and elapsed time; `exec setup </dev/tty` on a fresh install, `doctor` on upgrade, instructions without a terminal; `--version`, `--dir`, `--no-modify-path`, `--allow-root`, `--dry-run`, `CONSENSUS_DOWNLOAD_BASE`. Until a release exists it falls back to a private Node + npm prefix install (no brew/fnm/nvm/global npm).
- `install.ps1` rewrite with the same design (user PATH, junction, receipt, scriptblock parameters).
- `consensus update`, `consensus uninstall --all`, an Install section in `consensus doctor`, and an end-of-setup summary (install, PATH, accounts, profiles, IDEs, no telemetry).
- `test/install/run-docker.sh`: installer end-to-end on ubuntu:24.04, debian:bookworm-slim and node:22-bookworm; CI installer smoke on Linux, macOS and Windows.

### Changed
- MCP hosts are registered with the stable launcher (`~/.local/bin/consensus`) on standalone installs, never a versioned Node path.
- Setup no longer defaults to installing vendor CLIs: one multiselect, key-or-login defaults, explicit confirmation for `npm install -g`, `codex login --device-auth` when headless, 5-minute cap on vendor logins, profiles saved as soon as they are created, and a "not ready: next step" ending (exit 3 under `--yes`) instead of "Done" with fewer than 2 models.
- `docs/install.md`, `docs/usage.md`, `docs/faq.md` and a `docs/` index.
- `CONTRIBUTING.md`, `SECURITY.md`, this changelog, and GitHub issue / pull-request templates.
- `install.sh`: `--help`, `--version`, `--no-setup`, a version banner, and a `CONSENSUS_INSTALL_DIR` prefix override. `install.ps1`: `-Help`, `-Version`, `-Yes`, `-NoSetup`, and the same prefix override.

### Changed
- README rewritten to one screen: hero, quickstart, install matrix, agent integration, protocol, cost. Reference material moved to `docs/`.
- `install.sh` reports an existing install and the version it upgrades to, and ends with an explicit next step. It is now bash-3.2-safe when invoked with no arguments.
- `install.ps1` refreshes `PATH` after a winget Node install and states the correct minimum Node version (22, not 20).

## [0.1.0] — 2026-09-15

First public release. Not yet on npm: install from the repo tarball, `https://github.com/seanheiney/consensus/archive/refs/heads/main.tar.gz`.

### The panel

- Adversarial consensus protocol: propose in parallel → critique with anonymized answers (labels shuffled once per run) → concede-or-rebut → revise → repeat until every panelist agrees or `--rounds` is exhausted → a judge synthesizes one answer with confidence, agreement, unresolved disagreements, and what changed during review.
- Seats are `provider[:model][#effort][+persona]`. Routes: the vendor CLIs `claude`, `codex`, `gemini`, `grok` (subscription-backed, no API key); the APIs `anthropic`, `openai`, `google`, `xai`, `openrouter`; `ollama`; and `compat:<model>@<baseURL>` for any OpenAI-compatible endpoint.
- Portable `any:<model>` seats resolve at run time to a logged-in CLI, an API key, or OpenRouter, and fail loudly rather than downgrading silently.
- `external:<spec>` judge: a judge that did not argue the case.
- Ten built-in personas, stackable, with your own definable in config or inline. `perspectives` seats one model five times under different personas, so a real panel works on a single subscription.

### Trust and cost

- Pre-flight checks every seat's route — CLI installed, logged in, model driveable by the installed CLI version — before anything is spent, and prints the exact fix. `--force` overrides.
- Seats and cost basis are printed before the run; estimated list-price cost after. `--max-cost` aborts mid-run. Seats that report no usage are listed as unpriced, never counted as `$0`.
- One retry on transient failures (429, 529, timeouts); `--no-retry` disables it. A dropped seat is named in the report and the run exits with code 2.
- A bare single word is refused as a prompt, so a mistyped subcommand cannot start a paid run.
- Subscription seats run the vendor CLI headless in an empty temp directory with user config, rules, tools and MCP servers disabled.
- Saved API keys are never exported into a vendor CLI's environment, so a stored key cannot silently switch a subscription CLI to per-token billing. `credentials.json` is mode 600.
- Rate-limit and vendor-terms disclosure in the README, `setup` and `doctor`.

### Commands

- `run` (default), `runs`, `log [--json|--answer|--html]`.
- `setup [--yes|--project|--probe|--no-first-run]`, `connect <vendor>`, `doctor [--probe]`, `models`, `install [--project|--skills-only|--mcp-only]`, `uninstall [--purge]`, `init [--from-profile]`.
- `profiles`, `profile presets|create|edit|show|use|delete|refresh`.
- `personas`, `persona add|remove`.
- `pack add|list|remove|create`, with three shipped packs: `security-council`, `startup-advisors`, `product-review`.
- `bench run [--profiles|--suite|--cases|--grader|--trials|--baseline|--parallel]`, `bench init`.
- `mcp` — MCP server over stdio, exposing `consensus` and `consensus_profiles`, with progress notifications, a live debate log, and a short structured result (`transcript: true` for the whole report).

### Integration

- `setup` registers the MCP server and installs a skill pack into Claude Code, Codex, Gemini CLI, Grok, Cursor, Windsurf, Claude Desktop, and the cross-tool `~/.agents/skills` directory. JSON configs are merged with a `.bak`, and a file that will not parse is left untouched.
- Library: engine, providers, protocol schemas, bench runner and pack helpers exported from the package root. Bring your own model by implementing `Panelist`.
- `consensus init --from-profile` freezes a panel into a committed `consensus.config.json` and gitignores `.consensus/`.

### Accessibility and output

- `NO_COLOR`, and ASCII glyphs via `CONSENSUS_ASCII=1`, `LANG=C` or `TERM=dumb`.
- Live `debate.md` per run, `--verbose` streaming of verdicts and disputes, and `consensus log --html` for a self-contained shareable page.

### Known limitations

- Not published to npm.
- Codex seats report only a combined token total, so their cost is unpriced rather than estimated.
- The Gemini seat's MCP disabling uses an allow-list naming no server, unverified against a live connection.
- No ablation study of the protocol against single-model baselines; `bench --baseline` exists to run one.
- Installer checksums and signature verification are not implemented.

[Unreleased]: https://github.com/seanheiney/consensus/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/seanheiney/consensus/releases/tag/v0.1.0
