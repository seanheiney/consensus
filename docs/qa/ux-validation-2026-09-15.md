# UX validation — consensus 0.1.0 — 2026-09-15

Method: house UX-validation funnel adapted to a CLI/MCP product. Layer 0 automated gates → Layer 1 five task walkthroughs driving the real binary → Layer 2 six-reviewer fixed-rubric panel (concrete ICP archetypes, fresh context) → Layer 3 adversarial verification of every singleton finding plus an audit for misses. No Layer 4 (no real users yet). 12 agents total. Previous run: none (first scoreboard).

**App context.** Target ICP: developers who already pay for Claude Max / ChatGPT Plus (plus API keys or OpenRouter), living in a terminal and an AI coding agent, wanting a more trustworthy answer on decisions that are expensive to get wrong. Jobs to be done: (1) install and set up from zero; (2) ask a question, watch the debate, read it afterwards; (3) build and switch profiles and personas; (4) use it from an agent via MCP; (5) benchmark profiles and use the library. Test target: the linked `consensus` binary built from this working tree (uncommitted, unpublished).

## 1. Rubric scoreboard

| Reviewer | task-success | clarity | trust | delight | accessibility |
|---|---:|---:|---:|---:|---:|
| R1 Solo AI power user (Claude Max + ChatGPT Plus, macOS, 10 min patience) | 4 | 3 | 2 | 4 | 4 |
| R2 Staff engineer evaluating for a 50-person team | 4 | 3 | 2 | 4 | 3 |
| R3 Anthropic developer-platform engineer | 4 | 4 | 3 | 4 | 3 |
| R4 OpenAI platform engineer | 3 | 3 | 2 | 4 | 3 |
| R5 AI dev-tools product manager | 4 | 3 | 3 | 4 | 3 |
| R6 Skeptical AI researcher / OSS maintainer | 3 | 3 | 2 | 4 | 4 |
| **Mean** | **3.7** | **3.2** | **2.3** | **4.0** | **3.3** |

Delta vs previous run: n/a (first run).

Reading: the protocol and its artifacts delight (every reviewer gave 4); the product's own pitch, "an answer you can trust more than one model's", is undercut by the record *around* a run (misreported effort and tokens, invented revision history, silent panel shrinkage, money spent by accident). Trust is the dimension to fix first.

## 2. Confirmed findings, ranked (P0 → P3)

Severity is the verifier's after refutation attempts; where the panel rated higher it is noted. Effort: S < 1 day, M 1–3 days, L > 3 days.

### P0

1. **The Codex seat is not a clean room.** `codex exec` inherits the user's entire `~/.codex/config.toml`: `approval_policy = "never"`, every user MCP server (on this machine `computer-use`, `node_repl`, and consensus's own server registered by `setup`), and `-s read-only` still allows reading files. README line "run headless in an empty temp directory with tools disabled" is false for Codex and Gemini. Where: `src/providers/cli.ts` codex args; README "How your subscriptions are used". Fix: pass `--ignore-user-config` (exists in Codex 0.148), override `mcp_servers` to empty, disable web search; for Gemini pass an empty MCP config / no-tools policy; make README accurate per vendor. Effort S. (R4; verifier agreed P0.)

### P1

