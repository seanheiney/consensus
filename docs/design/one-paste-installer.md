# One-paste installer: research and design

Status: design, not implemented. Owner decision needed on the open questions at the end.
Date: 2026-09-16. Sources are the live installer scripts and docs fetched that day (links inline).

## TL;DR

**Recommendation: stop requiring Node. Ship a self-contained per-platform archive on GitHub Releases
(official Node runtime + one bundled `cli.mjs` + a launcher) that `install.sh` downloads into
`~/.consensus/`, verifies by SHA-256 (+ GitHub artifact attestation), links as `~/.local/bin/consensus`,
adds to PATH via a sourced env file, then hands the terminal to `consensus setup` with `exec </dev/tty`.**

That turns the paste from "curl → fnm installer → Node download → `npm install -g` of a GitHub tarball
resolving ~190 packages → hope PATH works" (3 network hops, 2-4 min, five distinct ways to stall) into
"curl → one 35 MB download → extract → wizard" (1 hop, ~15 s before the first question, zero `npm`,
zero `sudo`, no touching the user's Node). It is the same shape as Claude Code's native installer
(`claude.ai/install.sh`), Codex's (`chatgpt.com/codex/install.sh`), uv, Bun and Deno, and the same
shape OpenClaw uses for its "private runtime" path (`install-cli.sh` → `~/.openclaw/tools/node`).

npm stays as a second channel (publish `consensus-panel` with provenance; same bundled code), a
Homebrew tap and winget come after, and Node SEA / `bun build --compile` remain an optional later
packaging change that does not alter the user experience.

---

## 1. How the best one-paste installers actually work

### 1.1 Comparison table

| Installer (source) | Runtime story | sudo | PATH: files touched and message | Wizard with piped stdin | No TTY / CI | Checksum / signing | Idempotence / upgrade | Telemetry consent | Windows | First screen after install |
|---|---|---|---|---|---|---|---|---|---|---|
| **OpenClaw** `openclaw.ai/install.sh` (146 KB bash) + [installer internals](https://docs.openclaw.ai/install/installer) | Requires Node 24.16+/26.1+. Detects nvm (`nvm.sh --no-use`), Homebrew, system binaries; installs via brew (mac) / NodeSource (Linux) / apk / pacman; **falls back to a checksum-verified private Node under `~/.openclaw/tools/node`** (`install-cli.sh` always does this) | Uses `sudo` for system Node/git; if npm prefix unwritable → `npm config set prefix ~/.npm-global` + PATH persist | `persist_shell_path_prepend`: from `$SHELL` picks zsh: `.zshrc`+`.zprofile`; bash: `.bashrc`+(`.bash_profile`\|`.bash_login`\|`.profile`); fish: `conf.d/openclaw.fish` with `fish_add_path`; also updates any *other* rc files that already exist; refuses symlinks escaping `$HOME`. Prints "PATH updated in ~/.zshrc … New terminals pick this up automatically. For this shell, run: `source ~/.zshrc; hash -r`" | `has_controlling_tty()` tests `/dev/tty` r+w and `: </dev/tty`; on fresh install does literally `exec </dev/tty; exec "$claw" onboard`; `--no-prompt` routes subprocess stdin to `/dev/null` | `is_non_interactive_shell` = `NO_PROMPT=1` or `! -t 0 || ! -t 1`; prints "No TTY; run `openclaw onboard` to finish setup" | Verifies gum helper by `checksums.txt`; private Node tarball SHA-256; npm package itself relies on npm | Upgrade path: config present → runs `doctor --fix` (+`--non-interactive` if no TTY) instead of onboard; retires previous install kinds | No installer telemetry | `install.ps1`: winget → choco → scoop → **downloads official Node zip to `%LOCALAPPDATA%\OpenClaw\deps\portable-node`**; adds bin to *user* PATH; `& ([scriptblock]::Create((iwr ...))) -NoOnboard` for flags | Celebration line + random one-liner, then `openclaw onboard` (QuickStart vs Custom, provider/auth, **live completion gate** before continuing) |
| **Bun** `bun.sh/install` | Standalone binary (zip) to `~/.bun/bin` | None; fails if dir not writable | `$SHELL`: fish `config.fish` (`set --export`), zsh `.zshrc`, bash first writable of `.bash_profile`/`.bashrc`/XDG variants; prints "To get started, run: `exec /bin/zsh` / `source ~/.bashrc`; bun --help" | n/a (no wizard) | Fine | **None** | Overwrites (`unzip -o`); may duplicate rc lines | None | `bun.sh/install.ps1` | "bun was installed successfully to ~/.bun/bin/bun" |
| **uv** (cargo-dist) `astral.sh/uv/install.sh` | Standalone binary → `$XDG_BIN_HOME` / `~/.local/bin` | None | Writes an **env script** (`~/.local/bin/env` + `env.fish`) that guards against duplicates; appends `. "$HOME/.local/bin/env"` to `.profile`, `.bashrc`, `.bash_profile`, `.bash_login`, `.zshrc`, `.zshenv`, fish `conf.d/uv.env.fish`; `--no-modify-path` / `UV_NO_MODIFY_PATH`; message: "To add $HOME/.local/bin to your PATH, either restart your shell or run: `source $HOME/.local/bin/env`" | n/a | Fine | **SHA-256 embedded in the script per artifact**; verifies with sha256sum/openssl/b2sum, degrades gracefully | **Receipt** `~/.config/uv/uv-receipt.json` so `uv self update` knows layout/version | None | `astral.sh/uv/install.ps1` | one line: installed + PATH hint |
| **Homebrew** `install.sh` | n/a (installs itself) | Asks up front with `sudo -l`, `sudo -k` trap on exit; `SUDO_ASKPASS` | Prints "Next steps" with `eval "$(/opt/homebrew/bin/brew shellenv)"` >> `.zprofile` / `.bashrc` / fish | `getc` via `stty` on `/dev/tty`; "Press RETURN/ENTER to continue or any other key to abort" | `NONINTERACTIVE=1`, `CI=1`, or stdin not a tty → skips prompt | git-based | Re-runs fix ownership/permissions | Post-install analytics (opt-out `HOMEBREW_NO_ANALYTICS`) | n/a | "Installation successful!" + Next steps block |
| **Deno** `deno.land/install.sh` | Standalone zip → `~/.deno/bin` | None | Delegates to a `shell-setup` subprocess: only when stdout is a TTY and `CI` unset (or `-y`); connects `/dev/tty` to stdin when piped; `--no-modify-path` | `/dev/tty` handoff for its own prompt | `CI` env → no prompt | none in script | overwrite | none | `deno.land/install.ps1` | "Deno was installed successfully to …; Run 'deno --help'" + Discord link |
| **rustup** `sh.rustup.rs` | Downloads `rustup-init` binary | None | rustup-init writes `~/.cargo/env` + `env.fish`, edits `.profile`/`.bashrc`/`.zshenv`/fish; `--no-modify-path` | If `! -t 0` but stdout visible → `</dev/tty`; else "Unable to run interactively. Run with -y to accept defaults" | `-y` | none in script (binary is signed by rustup) | rustup manages itself | none | `rustup-init.exe` | "1) Proceed with standard installation" menu, then "Rust is installed now. Great!" + `source "$HOME/.cargo/env"` |
| **Ollama** `ollama.com/install.sh` | Static bundle to `/usr/local` (Linux); macOS opens app | **Requires root/sudo** ("This script requires superuser permissions") | Installs into a dir already on PATH; none | n/a | Fine | none (`OLLAMA_VERSION` pin only) | overwrite; systemd service | none | separate installer | "Install complete. Run \"ollama\" from the command line." |
| **Claude Code** `claude.ai/install.sh` → `downloads.claude.ai/.../bootstrap.sh` + [setup docs](https://code.claude.com/docs/en/setup) | **Native (Bun-compiled) binary, no Node**; cached in `~/.claude/downloads`, versions under `~/.local/share/claude/versions/`, launcher symlink `~/.local/bin/claude` | **Refuses to run under sudo** ("Error: do not run this installer with sudo") | Delegated to `claude install` (the binary edits PATH / prints the hint) | n/a in script; binary handles first run | `install.sh` takes `stable\|latest\|x.y.z` | **`manifest.json` SHA-256 per platform, GPG-signed manifest**, mac notarized, Windows Authenticode; checksum mismatch deletes binary | Auto-updates in background; `claude update`; `claude doctor` | first-run prompt | `irm claude.ai/install.ps1 \| iex`, plus `install.cmd`; winget; `& ([scriptblock]::Create((irm …))) stable` for args | "✅ Installation complete!" then `claude` → theme pick → login in browser → trust folder |
| **Codex CLI** `chatgpt.com/codex/install.sh` → `releases.openai.com/codex/install.sh` | **Native (Rust) binary, no Node**; `codex-package-<target>.tar.gz` (musl on Linux); releases under `~/.codex/packages/standalone/releases/<ver>-<target>/` with `current` symlink; `~/.local/bin/codex` symlink | None (all under `$HOME`) | From `$SHELL`+OS: mac zsh `.zprofile`, mac bash `.bash_profile`, Linux zsh `.zshrc`, Linux bash `.bashrc`, else `.profile`; **marked block** `# >>> Codex installer >>> … # <<< Codex installer <<<`; prints "Current terminal: `export PATH=\"$BIN_DIR:$PATH\" && codex`" and "Future terminals: open a new terminal and run: codex" | asks "Start Codex now? [y/N]" | `CODEX_NON_INTERACTIVE=1` skips prompts | **`SHA256SUMS` manifest**, verified with sha256sum/shasum/openssl; falls back to GitHub asset URL if primary fails | overwrites `current` symlink; keeps old releases | none in installer | npm or `brew install --cask codex`; native zip on releases | "Codex CLI x.y.z installed successfully." + launch prompt → login in browser |
| **fnm** `fnm.vercel.app/install` | Standalone binary | None | `$SHELL`: zsh `$ZDOTDIR/.zshrc`; fish `conf.d/fnm.fish`; bash `.profile` (mac) / `.bashrc` (Linux); `--skip-shell`; prints "open a new terminal or run the following command: source …" | n/a | fine | none | overwrite | none | winget/scoop/choco | one line |
| **Vercel CLI** ([docs](https://vercel.com/docs/cli)) | `npm i -g vercel` (Node required); experimental native `@vercel/vc-native` per-platform packages | npm's problem ("see npm's EACCES guide") | npm's | `vercel login` opens browser / device code | `VERCEL_TOKEN` | npm provenance | "update available" nag; `vercel upgrade` | **On by default**, `vercel telemetry disable` | same npm | `vercel login` |
| **consensus today** `install.sh` | Requires Node 22; installs via brew / fnm / nvm / NodeSource(opt-in) / **pipes fnm installer into bash**; then `npm install -g` of GitHub tarball (E404 fallback) | none, but `CONSENSUS_SYSTEM_NODE=1` pipes NodeSource into `sudo bash` | Only on the EACCES branch, only `.zshrc`/`.bashrc`, and it **permanently rewrites the user's npm prefix**; no fish, no `.profile`; message "open a new terminal later" | `consensus setup </dev/tty` when `! -t 0` (good), but no `-t 1` check, no CI check | falls back to `setup --yes` silently | optional `CONSENSUS_SHA256` the user must compute themselves; script itself fetched from `main` | re-run re-does the full npm install; no receipt; `consensus uninstall` does not remove the CLI or rc lines | none (good, but never stated) | `install.ps1`: winget only, else "install Node yourself"; `irm \| iex` cannot take `-Yes`; no PATH persistence | "Done. Next step:" two lines |

### 1.2 Patterns worth copying, with attribution

1. **Standalone artifact, verified, under `$HOME`, never sudo** (Claude Code, Codex, uv, Bun, Deno, rustup). The two closest peers to us, Claude Code and Codex, both *moved off* "npm is the installer" in the last year specifically because of Node-version, EACCES and PATH failures. Claude Code's docs even keep the npm package but make it download the same native binary.
2. **Env file + guarded rc lines** (uv, rustup): write one `env` script that prepends to PATH only if missing, then append a single `. "$HOME/.consensus/env"` line to every plausible rc file. Duplicates are impossible, removal is one `sed`, and fish gets its own `conf.d` drop-in.
3. **Marked block** (Codex) or **single marker comment** so uninstall can remove exactly what was added.
4. **`exec </dev/tty; exec "$bin" onboard`** (OpenClaw) as the wizard handoff. Precondition: `/dev/tty` readable+writable (`: </dev/tty`), stdout a TTY, no `--yes`/`CI`. Otherwise print the exact command to finish later. rustup's error text ("Unable to run interactively. Run with -y") is the right fallback when the user clearly expected a wizard.
5. **Upgrade ≠ install** (OpenClaw, Claude): if config already exists, don't re-run onboarding; run `doctor --fix` and say "upgrade complete".
6. **Receipt file** (uv) so `consensus update` / `uninstall` know what was installed where.
7. **Checksums in a manifest the script fetches, signed** (Claude Code manifest.json + GPG; Codex SHA256SUMS). uv embeds sums in the script itself, which only works because the script is regenerated per release.
8. **Version argument** (`install.sh | bash -s 0.2.0` / `stable`), and unversioned `releases/latest/download/<asset>` URLs (Bun) so the script needs no GitHub API call (rate limits, proxies).
9. **Refuse sudo** (Claude Code) rather than tolerate it: a root-owned `~/.consensus` is the #1 self-inflicted wound.
10. **PowerShell flags via scriptblock** (`& ([scriptblock]::Create((irm …))) -Yes`) since `irm | iex` cannot pass parameters (OpenClaw, Claude Code).
11. **Welcome moment**: everyone prints one bold success line naming the version, then either the next command or the wizard. OpenClaw's random taglines are fun but the important part is that the wizard's first screen *proves something works* (OpenClaw gates on a live completion; our `firstRun` debate is the equivalent and is a genuine differentiator: keep it, make it optional under `--yes`).
12. **No installer telemetry** is the norm; say so explicitly on the summary screen.

---

## 2. Where we diverge, and where a paste can fail or stall

Ranked by how many users hit it × how badly it ends. "Dead end" = the user has to read docs to continue.

| # | Failure / divergence | Where in our code | Impact |
|---|---|---|---|
| 1 | **No Node + no sudo on a fresh machine**: we pipe `fnm.vercel.app/install` into `bash` (needs bash + unzip; Alpine has neither), then `fnm install --lts`, then `eval "$(fnm env)"` *inside the installer only*. fnm's `--skip-shell` means the new terminal has no Node and no `consensus` → "Node 22+ still not on PATH… open a new terminal and re-run" **dead end**, and a second run hits the same thing. 3 network hops (fnm → nodejs.org → npm) before ours. | `install.sh` `install_node()` | Very high |
| 2 | **`npm install -g <github tarball>`** resolves ~190 packages from the registry: 60-120 s of silence because output goes to `$LOG`; npm `EBADENGINE`/deprecation noise on failure; not upgradeable by `npm update`; the `E404` detection is a regex over log text. Any registry hiccup / proxy = generic "npm install failed (see output above)". | `install.sh` `try_install`, `LOG` | Very high |
| 3 | **EACCES branch mutates global npm config** (`npm config set prefix ~/.npm-global`) which silently relocates every future global install for that user, and appends PATH lines only to `.zshrc`/`.bashrc`. | `install.sh` EACCES branch | High |
| 4 | **nvm/fnm users**: a global install belongs to one Node version; `nvm use 20` makes `consensus` vanish, and `mcpLaunchCommand({absolute:true})` bakes `process.execPath` (a versioned nvm path) into Cursor/Windsurf/Claude Desktop configs → MCP breaks after any Node switch. | `src/hosts.ts` `mcpLaunchCommand` | High (silent, delayed) |
| 5 | **PATH**: no fish support, no `.zprofile`/`.profile`, no "for this shell, run: …" line, and the happy path never verifies `$(npm prefix -g)/bin` is on PATH for *new* shells (it only checks `have consensus` in the installer's own PATH, which we exported). macOS users with a Homebrew Node are fine; everyone else is a coin flip. | `install.sh` | High |
| 6 | **TTY handling**: piped stdin is handled (`</dev/tty`), but we do not check stdout/stderr are TTYs or `CI`; on a non-TTY we silently switch to `--yes`, which by design connects nothing new and runs no debate, so a CI/Docker paste "succeeds" with 0 connections and one dim log line. rustup/OpenClaw print the command to finish instead. | `install.sh` tail; `src/setup.ts` `runSetup` | Medium-high |
| 7 | **No integrity story**: the script is fetched from `main` (moving target), `CONSENSUS_SHA256` requires the user to compute the hash of a tarball that GitHub regenerates, no signing, no provenance. `docs/install.md` admits "planned, not implemented". | `install.sh`, `docs/install.md` | High for adoption by anyone security-conscious |
| 8 | **No progress**: no step counter, no elapsed, no download progress bar; the only spinner is inside setup. | `install.sh` | Medium |
| 9 | **Summary screen** is two lines; does not say what was written where, whether PATH was changed, which hosts got MCP, or that no telemetry exists. | `src/setup.ts` `p.outro` | Medium |
| 10 | **Windows**: needs winget or a manual Node install; `irm … \| iex` cannot take `-Yes`; no PATH persistence of npm's prefix; no portable Node fallback; no checksum. | `install.ps1` | High for Windows users |
| 11 | **Proxies**: curl honours `HTTPS_PROXY`, npm needs its own `npm config set proxy`, fnm's installer needs curl+unzip; three different proxy surfaces. | docs only | Medium (corporate) |
| 12 | **`sh` is dash** on Debian/Ubuntu: `install.sh` is POSIX-clean (good), but it shells out to `bash` for fnm and to `sudo -E bash` for NodeSource. `curl` is absent on minimal Debian/docker images; no `wget` fallback. | `install.sh` | Medium |
| 13 | **Apple Silicon / Intel / Rosetta / musl**: currently irrelevant (npm is arch-agnostic) but Homebrew Node under Rosetta yields x64 Node; a standalone design must detect `uname -m` + `sysctl.proc_translated` and handle Alpine (official Node has no musl build). | n/a today | Medium once we ship binaries |
| 14 | **Idempotence**: re-run always re-downloads and reinstalls; setup re-asks every question; no receipt; `consensus uninstall` removes host wiring but not the CLI or rc lines ("Then: npm uninstall -g consensus-panel"). | `install.sh`, `src/cli.ts` `uninstall` | Medium |
| 15 | **Unpublished npm package** makes the documented `npm install -g consensus-panel` a lie until the first `v*` tag; the `github:` shorthand is broken; README says "not published yet". | `package.json`, `release.yml`, README | Medium (trust) |
| 16 | **WSL**: works as Linux, but `hosts.ts` cannot see Windows-side Cursor/Claude Desktop configs; not an installer bug, document it. | `src/hosts.ts` | Low |
| 17 | **First run under `--yes` with keys in env**: `credentialEnv()` merges `process.env`, so `ANTHROPIC_API_KEY=… sh install.sh --yes` works for detection but keys are not persisted; the next shell has 0 connections. | `src/setup.ts`, `src/credentials.ts` | Low-medium (CI/dotfiles users) |

---

## 3. Target experience

One paste → working `consensus` + connected accounts + IDEs wired, in under 2 minutes on a machine with
nothing installed. Budget on a 50 Mbit/s connection, bare macOS: script 0.5 s, download 35 MB ≈ 6-10 s,
extract 2 s, link 0 s, vendor scan 2-5 s, user answers 20-40 s, IDE wiring 2 s. The optional first
debate (60-120 s) is the only thing that can push past two minutes, and it is skippable.

### 3.1 Distribution options, with tradeoffs

| Option | User experience | Build/CI cost | Runtime risk | Size | Verdict |
|---|---|---|---|---|---|
| **(a1) Self-contained archive: official Node + bundled JS + launcher** (recommended) | Identical to a native binary: one download, no Node, no npm, no sudo. Works with every host that expects a `consensus` command. | esbuild bundle (1 file) + per-platform `tar` of official Node (`bin/node` only) in `release.yml`; Node's own `SHASUMS256.txt.asc` is verified at build time. ~1 day. | **None new**: the exact Node we test on (22/24 matrix) runs the exact code; `spawn` of vendor CLIs, MCP stdio, clack raw mode unchanged. Official Node binaries are Apple-signed/notarized and Authenticode-signed, so no Gatekeeper/SmartScreen work. | ~35 MB gz per platform (node ≈ 28-30 MB gz + 3-5 MB app) | **Do this first** |
| (a2) Node SEA (`node --build-sea`, Node ≥ 25.5; `mainFormat: module` supported) | Single file, same UX as a1 | Must build on each target (code cache/snapshot must be off cross-platform), `codesign --remove-signature`/re-sign on mac, `signtool` on Windows; SEA docs say tested on mac arm64 only, Alpine unsupported, `import()` of non-builtins disabled (we use `await import("node:fs/promises")` etc. — builtins only, OK, but `cli.ts:823` resolves `../packs/*.json` via `import.meta.url` → must become embedded assets). | Low-medium: still Node, but SEA is "Stability 1.1 active development" and we lose our tested-binary property. | ~100 MB uncompressed, ~35 MB gz (same as a1) | Later, optional; same download size, more moving parts |
| (a3) `bun build --compile` (what Claude Code ships) | Single file | Cross-compiles from one runner (nice); needs `codesign` with JIT entitlement on mac | **Runtime changes from Node to Bun** for the OpenAI/Anthropic/Google SDKs, MCP stdio transport, `@clack/prompts` raw-mode, `child_process.spawn` of vendor CLIs. Doubles the test matrix. | ~60-90 MB | Not now |
| (a4) pkg / nexe | Legacy; pkg is archived | – | – | – | No |
| (b) Keep npm, private Node under `~/.consensus/node` (OpenClaw `install-cli.sh`) | Still 60-120 s of `npm install` with a registry dependency and proxy config; but no user-Node pollution | Small | None | Node 35 MB + registry traffic | Strictly worse than a1 once we bundle anyway; a1 *is* b minus npm |
| (c) Publish to npm and use `npx consensus-panel` | Needs Node ≥ 22 already present; `npx` on first run is slow and caches per-user; MCP hosts launching `npx -y …` add 1-3 s per start and break offline | Just publish | None | – | Do the **publish** (it fixes gap 15 and gives `npm i -g` users a real channel) but never make `npx` the paste |
| (d) Homebrew tap / winget / scoop | Best for people who already use them; brew handles PATH; winget needs a signed installer or a portable zip manifest | Tap repo + formula pointing at the (a1) tarballs: ~2 h. winget manifest: ~half day + review latency per release | None | – | Add tap once (a1) tarballs exist; winget after a Windows code-signing decision |

Why (a1) over "real" native (a2/a3): the user cannot tell the difference (one download, one command,
no Node), the artifacts are the same size, and we keep the property that *the binary we test is the
binary we ship*. If a single-file executable ever becomes important (e.g. a winget manifest that wants
one `.exe`), a2 is a packaging change inside `release.yml`, not an installer redesign.

### 3.2 Release artifacts (built by `.github/workflows/release.yml` on `v*` tags)

```
consensus-darwin-arm64.tar.gz       consensus-linux-x64.tar.gz      consensus-win-x64.zip
consensus-darwin-x64.tar.gz         consensus-linux-arm64.tar.gz    consensus-win-arm64.zip
SHA256SUMS                          SHA256SUMS.sig (optional, see open questions)
install.sh  install.ps1             (the exact scripts for this version, also served from main)
```

Unversioned asset names so `https://github.com/seanheiney/consensus/releases/latest/download/consensus-darwin-arm64.tar.gz`
resolves without an API call (Bun does this). Version lives inside the archive (`VERSION`) and in
`SHA256SUMS`'s header comment. Pinned installs use `releases/download/v0.2.0/…`.

Archive layout (everything relative, relocatable):

```
consensus/
  VERSION                     0.2.0
  bin/consensus               POSIX sh launcher (see below); consensus.cmd + consensus.ps1 on Windows
  node/bin/node               official Node 22 LTS binary for this platform (only this file; ~100 MB)
  node/LICENSE
  lib/cli.mjs                 esbuild bundle of dist/ + all deps, ESM, target node22, sourcemap external
  lib/build-info.json
  packs/*.json                bundled packs (still read via ../packs/<name>.json relative to lib/)
  LICENSE  README.md  docs/*.md
```

Launcher `bin/consensus`:

```sh
#!/bin/sh
# consensus launcher: runs the bundled CLI with the bundled Node. Relocatable.
here=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
export CONSENSUS_HOME="${CONSENSUS_HOME:-$here}"
exec "$here/node/bin/node" --no-warnings=ExperimentalWarning "$here/lib/cli.mjs" "$@"
```

Alpine/musl: official Node has no musl build. Detect (`ldd --version` mentions musl, or `/etc/alpine-release`)
and (i) try `https://unofficial-builds.nodejs.org` musl asset if we decide to trust it, else (ii) print
"musl detected: `apk add nodejs npm && npm i -g consensus-panel`" and exit 2. Claude Code does the same
(documents extra packages for Alpine).

### 3.3 `install.sh`, step by step, and what the user sees

Design constraints: POSIX `sh` (dash + bash 3.2 clean, as today), no `bash`-isms, curl **or** wget,
`--proto '=https' --tlsv1.2` on curl, `--retry 3 --retry-delay 1` on downloads, never sudo (refuse if
`id -u` = 0 with a non-root `SUDO_USER`, like Claude Code), `set -eu`, every network step
has a timeout, every failure names the fix.

```
$ curl -fsSL https://raw.githubusercontent.com/seanheiney/consensus/main/install.sh | sh

consensus installer
  [1/5] Platform        macOS 15.6, arm64 (Apple Silicon)
  [2/5] Downloading     consensus 0.2.0 for darwin-arm64 (35 MB)
        ######################################################################## 100%
  [3/5] Verifying       sha256 ok  (SHA256SUMS from the GitHub release)
  [4/5] Installing      ~/.consensus  (bundled Node 22.20.0; your own Node, if any, is untouched)
  [5/5] Linking         ~/.local/bin/consensus
        PATH            added `. "$HOME/.consensus/env"` to ~/.zshrc and ~/.zprofile
                        new terminals pick this up; for this one:  source ~/.consensus/env

  consensus 0.2.0 installed in 14s. Nothing was sent anywhere; no telemetry exists.

Starting setup (Ctrl-C any time; re-run with: consensus setup)
┌  consensus setup
│
◇  Looking for AI subscriptions and API keys
│
●  Detected
│  ✓ connected   Anthropic (Claude)   via claude (logged in, max)
│  ✓ connected   OpenAI (Codex)       via codex (Logged in using ChatGPT, codex 0.160.1)
│  ○ missing     Google (Gemini)      gemini not installed, no GEMINI_API_KEY
│  ○ missing     xAI (Grok)           grok not installed, no XAI_API_KEY
│  ○ missing     OpenRouter           no OPENROUTER_API_KEY (optional: one key covers any vendor you haven't connected)
│
◆  Connect Google (Gemini)?
│  ● Yes / ○ No
…
```

Steps in the script (function names are proposals for the rewritten `install.sh`):

1. `parse_args` – flags: `-y/--yes`, `--no-setup`, `--no-first-run`, `--project`, `--probe`, `--version <x.y.z|latest>`, `--no-modify-path`, `--dir <path>`, `--dry-run`, `-h`, `-V`. Env equivalents: `CONSENSUS_YES`, `CONSENSUS_VERSION`, `CONSENSUS_NO_MODIFY_PATH`, `CONSENSUS_INSTALL_DIR`, `CONSENSUS_DOWNLOAD_BASE` (mirror), `CONSENSUS_NO_SETUP`. Positional `stable|latest|x.y.z` accepted too (`sh -s 0.2.0`, like Claude Code).
2. `refuse_sudo` – exit 1 with the Claude Code wording if root with `SUDO_USER`.
3. `detect_platform` – `uname -s`/`uname -m`; `sysctl -n sysctl.proc_translated` = 1 → arm64 (Rosetta, per Bun/Codex); musl check; unsupported → message + exit 2. Prints step 1/5.
4. `pick_downloader` – curl (reject snap-broken curl like uv) else wget else "install curl or wget". Progress bar only when stderr is a TTY (`curl --progress-bar`, `wget --show-progress`); otherwise silent.
5. `download_and_verify` – fetch `SHA256SUMS` first, then the asset, compare with `sha256sum`/`shasum -a 256`/`openssl dgst -sha256`; on mismatch delete and exit 1 ("Checksum verification failed: expected … got …; re-run, and if it repeats open an issue"). Optional: if `gh` is present and `CONSENSUS_VERIFY_ATTESTATION=1`, run `gh attestation verify`.
6. `install_archive` – extract into `~/.consensus/versions/<ver>/` (temp dir + atomic `mv`), then repoint `~/.consensus/current` symlink (Codex/Claude layout, keeps the previous version for instant rollback: `consensus update --rollback`). Write `~/.consensus/receipt.json` `{version, platform, installedAt, launcher, envFile, rcFilesEdited[], installer: "sh 0.2.0"}`.
7. `link_launcher` – `~/.local/bin/consensus -> ~/.consensus/current/bin/consensus` (`$XDG_BIN_HOME` honoured; `--dir` overrides). If `~/.local/bin` is not writable, fall back to `~/.consensus/bin` and add *that* to PATH.
8. `write_env_and_rc` – see 3.4. Skipped with `--no-modify-path` or when the dir is already on PATH (still writes the env file so the hint works).
9. `post_install_check` – run `"$LAUNCHER" --version` via the absolute path (never depends on PATH) and print the "installed in Ns" line with a `BEFORE -> AFTER` when upgrading.
10. `handoff` – see 3.5.

On failure the trap prints: what step failed, the log path (`~/.consensus/install.log`, always written
with `set -x`-free but full command output), and the manual alternative ("download `consensus-darwin-arm64.tar.gz`
from the release page, extract anywhere, run `bin/consensus setup`"). Exit codes: 1 generic, 2
unsupported platform, 3 network, 4 checksum, 130 interrupted.

### 3.4 PATH update logic (exact)

Files:

```
~/.consensus/env          (sh)     case ":${PATH}:" in *":$HOME/.local/bin:"*) ;; *) export PATH="$HOME/.local/bin:$PATH" ;; esac
~/.consensus/env.fish     (fish)   if not contains -- "$HOME/.local/bin" $PATH; set -gx PATH "$HOME/.local/bin" $PATH; end
```

(`$HOME/.local/bin` is replaced by the actual launcher dir; written with `$HOME` unexpanded so dotfiles
stay portable, like uv.)

Rc lines (one line, marker on the same line so removal is `grep -v`):

```
. "$HOME/.consensus/env"            # consensus
source "$HOME/.consensus/env.fish"  # consensus   (in fish conf.d, the whole file is ours)
```

Which files, decided from the *user's* login shell (`$SHELL`, falling back to `getent passwd`/`dscl` and
then to "all of them"), never from the `sh` running the script:

| `$SHELL` | Always | Also, if the file already exists |
|---|---|---|
| zsh | `${ZDOTDIR:-$HOME}/.zshrc` (create if missing), `${ZDOTDIR:-$HOME}/.zprofile` (macOS Terminal/iTerm open login shells; VS Code's integrated terminal reads `.zprofile` too) | `.bashrc`, `.bash_profile`, `.profile` |
| bash | `.bashrc`; login file = first existing of `.bash_profile`, `.bash_login`, else `.profile` (macOS: `.bash_profile`) | `.zshrc`, `.zprofile` |
| fish | `~/.config/fish/conf.d/consensus.fish` (dir auto-sourced; created if missing) | `.bashrc`, `.profile`, `.zshrc` |
| other/unknown | `.profile` + print manual instructions for bash/zsh/fish | – |

Rules (from OpenClaw's `persist_path_line_to_profile`): refuse if the rc target is a symlink resolving
outside `$HOME`, not a regular file, or not owned by the user; append with a leading newline only if the
file does not end in one; never write the same line twice (`grep -Fq '.consensus/env'`); record every file
touched in `receipt.json` so `consensus uninstall --all` can remove exactly those lines.

Messages:
- Already on PATH: "PATH already includes ~/.local/bin; no shell files changed."
- Modified: "PATH: added one line to ~/.zshrc and ~/.zprofile. New terminals pick this up. For this one: `source ~/.consensus/env`". (fish: `source ~/.config/fish/conf.d/consensus.fish`.)
- `--no-modify-path`: "PATH not changed (requested). Add: `export PATH=\"$HOME/.local/bin:$PATH\"`".

GUI hosts (Cursor, Windsurf, Claude Desktop, VS Code, Zed) do not read shell PATH: `mcpLaunchCommand({absolute:true})`
returns `[~/.consensus/current/bin/consensus, "mcp"]` — a stable path that survives version switches and
Node version managers (fixes gap 4). Windows returns `…\bin\consensus.cmd`.

### 3.5 The `/dev/tty` wizard handoff (exact)

```sh
can_prompt() {
  [ -z "$YES" ] && [ -z "${CI:-}" ] && [ -t 1 ] && [ -t 2 ] &&
  [ -r /dev/tty ] && [ -w /dev/tty ] && { : </dev/tty; } 2>/dev/null
}

if [ "$RUN_SETUP" = 0 ]; then
  say "Installed. Next: consensus setup"
elif can_prompt; then
  say "Starting setup (Ctrl-C any time; re-run with: consensus setup)"
  exec </dev/tty                      # stdin was the piped script; give the wizard the terminal
  exec "$LAUNCHER" setup $SETUP_ARGS  # exec: the script is done, the wizard owns the process/exit code
elif [ -n "$YES" ]; then
  "$LAUNCHER" setup --yes $SETUP_ARGS
else
  say "No terminal available, so setup was not started."
  info "Finish in any terminal with:  consensus setup"
  info "Or unattended:                consensus setup --yes"
fi
```

Why `exec` twice: after `exec </dev/tty` the shell's stdin *is* the terminal, so clack's raw-mode
`process.stdin.setRawMode` works, Ctrl-C reaches the wizard, and `spawnSync(bin, args, {stdio:"inherit"})`
in `setup.ts` `interactive()` (used for `claude auth login`, `codex login`) inherits a real TTY too. The
second `exec` replaces `sh` with the wizard so the exit code and signals are the wizard's, and nothing in
the script runs after a cancelled wizard (today "Done. Next step:" prints even after Ctrl-C).

`$LAUNCHER` is the absolute path; PATH is irrelevant during install.

Inside `setup.ts`, when `process.env.CONSENSUS_INSTALLER=1` (set by the script), `runSetup` prints the
"what happened" summary (3.8) instead of the one-line outro and includes the PATH hint the script passed
in `CONSENSUS_PATH_HINT`.

### 3.6 `--yes` non-interactive path that still ends usable

`sh -s -- --yes` (or `CI=1`, or no TTY with `--yes`):

1. Install exactly as above (PATH modified unless `--no-modify-path`; CI images usually want it).
2. `consensus setup --yes --save-env-keys`: detect vendor CLIs + keys from env; **persist any
   `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY`/`XAI_API_KEY`/`OPENROUTER_API_KEY` found in the
   environment into `credentials.json`** (new flag, default on under the installer, off for a bare
   `setup --yes` to avoid surprising dotfile users; gap 17); create starter profiles; wire every detected
   host; no first debate (unchanged: nothing spends quota without being asked).
3. Print the summary with an explicit **status line**: `ready: 2 connections (claude, codex)` or
   `not ready: 1 connection; a panel needs 2. Next: consensus connect openrouter` — and exit **0 when
   ready, 3 when not** so CI can gate on it (today it exits 0 either way).
4. `--yes --first-run` keeps today's meaning (run the debate).
5. `--yes` never reads `/dev/tty`, never opens a browser, never runs vendor `login` commands.

### 3.7 Progress output

- Script: `[N/5] Label   detail` lines, download progress bar when stderr is a TTY, elapsed on the
  success line. Colours only when `-t 2` and `NO_COLOR` unset; ASCII only when `TERM=dumb`/`LANG=C`
  (reuse the rule in `src/progress.ts`).
- Wizard: keep clack; add a spinner label with elapsed on the vendor scan ("Looking for AI subscriptions
  and API keys (3.2s)") since `claude auth status`/`codex login status` each have 15 s timeouts and can
  stall; run the four `cliStatus` probes in parallel (already `Promise.all`) and print each as it lands.
- First debate: already streams `progressLogger` events; prefix with "(this is optional; Ctrl-C keeps
  everything you set up)".

### 3.8 "What happened" summary screen (end of setup)

```
●  You're set up
│
│  Installed    ~/.consensus (consensus 0.2.0, bundled Node 22.20.0)   launcher ~/.local/bin/consensus
│  PATH         ~/.zshrc, ~/.zprofile (+1 line each)   this shell: source ~/.consensus/env
│  Accounts     ✓ Anthropic via claude   ✓ OpenAI via codex   ✓ OpenRouter key   ○ Google   ○ xAI
│  Profiles     balanced (default), fast, frontier          ~/.config/consensus/config.json
│  Keys         ~/.config/consensus/credentials.json (mode 600)
│  IDEs wired   Claude Code (MCP + skill), Cursor (MCP + skill), VS Code (MCP + skill), ~/.agents/skills
│  Telemetry    none. Nothing is sent to any consensus-operated service; there isn't one.
│
│  Try:   consensus "Should we use optimistic locking or a distributed lock for inventory holds?"
│         consensus doctor        consensus --help        consensus uninstall --all
└
```

Every row comes from data `runSetup` already has (statuses, cfg, `lines` from host installs) plus the
receipt (new `readReceipt()` in `src/install-receipt.ts`).

### 3.9 Idempotent re-run and upgrade

- Re-run with same version: script sees `receipt.version == requested` and `current/VERSION` matches →
  skips download ("consensus 0.2.0 already current"), re-checks link + env + rc lines (repairs if missing),
  then: config exists → `consensus doctor` (not setup), config missing → setup. Exit 0.
- Newer version: download, install into `versions/<new>`, flip `current`, print `0.1.0 -> 0.2.0`, run
  `consensus doctor --fix` (new: re-registers MCP entries whose command path changed, refreshes preset
  profiles = today's `consensus install` + `profile refresh`), no wizard. Old version kept for
  `consensus update --rollback`; older ones pruned (keep 2).
- `consensus update` (new command in `src/cli.ts`, logic in `src/selfupdate.ts`): does steps 5-6-9 of
  the script natively (fetch `SHA256SUMS` + asset, verify, install, flip). Also `consensus update --check`
  and a once-per-day, non-blocking "0.3.0 available: `consensus update`" notice on stderr, opt-out
  `CONSENSUS_NO_UPDATE_CHECK=1` (no auto-update in the background; open question).
- `consensus uninstall --all`: today's host cleanup + remove launcher, `~/.consensus`, the rc lines listed
  in the receipt (only lines containing the marker), and with `--purge` the config dir. Prints each thing removed.
- npm-channel users (`npm i -g consensus-panel`) get the same `cli.mjs`; `consensus update` detects
  "installed by npm" (no receipt) and prints the npm command instead.

### 3.10 Windows: `irm https://raw.githubusercontent.com/seanheiney/consensus/main/install.ps1 | iex`

Mirror of 3.3 in PowerShell 5.1+ (Windows PowerShell, not just pwsh):

1. Params `-Yes -NoSetup -NoFirstRun -Version -NoModifyPath -Dir -Help -DryRun`; env equivalents
   (`CONSENSUS_YES=1` …) because `irm | iex` cannot pass parameters; document the scriptblock form
   `& ([scriptblock]::Create((irm …))) -Yes`.
2. Arch from `$env:PROCESSOR_ARCHITECTURE` (`ARM64` → win-arm64; else x64). Windows 10 1809+.
3. `Invoke-WebRequest` (with `-UseBasicParsing` for 5.1) of `SHA256SUMS` then the zip, `[Net.ServicePointManager]::SecurityProtocol = Tls12`; verify with `Get-FileHash -Algorithm SHA256`.
4. Extract to `$env:LOCALAPPDATA\consensus\versions\<ver>\` (`Expand-Archive`), flip `current` (directory junction, no admin needed), write `receipt.json`. Ship `bin\consensus.cmd` (`@"%~dp0..\node\node.exe" "%~dp0..\lib\cli.mjs" %*`) and `bin\consensus.ps1`.
5. PATH: add `$env:LOCALAPPDATA\consensus\current\bin` to the **User** PATH with
   `[Environment]::SetEnvironmentVariable('Path', …, 'User')` (idempotent, checked first) *and* to `$env:Path`
   for this session, so `consensus` works immediately in this window; print "New terminals pick this up."
   Unblock: `Unblock-File` on extracted files (belt and braces; `node.exe` is Authenticode-signed by the Node project).
6. Handoff: PowerShell's console is a real TTY even under `irm | iex`, so `& "$launcher" setup` works
   directly (clack uses `process.stdin.setRawMode`; verified today by our current `install.ps1` flow).
   Non-interactive detection: `-Yes`, `$env:CI`, or `[Console]::IsInputRedirected`.
7. Same summary, same exit codes. Errors are thrown (terminating) so `irm | iex` reports without closing the window, and `-File` invocations exit non-zero (OpenClaw does exactly this).
8. WSL users are told to use the sh installer inside WSL; the Windows-side IDE configs are only reachable from the Windows install.

Later: winget manifest (portable type) once we decide on Authenticode signing of `consensus.cmd`/wrapper (Node's `node.exe` is already signed).

### 3.11 Welcome moment

Immediately after the success line, before the wizard's first question, one short block:

```
  consensus 0.2.0 installed in 14s.
  A panel of frontier models will debate your question until they agree. First we connect the models.
```

Then the wizard. The end-of-wizard first debate stays the "aha" (OpenClaw gates onboarding on a live
completion for the same reason). Under `--no-first-run` the summary's `Try:` line is the welcome.

---

## 4. What changes in this repo

| File | Change |
|---|---|
| `install.sh` | Rewrite (~250 lines): remove `node_ok`/`install_node`/`try_install`/npm branches; add `refuse_sudo`, `detect_platform`, `pick_downloader`, `download_and_verify`, `install_archive`, `link_launcher`, `write_env_and_rc`, `can_prompt`, `handoff`, `on_error` trap, receipt. Keep the bash-3.2 `${@+"$@"}` rule. Keep `CONSENSUS_INSTALL_DIR`; drop `CONSENSUS_MIN_NODE`, `CONSENSUS_SYSTEM_NODE`, `CONSENSUS_REPO`, `CONSENSUS_SHA256` (superseded by `SHA256SUMS`). |
| `install.ps1` | Rewrite to 3.10. Keep the parser-only CI check; add a real run on `windows-latest` that installs from the just-built zip and runs `consensus --version` and `consensus setup --yes --no-first-run`. |
| `scripts/bundle.mjs` (new) | esbuild: `src/cli.ts` → `build/lib/cli.mjs` (`platform: node`, `format: esm`, `target: node22`, `banner` with `createRequire` shim for CJS deps, external none). Also emits `build-info.json`. Add `esbuild` devDependency. |
| `scripts/package.sh` (new) | Given `<os>-<arch>` and Node version: download `node-v22.x-<platform>.tar.gz` (or `.zip` on Windows), verify against `SHASUMS256.txt` + `.asc` (Node release keys pinned in repo), copy `bin/node`, assemble the archive layout in 3.2, `tar czf` / `zip`. |
| `.github/workflows/release.yml` | Matrix over 6 targets producing archives + `SHA256SUMS`; `actions/attest-build-provenance` on them; upload to the GitHub Release; then `npm publish --provenance` (unchanged) with `package.json` `files` now including `build/lib/cli.mjs`; upload `install.sh`/`install.ps1` as release assets too. |
| `.github/workflows/ci.yml` | New job `installer-smoke`: on ubuntu/macos, build the archive for the runner, then `sh install.sh --dir /tmp/x --no-setup` from a *piped* stdin (`cat install.sh \| sh -s -- …`) and assert `consensus --version`, receipt, env file, rc line, idempotent second run; a `--yes` run asserts exit 3 with 0 connections. Also a `dash -n install.sh` + `shellcheck -s sh` step. |
| `package.json` | `bin.consensus` → `./build/lib/cli.mjs` for the npm channel (or keep `dist/cli.js`; either works, one code path is simpler); add `esbuild`; `engines.node >=22` unchanged. |
| `src/cli.ts` | Add `update` command (`--check`, `--rollback`); extend `uninstall` with `--all`; `doctor --fix`; `setup --save-env-keys`; resolve bundled packs via `CONSENSUS_HOME` when set (`cli.ts:823`) instead of `import.meta.url` only; print update notice from `src/selfupdate.ts`. |
| `src/selfupdate.ts` (new) | Fetch `SHA256SUMS` + asset for the current platform, verify, install into `versions/`, flip `current`, prune; `readReceipt`/`writeReceipt`; `installKind(): "archive" \| "npm" \| "source"`. |
| `src/setup.ts` | `runSetup`: honour `CONSENSUS_INSTALLER`/`CONSENSUS_PATH_HINT`; new `summaryNote()` replacing `p.outro` (3.8); `--save-env-keys`; readiness exit code under `--yes`; spinner elapsed. |
| `src/hosts.ts` | `mcpLaunchCommand`: prefer `readReceipt().launcher` (absolute, stable) for `{absolute:true}`; fall back to today's logic for npm/source installs. |
| `src/doctor.ts` | Add `installStatus()` (kind, version, launcher on PATH?, rc lines present?, update available?) rendered by `consensus doctor` as a fourth section "Install". |
| `src/progress.ts` | Export the TTY/ASCII rule for the installer docs (no code change needed; the sh script re-implements it). |
| `docs/install.md` | Rewrite: new layout, verification (`SHA256SUMS`, `gh attestation verify`), `update`, `uninstall --all`, Alpine note, WSL note, proxy note now a single host (`github.com`/`objects.githubusercontent.com`), npm channel section becomes real. |
| `README.md` | Install table: keep the two one-liners, add `brew install seanheiney/tap/consensus` when the tap exists, drop "not published yet". |
| `test/install.test.ts` (new) | Unit tests for `selfupdate.ts` (checksum parsing, receipt, platform mapping) and for `setup.ts` summary/readiness. |

Unchanged: the wizard's questions, `hosts.ts` per-host writers, credentials, protocol.

---

## 5. Migration plan (PR-sized steps)

| PR | Content | Effort | Unblocks |
|---|---|---|---|
| 1 | **Publish to npm**: tag `v0.1.0`, `NPM_TOKEN` secret, verify `npm i -g consensus-panel`; README/docs drop "not published". `install.sh` untouched (it already prefers npm). | 1-2 h + owner secret | Gap 15; `npx` for MCP hosts |
| 2 | **Bundle**: `scripts/bundle.mjs` (esbuild), `build/lib/cli.mjs`, CI asserts `node build/lib/cli.mjs --help` and the full test suite against the bundle (packs resolution via `CONSENSUS_HOME`). | 0.5 day | 3, 4 |
| 3 | **Archives + release pipeline**: `scripts/package.sh`, `release.yml` matrix for 6 targets, `SHA256SUMS`, attestation, assets on the GitHub Release. Manual test on mac arm64 + Linux x64 container. | 1 day | 4, 6 |
| 4 | **New `install.sh`** (3.3-3.7, 3.9 re-run) + `ci.yml` installer-smoke job (piped stdin, dash, bash 3.2 via macOS runner, `shellcheck`). Old npm path removed. | 1-1.5 days | the paste |
| 5 | **Setup polish**: `CONSENSUS_INSTALLER` summary screen, `--save-env-keys`, readiness exit code, spinner elapsed, welcome block. | 0.5 day | 2-minute goal |
| 6 | **`consensus update` / `uninstall --all` / `doctor` Install section / receipt-aware `mcpLaunchCommand`** (`src/selfupdate.ts`). | 1 day | Gap 4, 14 |
| 7 | **New `install.ps1`** + real Windows CI run. | 1 day | Windows |
| 8 | **Docs**: `docs/install.md` rewrite, README table, CHANGELOG. | 0.5 day | – |
| 9 | **Homebrew tap** (`seanheiney/homebrew-tap`, formula downloads the same tarball; `brew` handles PATH) and, if signing is decided, a winget portable manifest. | 0.5 day (+ winget review latency) | (d) |
| 10 | Optional later: Node SEA single-file build in `release.yml`; Alpine musl asset via unofficial-builds. | 1 day each | – |

Total to "one paste works on a bare mac/Linux box": PRs 1-5 ≈ 4 days. Windows +1. The order keeps
`main` shippable after every PR (until PR 4 lands, the old script keeps working because npm is now real).

---

## 6. Open questions for the owner

1. **Release signing.** SHA-256 via `SHA256SUMS` is the floor. Options above that: (a) GitHub artifact attestations (`actions/attest-build-provenance`, free, verifiable with `gh attestation verify`), (b) a GPG-signed `SHA256SUMS.sig` with a project key published at a fixed URL (Claude Code's model; needs key custody), (c) Sigstore `cosign sign-blob` keyless. Recommendation: (a) now, (b) only if enterprise users ask. Which?
2. **npm publish**: OK to publish `consensus-panel@0.1.0` now (PR 1)? Needs an npm automation token in repo secrets. Is the name final (the CLI is `consensus`, the package `consensus-panel`)?
3. **Auto-update**: notice-only (recommended: "0.3.0 available: consensus update", once a day, opt-out) or background auto-update like Claude Code? Background updates need a mutex with running MCP servers.
4. **macOS notarization / Windows Authenticode** for our own files: the bundled `node`/`node.exe` are signed by the Node project; our launcher is a shell script/`.cmd`, so nothing we ship needs signing unless we go SEA (a2) or want a winget `.exe`. Skip for now?
5. **Node version policy in archives**: pin to the latest Node 22 LTS at release time (recommended, matches `engines`) or 24? A bump only requires re-tagging.
6. **Alpine/musl**: ship an asset built from `unofficial-builds.nodejs.org` (not signed by the Node release team) or document `apk add nodejs && npm i -g`? Recommendation: document, revisit on demand.
7. **`--yes` key persistence**: is writing env-var API keys into `credentials.json` under the installer's `--yes` acceptable, or should CI users pass `--save-env-keys` explicitly? (Design says default on only when invoked by the installer.)
8. **Install location**: `~/.consensus` + `~/.local/bin/consensus` (matches Claude/Codex/uv; `~/.local/bin` is already on PATH on most Linux logins) vs everything under `~/.consensus/bin`? Recommendation: the former.
9. **Keep the GitHub-tarball npm fallback** for people who want `main`? Suggest: `consensus update --channel main` is out of scope; `git clone && pnpm dev` remains the dev path.
10. **Homebrew tap** naming: `seanheiney/tap/consensus` vs trying for homebrew-core later (needs notability). Tap now?
