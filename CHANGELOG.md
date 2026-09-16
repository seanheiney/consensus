# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