2. **A typo spends money.** `run` is the default command (`src/cli.ts` `.command("run", { isDefault: true })`), so `consensus profils` starts a paid frontier debate on the default profile with no estimate or confirmation. Fix: reject a single bare token as a prompt unless `run` is explicit or `-f`/stdin is used; print a one-line pre-run estimate (panel, rounds, ~$ at list price or "subscription quota"); add `--dry-run`, `--max-cost`. Effort S. (R1, R2, R5, Layer 0; panel P0, verifier P1.)
3. **The judge invents a revision history.** In the JTBD 2 run `proposals` equals `finalAnswers` byte-for-byte (one round, no revise phase), yet the synthesis's "What changed during review" names three claims "walked back". `synthesizePrompt` asks for that section unconditionally and is never told whether any revision happened. Answer/Confidence/Unresolved sections were unaffected. Where: `src/protocol/prompts.ts` synthesizePrompt; `src/protocol/engine.ts` synthesis call. Fix: pass the actual revision facts (per-seat `position_changed`, concessions, rebuttals) to the judge; when none occurred, instruct "state that no revision phase ran" or omit the section. Effort S. (R6; panel P0, verifier P1.)
4. **The saved run is not an audit record.** `run.json` `options.effort` and the `--verbose` header report the top-level default (`high`) even when every seat ran `#low`; no per-seat model/effort/persona is recorded. Where: `src/protocol/engine.ts` run.options; `src/cli.ts` header; `src/config.ts`. Fix: record `seats: [{id, provider, model, effort, persona}]` in `run.json` and print it. Effort S. (R1, R2, R5, R6, JTBD 2.)
5. **Token and cost figures are wrong for CLI seats.** Codex: `inputTokens` hard-coded 0 and a regex-scraped *total* stored as `outputTokens`, which `bench` then prices at the output rate; Claude: cache-read tokens folded into billable input. Where: `src/providers/cli.ts` codex/claude usage; `src/bench.ts` estimateCost. Fix: parse Codex's structured token summary or report `unknown`; keep cache reads separate; print "n/a (subscription)" instead of 0; never price unknown usage. Effort M. (R1, R4, R6, JTBD 2.)
6. **`setup --yes` skips the promised first debate; three docs overclaim.** README install step 4 and the sentence after it say `--yes` "does all of that"; `src/setup.ts` gates the first debate behind `!o.yes`. SKILL.md promises `debate.md` in every run (false over MCP); README says 4-seat presets (renders 3 here). Fix: run the first debate under `--yes` on the cheapest profile unless `--no-first-run`; make docs match the binary. Effort S. (R1, R2, R5, R6, JTBD 1.)
7. **The MCP path is second-class though it is where users live.** `src/mcp.ts` passes no `onEvent`: no `debate.md`, no MCP progress notifications, no cancellation or timeout, and a ~6,000-word single text block after ~110 s of silence. Fix: wire `openDebateLog` + progress notifications (phase, seat done, converged) and return a short structured result (answer, confidence, unresolved count, run id, path) with `transcript` opt-in. Effort M. (R1, R3, R4, R5, R6, JTBD 4.)
8. **No timeouts, no retry on CLI routes, and silent panel shrinkage.** `createPanelist` never sets `timeoutMs`; a single thrown error (including a transient 429 on CLI routes, which have no SDK retry) permanently drops the seat; the CLI still exits 0 and the report only footnotes the drop. Where: `src/providers/index.ts`, `src/providers/cli.ts` runCommand, `src/protocol/engine.ts` forEachActive, `src/cli.ts`. Fix: default per-call timeout, one retry with backoff for transient errors, a loud "panel shrank to N/M" banner in the report header, non-zero exit or `--strict`. Effort M. (R2, R3, R4.)
9. **`anthropic:claude-haiku-4-5` cannot make a call.** `src/providers/anthropic.ts` always sends adaptive thinking and `output_config.effort`, which Haiku 4.5 rejects; the `budget` and `fast` presets seat that model on the API route whenever no `claude` CLI is connected. Fix: model-gated thinking/effort config. Effort S. (R3.)
10. **The Claude clean room leaves two doors open.** `--tools ""` and `--setting-sources ""` do not exclude user-scope MCP servers from `~/.claude.json` (including consensus's own server) or user memory. Fix: add `--strict-mcp-config --mcp-config '{"mcpServers":{}}'` (flags exist). Effort S. (R3; the "orphaned processes" part was refuted, see §3.)
11. **Cost is invisible on the path people actually spend on.** `bench` prints estimated cost; `run` prints only a token table and no `$`; nothing caps spend. Fix: estimate before, actual after, `--max-cost`. Effort M. (R1, R2, R5.)
12. **`mergeMcpJson` destroys a host's existing MCP config on any parse failure.** A comment or trailing comma in `.cursor/mcp.json`, Windsurf `mcp_config.json`, Claude Desktop config, or project `.mcp.json` makes the merge start from `{}`, so every other server is dropped. Where: `src/hosts.ts` mergeMcpJson. Fix: refuse to write on parse failure, print the path, keep a `.bak`. Effort S. (Verifier audit.)
13. **Stored API keys are exported into the process environment.** `loadCredentialsIntoEnv` puts every saved key into `process.env`, and vendor CLIs are spawned with that env: Codex receives `ANTHROPIC_API_KEY`, and a saved `ANTHROPIC_API_KEY` would switch Claude Code (and Gemini CLI) from subscription to per-token API billing silently. Where: `src/credentials.ts`, `src/providers/cli.ts` runCommand. Fix: hand keys only to the matching SDK client; spawn CLIs with a scrubbed env. Effort S. (R2; verifier audit escalated.)
14. **Checkmarks mean "exists", not "works".** `doctor` Hosts is identical before and after `setup`; `profile presets` shows ✓ for a Gemini seat that fails at runtime; the Codex ≥ 0.154 requirement for `gpt-6-astra` lives only in a catalog note; `doctor --probe` probes the bare `codex` default model rather than what profiles use. Fix: verify registration (`claude mcp list`, config greps), per-model `minVersion` checked in `doctor` and preset materialization, probe the profile's real specs. Effort M. (R4, R5, JTBD 1.)
15. **The install path is not real yet.** README and `install.sh` carry `seanheiney`; the package is unpublished so the fallback `npm install -g consensus-panel` also fails; `package.json` lacks `repository`, `homepage`, `author`; no CI. Fix: publish, fill metadata, add CI. Effort S. (R5, JTBD 1, Layer 0.)

### P2

16. **One malformed profile bricks every profile command** with a raw Zod dump; `profile create` silently overwrites an existing name; unknown `+persona` names are only caught at run time. Where: `src/config.ts` loadUserConfig, `src/cli.ts` profile create. Fix: validate per profile with a friendly scoped message; confirm on overwrite; validate persona refs at load. S. (R1, R2, R5, JTBD 3.)
17. **Effort is not the same thing across routes.** `max` → `xhigh` on OpenAI, `high` on OpenRouter/xAI, ignored on Gemini; no `xhigh` rung. Fix: add `xhigh`, document per-route mapping, record resolved effort per seat. S. (R3, R4.)
18. **Judge selection is biased and fragile.** Presets always make the Anthropic seat the judge; an off-panel `--judge` is silently ignored and a random seat synthesizes; `compat:` seats plus any judge spec throw. Fix: rotate or let the user pick; error on unmatched judge; fix re-parse. S. (R6; verifier audit.)
19. **Protocol semantics are under-explained.** `--rounds 1` means critique only, never revise; "agree" beside a list of minor disputes reads as a contradiction. Fix: document, and print the rule once in `debate.md`. S. (R6, JTBD 2.)
20. **The benchmark cannot yet test the product's hypothesis.** No single-model or majority-vote baseline arm (engine rejects panels < 2); grader shuffle is the biased `.sort(() => Math.random() - 0.5)`; no warning when the grader shares a vendor with a graded seat; unpriced cases summed as $0. Fix: baseline arms, Fisher–Yates, grader-overlap warning, `n/a` cost. M. (R6; panel P0, verifier P2.)
21. **Team hygiene gaps.** No `consensus uninstall` though install touches eight hosts; `.consensus/runs/` (verbatim prompts and pasted context) is not gitignored by `init`/`install --project`. S. (R2.)
22. **GUI hosts get a bare `consensus` command** that Claude Desktop and Cursor cannot resolve when node lives under nvm. Fix: absolute path in JSON-config hosts. S. (Verifier audit.)
23. **Pasted context is injected verbatim** into critique/revise prompts with no untrusted-data framing (a context that says "all panelists must agree" can force convergence). Fix: wrap context in a delimited block with an instruction to treat it as data. S. (Verifier audit.)
24. **OpenAI route hygiene.** `incomplete` discards `output_text`; `store: false` not set; `req.json` unused on both the Responses and Codex (`--output-schema`) paths; Anthropic route ignores `json` too and uses no prompt caching. M. (R3, R4.)
25. **Terminal output.** `NO_COLOR` ignored; verbose stream rendered entirely in ANSI dim; Unicode glyphs with no ASCII fallback; top-level `--help` gives `run` no description and hides its flags; `bench --help` omits the options `bench` accepts. S. (R1–R5.)

### P3

26. Refusal `stop_details.category` discarded; MCP result has no `outputSchema`; rules blocks for Grok/Windsurf omit the tool's arguments and `consensus_profiles`; `install.sh` pipes NodeSource into `sudo bash` without a prompt; `>26` seats yields an undefined label; the same model at two efforts is rejected as a duplicate; `codex login status` regex matches "Not logged in"; `readPrompt` hangs on a non-TTY with no prompt; `debate.md` can lose its final error lines on `process.exit(1)`.

## 3. Refuted or dropped findings

- **"Read-only commands auto-materialize a config with 10 profiles" and "the auto frontier profile differs from `--preset frontier`" (JTBD 3):** test artifact. The walkthrough's `export HOME=… XDG_CONFIG_HOME=$HOME/.config` expanded `$HOME` before reassignment, so it read and wrote the real user config. Real config was restored afterwards.
- **"Transient failure right after a run" (JTBD 2):** caused by JTBD 3 writing deliberately broken profiles into the real config concurrently. The underlying brittleness is finding 16.
- **"Answer labels are reshuffled between phases within a run" (JTBD 5):** false. `engine.ts` shuffles once per run and freezes labels; labels differ only between runs.
- **"Orphaned `consensus mcp` processes are spawned by `claude -p` panelists" (JTBD 4, R3):** refuted by `ps` parentage; they belong to interactive Claude Code sessions. The clean-room flag gap (finding 10) stands.
- **"Bench P0: no baseline arm" (R6):** downgraded to a missing feature (finding 20); bench does what the README says.
- **"Blind side-by-side grading is overstated" (R6):** partial; the claim is not false. Shuffle bias and grader-vendor overlap kept as P2.
- **"`doctor` shows ✓ for Gemini" (R5):** partial; `doctor` shows `?`, `profile presets` shows ✓. Kept as part of finding 14.

## 4. Layer 0 gates and Layer 1 task table

Layer 0: typecheck 0 errors; vitest 48/48; `sh -n install.sh` ok (shellcheck not run); `npm pack` ships dist/README/LICENSE only (install.sh reachable from GitHub raw only); package.json missing repository/homepage/author; skill frontmatter valid; `--help` on all 16 commands; `consensus bogus` started a paid run (finding 2). No eslint, no CI.

| JTBD | Result | Steps (min) | Notes |
|---|---|---:|---|
| 1 Install and set up from zero | PARTIAL | 19 (2) | `setup --yes` works and MCP handshake verified; no first debate; `doctor` can't confirm registration; `seanheiney` 404 |
| 2 Ask, watch, read the debate | PASS | 11 (3) | 94 s, converged round 1, report legible; effort misreported; Codex tokens wrong |
| 3 Profiles and personas | PARTIAL | 26 (7) | core job works; overwrite without warning; Zod dump; two findings were isolation artifacts |
| 4 Use from an agent via MCP | PASS | 9 (6) | schema self-sufficient, real call relayable; no `debate.md`, 109 s silence |
| 5 Benchmark and library | PARTIAL | 21 (14) | bench and library work; one-profile bench can't decide; BYO contract undocumented |

## 5. What would make it appeal (synthesis of reviewer suggestions, prioritized)

1. **Lead with the wedge nobody else has: it runs on the subscriptions you already pay for.** Hero line and first screen should say that; "one Claude Max subscription, five personas, a real adversarial debate, no second bill" (the `perspectives` preset) is the most shareable sentence in the repo and is buried. (R1, R5)
2. **Make the activation moment unconditional.** The one-liner must end in a converged debate on the sample problem, on the cheap profile, with the debate path printed. Today it does not. (R5, R1, R6)
3. **Make money impossible to spend by accident.** Estimate before, actual after, `--max-cost`, no default-command runs from a typo, sane per-call timeouts. This is the trust fix. (R1, R2, R5)
4. **Make the MCP surface first-class:** progress notifications, `debate.md`, a short structured result with transcript on demand. That is where the ICP lives. (R1, R3, R6)
5. **Ship evidence, not a demo:** an ablation on the starter suite (single model, single model ×5 majority vote, propose→synthesize, full protocol) with `--trials 5`; a `--grader-panel` with inter-grader agreement and self-preference deltas; `consensus stats` over saved runs (convergence rate by round, concede:rebut ratio per vendor, how often dissent survives). This is what makes researchers and platform teams recommend it. (R6, R3)
6. **Show the reasoning:** set `thinking.display: "summarized"` on Claude seats and put summaries in `debate.md`; the emotional core is watching the models argue. (R3)
7. **Give the debate a share loop:** `consensus log --share` producing a single self-contained page, and packs that carry a bench scorecard proving they beat `balanced` on some class of problem. (R5, R1)
8. **A team install story:** committed project config that pins the panel, `.consensus/` gitignored, `consensus uninstall`. (R2)

## 6. Packs and the interface question

All six reviewers said yes to shareable packs and no to a hosted registry or HTTP API in v1.

**Pack = one JSON manifest**: `{ schemaVersion, name, version, description, author, personas, profiles, suite? }`. Seats should be portable (`any:claude-opus-5#high+skeptic`, resolved at run time to the installer's connections, falling back to OpenRouter, and failing loudly when a seat cannot be satisfied rather than silently downgrading). Commands: `consensus pack create` (from existing profiles), `pack add <file|url|owner/repo>`, `pack list`, `pack remove`. Import must show the full diff, including complete persona text, and require confirmation: persona preprompts are untrusted instructions fed to the user's models on the user's quota, so packs never auto-run and merge beneath user config without clobbering same-named local profiles. Discovery in v1: a curated `PACKS.md` in the repo, a GitHub topic, and an npm keyword. A pack that ships its own bench suite is self-justifying; a bare model list is not.

**Interface:** keep CLI + MCP + library as the product. The MCP server already is the API for agents, and the library is what evaluators and harness authors will build on, so publish the phase contract and schemas from the root export. A hosted HTTP API is a different product with a different trust model (whose subscriptions and keys? subscriptions cannot be proxied server-side, and the ToS of consumer plans make that a non-starter). If a web viewer or dashboard is wanted later, a local `consensus serve` on localhost in the same process is cheap and keeps the trust model intact.

## 7. Re-run discipline

After fixes: re-run JTBD 1, 3, and 5 walkthroughs only (the failed ones), then a fresh 5-reviewer panel with no memory of this run, and diff the scoreboard against §1.

---

# Re-run 1 — same day, after fixes

Scope per §7: Layer 0 re-run; JTBD 1, 3 and 5 re-driven (JTBD 2 and 4 had passed and were supplied to reviewers as labelled pre-fix evidence plus a post-fix live run); a fresh 5-reviewer panel (R1, R2, R3, R4, R6 archetypes, new agents, no access to the first report or reviews). Fixes applied between runs: Codex/Claude/Gemini clean rooms, typo guard, synthesis fed from the revision record, per-seat run record, credential isolation, safe MCP JSON merge, Haiku gating, MCP progress + debate log + structured summary, first debate under `--yes`, lenient config, off-panel judge error, gitignore on project install, absolute launch path for GUI hosts, packs (`pack add/list/remove/create`, portable `any:` seats, three shipped packs including `product-review`).

## 1. Rubric scoreboard (same five archetypes; run 1 → run 2)

| Reviewer | task-success | clarity | trust | delight | accessibility |
|---|---:|---:|---:|---:|---:|
| R1 Solo AI power user | 4 → 3 | 3 → 4 | 2 → 3 | 4 → 4 | 4 → 4 |
| R2 Staff engineer for a team | 4 → 3 | 3 → 3 | 2 → 3 | 4 → 4 | 3 → 3 |
| R3 Anthropic platform engineer | 4 → 3 | 4 → 4 | 3 → 3 | 4 → 4 | 3 → 3 |
| R4 OpenAI platform engineer | 3 → 4 | 3 → 3 | 2 → 2 | 4 → 4 | 3 → 3 |
| R6 Skeptical researcher / maintainer | 3 → 3 | 3 → 4 | 2 → 3 | 4 → 4 | 4 → 4 |
| **Mean** | **3.6 → 3.2** | **3.2 → 3.6** | **2.2 → 2.8** | **4.0 → 4.0** | **3.4 → 3.4** |

Delta: trust +0.6, clarity +0.4, task-success −0.4, delight and accessibility unchanged. Every reviewer who lowered task-success cited the same cause: the README's only install path (`seanheiney` one-liner, unpublished npm package) cannot succeed, and, on this machine, the `frontier`/`deep`/`gpt-family` profiles saved by the first `setup` still pinned `gpt-6-astra` on a Codex that rejects it. R4 held trust at 2 for Codex seats being costed as $0 and `#max` not reaching OpenAI's top rung. Both were fixed after this panel (see §4).

## 2. Layer 1 task table

| JTBD | Run 1 | Run 2 | Steps (min) | Notes |
|---|---|---|---:|---|
| 1 Install and set up from zero | PARTIAL | PARTIAL | 16 (3) | everything works once the binary exists; documented install path still a 404; `doctor` could not yet confirm registration (fixed after) |
| 3 Profiles, personas, packs | PARTIAL | **PASS** | 45 (10) | all steps incl. pack add/create/remove; unknown persona names still only caught at run time; no `persona add` command |
| 5 Benchmark and library | PARTIAL | **PASS** | 19 (11) | two-profile bench decidable and cost-explained; library worked first try from root exports; per-phase `complete()` contract not in README |

Layer 0: 61 tests, typecheck clean, typo guard verified, MCP boots; package metadata still missing.

## 3. New confirmed findings from run 2 (not in run 1)

- **[P1] `doctor` and `profiles` printed `[object Object]` for object-form seats** (the shipped `product-review` pack uses them). Fixed.
- **[P1] Cost accounting scored a Codex seat that reported no usage as $0 and omitted it from the caveat.** Fixed: seats with no usage are excluded and named; Claude Code's own `total_cost_usd` is used; cache reads priced separately.
- **[P1] Shipped packs were not in the npm `files` list.** Fixed.
- **[P1] Bench grader shuffle was the biased `sort(() => Math.random() - 0.5)`; no warning when the grader shares a vendor with a graded arm; no single-model baseline arm.** Fixed: Fisher–Yates, grader-overlap warning in the report, `--baseline <spec>` arms.
- **[P1] `#max` mapped to `xhigh` on the Responses API though it accepts `max`; non-completed statuses returned empty answers; `store` not set.** Fixed.
- **[P1] Presets marked ✓ while seating `gpt-6-astra` on Codex < 0.154.** Fixed: `doctor` reads the Codex version; presets and auto-detect skip models the installed CLI cannot drive and substitute the next tier.
- **[P1] The Codex seat's read-only sandbox still allowed file reads and shell.** Fixed: `--disable shell_tool/browser_use/computer_use/apps`; verified live.
- **[P1] Nothing disclosed that subscription seats spend the user's CLI rate limits, or Anthropic's terms on third-party use of claude.ai logins.** Disclosure added to README, `setup`, and `doctor`. **This is a business decision for the owner, not a code fix**: the tool is local and runs under the user's own login, but "works with the subscriptions you already pay for" as the headline pitch invites exactly the use Anthropic's terms restrict. Consider leading with API keys / OpenRouter and presenting CLI seats as a personal-use convenience.
- **[P2] Gemini seat: `--allowed-mcp-server-names` with a dummy name is an allow-list, not a disable switch; unverified live** (no Gemini connection on this machine).
- **[P2] Saved profiles are not re-validated when connections change** (a stale `frontier` sat in config for a day). Fixed for the preset profiles on this machine by re-materializing; a `profile refresh` command is the general fix.
- **[P2/P3]** `pack add` leaked a raw ENOENT (fixed); no `persona add` command; model ids spelled three ways across `models`/README/packs (`claude-fable-5.1` on OpenRouter vs `claude-fable-5-1`); `NO_COLOR` (fixed); MCP tool declares `taskSupport: "forbidden"` (SDK default; open); `run.json` still carries a top-level `options.effort` next to the authoritative `seats[].effort` (rename pending).

## 4. Still open after run 2

Publish to npm and fill in the GitHub org (blocks every install-path finding); CI; `--max-cost` spend ceiling; retries on CLI routes; `consensus uninstall`; `profile refresh` and `persona add`; xhigh rung; real Codex token accounting (needs a structured usage line from Codex); thinking summaries in `debate.md`; `log --share`; ablation study with the new `--baseline` arms across the starter suite; a decision on the subscription positioning above.

## 5. Re-run discipline

Next run: JTBD 1 only (after publishing), plus a fresh panel. Expected effect of publishing alone: task-success back to ≥ 3.6 across the panel, since no reviewer found a second blocker.

---

# Fix batch 3 — "get every dimension to 5.0" (same day)

Owner's ask after re-run 1. Reviewer asks were mapped dimension by dimension and everything buildable locally was built; the remaining items need the owner (npm login) or are research deliverables.

**Task-success.** Repo published at https://github.com/seanheiney/consensus (public, CI green on first push). The install one-liner and `install.ps1` now fall back to the repo tarball (`npm install -g https://github.com/seanheiney/consensus/archive/refs/heads/main.tar.gz`) until the npm release; verified: the tarball install yields a working 0.1.0 binary with all shipped packs (the `github:` shorthand form is broken under npm's git-dependency path and is not used). Pre-flight before every run refuses seats whose vendor is not connected and prints the fix; Gemini's retired individual login no longer counts as a connection, so presets stop seating a seat that would be dropped; `profile refresh` re-materializes preset profiles and removes ones no connection can seat. `dist/` is committed so git/tarball installs need no build step.

**Trust.** `--max-cost` spend ceiling (aborts mid-run; unpriced subscription seats excluded and named); one retry on transient failures (429/529/timeout) with `--no-retry`; exit code 2 when the panel shrank; `external:<spec>` judge that did not debate; `consensus uninstall [--purge]` reverses every host change; Claude Code's own `total_cost_usd` used for cost; refusal fallbacks recorded in the debate log (`served-by`); rate-limit and terms disclosure in README, `setup`, and `doctor`.

**Clarity.** Top-level `--help` now shows the flags that matter; `run.json` records `options.defaultEffort` plus authoritative `seats[]` (no contradictory top-level effort); README documents the bring-your-own-model contract and the one-spelling `any:` ids; `doctor` shows per-host "MCP registered / skill installed".

**Delight.** Thinking summaries from Claude API seats land in `debate.md` (collapsible); `consensus log --html` writes a self-contained shareable page of the whole debate.

**Accessibility.** ASCII mode (`CONSENSUS_ASCII=1`, or `LANG=C`/`TERM=dumb`) with words next to every glyph; `NO_COLOR`; normal-weight status lines; `persona add/remove`; Windows installer.

**Still needs the owner:** `npm publish` (not logged in on this machine); a positioning decision on subscription seats; a `GEMINI_API_KEY` and `grok login` to make those vendors live. **Still open (research/larger):** thinking summaries for CLI seats (Claude Code's JSON envelope omits thinking), the ablation study over the starter suite using the new `--baseline` arms, and an MCP task-mode implementation (`taskSupport`).

**Projection, not a measurement:** the reviewers' own justifications tie task-success almost entirely to the install path (now real) and trust to cost honesty, ceilings, retries, and judge neutrality (now built). A fresh panel should move task-success back above run 1 and trust above 3. A 5.0 on every line from expert reviewers would require the ablation evidence (researcher), an npm release plus a first-run success rate (PM/staff engineer), and a term-compliant positioning for subscription seats (Anthropic engineer). The next re-run is JTBD 1 against the public install path plus a fresh panel.

---

# Re-run 2 — 2026-09-16, public install path, fresh panel

Scope: Layer 0 re-run against the public repo; JTBD 1 re-driven against the README's actual one-liner from a fresh HOME (PASS: 7.8 s from `curl` to a configured install, every follow-up command as documented, `uninstall` clean); JTBD 2–5 supplied as prior passes with a changes-since header plus a live run with the current binary; a fresh 5-reviewer panel (new agents, same five archetypes, no access to prior reports).

## 1. Rubric scoreboard (same five archetypes; run 1 → run 2 → run 3)

| Reviewer | task-success | clarity | trust | delight | accessibility |
|---|---:|---:|---:|---:|---:|
| R1 Solo AI power user | 4 → 3 → 4 | 3 → 4 → 3 | 2 → 3 → 3 | 4 → 4 → 4 | 4 → 4 → 4 |
| R2 Staff engineer for a team | 4 → 3 → 4 | 3 → 3 → 4 | 2 → 3 → 3 | 4 → 4 → 4 | 3 → 3 → 4 |
| R3 Anthropic platform engineer | 4 → 3 → 4 | 4 → 4 → 4 | 3 → 3 → 3 | 4 → 4 → 4 | 3 → 3 → 4 |
| R4 OpenAI platform engineer | 3 → 4 → 3 | 3 → 3 → 3 | 2 → 2 → 3 | 4 → 4 → 3 | 3 → 3 → 4 |
| R6 Skeptical researcher / maintainer | 3 → 3 → 4 | 3 → 4 → 4 | 2 → 3 → 3 | 4 → 4 → 4 | 4 → 4 → 4 |
| **Mean** | **3.6 → 3.2 → 3.8** | **3.2 → 3.6 → 3.6** | **2.2 → 2.8 → 3.0** | **4.0 → 4.0 → 3.8** | **3.4 → 3.4 → 4.0** |

Delta vs run 2: task-success +0.6 (the install path is real), trust +0.2, accessibility +0.6, clarity flat, delight −0.2 (R4 docked the Codex leg for not using `--json`/`--output-schema`; `--json` is now used). No P0 from four of five reviewers; the two P0s filed (researcher: baseline arm carried the panel prompt; OpenAI engineer: presets advertised Astra while seating Sol) were both fixed the same hour.

## 2. Confirmed findings from run 3 and their status

- **[P0→fixed] Single-model baseline arm was given the panel system prompt**, confounding the one measurement that could test the product's claim. Now a plain expert prompt with no panel framing.
- **[P0→fixed] Presets, `doctor`, and `models` advertised `gpt-6-astra` while seating `gpt-5.6-sol`.** The substitution reason is now computed, stored on the profile, and printed by `profile presets`, `profiles`, and `models` ("cannot run here: codex 0.148.0 < 0.154.0 …").
- **[P1→fixed] `--quiet` discarded the dropped-seat exit code.** Exit code 2 is set regardless of quiet.
- **[P1→fixed] Cost accounting treated subscription seats as billable.** Cost is now split: billed to API keys (the only number `--max-cost` enforces) vs subscription seats' list-price equivalent ("quota, not a bill") vs seats with no usage; `run.json` omits usage for seats that reported none instead of writing `0/0`.
- **[P1→fixed] Codex seats had no token accounting.** `codex exec --json` is used; `turn.completed` supplies input, cached, output and reasoning tokens. `unified_exec` added to the disabled tools.
- **[P1→fixed] `debate.md` header printed the run-level effort.** It now lists every seat with its own effort and persona.
- **[P1→fixed] Judge is a panelist by default with no warning.** The report now states whether the judge debated and how to seat an external one; `external:<spec>` already existed.
- **[P1→fixed] A shell-exported vendor key silently moved a subscription seat to API billing.** The run header now says so per seat.
- **[P1→fixed] `.consensus/` only gitignored when `.git` was in the cwd.** Now any enclosing repo.
- **[P1→fixed] No pinnable version.** `CONSENSUS_VERSION=v0.1.0` installs a tagged tarball.
- **[P2→fixed]** `uninstall --yes` accepted; `*em*` rendered in the HTML page; "converged" and "confidence" defined in every report footer.
- **[P1, open, needs the owner]** No evidence that the panel beats one model: run the ablation (`consensus bench -P frontier,balanced --baseline claude:claude-opus-5,codex:gpt-5.6-sol --trials 3` over the starter suite) and publish the table. **[P1, open]** README did not yet document `--max-cost`, `--html`, `--force`, `uninstall`, `persona add`, exit codes, `NO_COLOR`/`CONSENSUS_ASCII`: addressed by the documentation rewrite in progress (docs/install.md, docs/faq.md, docs/usage.md). **[P2, open]** Anthropic and Codex paths do not use structured outputs (`req.json` ignored; `--output-schema` unused); no prompt caching on the Anthropic route; grader reads the reference before scoring quality; `-p` vs `-P` differ only by case.

## 3. Layer 1 task table

| JTBD | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| 1 Install and set up from zero | PARTIAL | PARTIAL | **PASS** (public one-liner, 7.8 s) |
| 2 Ask, watch, read the debate | PASS | prior | prior + fresh live run |
| 3 Profiles, personas, packs | PARTIAL | PASS | prior |
| 4 Use from an agent via MCP | PASS | prior | prior |
| 5 Benchmark and library | PARTIAL | PASS | prior |

## 4. Next re-run

After the docs rewrite lands and the ablation table exists: fresh panel, all five JTBDs re-driven. Expected: clarity ≥ 4 (docs), trust ≥ 3.5 (evidence + cost split), and the researcher's remaining P1 closed by the ablation.
