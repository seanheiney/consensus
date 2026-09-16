# Installing consensus

Everything about getting `consensus` onto a machine: every install path, exactly what the installer writes and where, how to audit it, how to upgrade, how to remove it, and the fixes for the problems people actually hit.

- [Requirements](#requirements)
- [Install](#install)
- [What the installer does, step by step](#what-the-installer-does-step-by-step)
- [What gets written, and where](#what-gets-written-and-where)
- [Node version handling](#node-version-handling)
- [npm channel and permission problems](#npm-channel-and-permission-problems)
- [Proxies and firewalls](#proxies-and-firewalls)
- [Offline and air-gapped installs](#offline-and-air-gapped-installs)
- [Verifying the install](#verifying-the-install)
- [Upgrading](#upgrading)
- [Uninstalling](#uninstalling)
- [Troubleshooting](#troubleshooting)

## Requirements

| | |
|---|---|
| Node.js | **None for the one-line installers.** The release archive carries its own official Node 22 runtime, used only by consensus; your own Node (if any) is never used or changed. Only the npm and source paths need Node 22+ on your machine. |
| OS | macOS (arm64, x64; Rosetta shells are detected), Linux with glibc (x64, arm64), Windows 10 1809+ (x64, arm64). Alpine/musl: see [Troubleshooting](#troubleshooting). WSL works as Linux. |
| Tools | `curl` or `wget`, `tar`, and one of `sha256sum` / `shasum` / `openssl`. No `sudo`, no `unzip`, no compiler. |
| Model connections | **At least two seats.** A logged-in vendor CLI, an API key, or one `OPENROUTER_API_KEY` (which can seat every vendor by itself). |
| Disk | About 110 MB under `~/.consensus` (Node runtime + bundled CLI), per installed version; the installer keeps the current and the previous version. |

## Install

### macOS / Linux (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/seanheiney/consensus/main/install.sh | sh
```

That one line downloads about 38 MB, verifies it, puts `consensus` on your `PATH` for new terminals, and starts the setup wizard in the same terminal. A re-run upgrades in place; if you already have a config it runs `consensus doctor` instead of the wizard.

Unattended (no questions — good for a fresh box, a container or CI):

```bash
curl -fsSL https://raw.githubusercontent.com/seanheiney/consensus/main/install.sh | sh -s -- --yes
```

Install the CLI but skip the setup wizard entirely:

```bash
curl -fsSL https://raw.githubusercontent.com/seanheiney/consensus/main/install.sh | sh -s -- --no-setup
```

Read the script before running it (recommended for anything you pipe to a shell):

```bash
curl -fsSL https://raw.githubusercontent.com/seanheiney/consensus/main/install.sh -o install.sh
less install.sh
sh install.sh --help
sh install.sh
```

Installer flags:

| Flag | Effect |
|---|---|
| `-y`, `--yes` | Non-interactive: runs `consensus setup --yes` (exits 3 if fewer than 2 models end up connected). |
| `--no-setup` | Install only. |
| `--no-first-run` | Passed through to setup: skip the guided first debate. |
| `--project` | Passed through to setup: also write project files in the current directory. |
| `--probe` | Passed through to setup: make one tiny live call per connection. |
| `--version <ver>`, or a bare `0.2.0` / `latest` | Install that release (default: latest). `sh -s -- 0.2.0` works. |
| `--dir <path>` | Put the `consensus` link in `<path>/bin` instead of `~/.local/bin`. |
| `--no-modify-path` | Do not touch any shell rc file (the env file is still written). |
| `--allow-root` | Allow running as root (refused by default, and always under `sudo`). |
| `--dry-run` | Print the platform, URLs and paths it would use, then exit. |
| `-h`, `--help` / `-V` | Usage / installer version. |

Environment:

| Variable | Effect |
|---|---|
| `CONSENSUS_VERSION` | Release tag to install, e.g. `v0.2.0` (default: latest). |
| `CONSENSUS_INSTALL_DIR` | Same as `--dir`: the link lands in `$CONSENSUS_INSTALL_DIR/bin/consensus`. |
| `CONSENSUS_ROOT` | Where versions live (default `~/.consensus`). |
| `CONSENSUS_DOWNLOAD_BASE` | A mirror or local directory served over HTTP(S) holding `SHA256SUMS` and `consensus-<os>-<arch>.tar.gz`. |
| `CONSENSUS_YES=1`, `CONSENSUS_NO_SETUP=1`, `CONSENSUS_NO_MODIFY_PATH=1` | Same as the flags. |
| `CONSENSUS_NODE_DIST`, `CONSENSUS_REPO`, `CONSENSUS_SHA256` | Only for the [fallback](#what-the-installer-does-step-by-step): Node mirror, source tarball, and its expected sha256. |
| `NO_COLOR` | Plain output. |

Exit codes: `0` ok, `1` error, `2` unsupported platform, `3` network, `4` checksum mismatch, `130` interrupted.

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/seanheiney/consensus/main/install.ps1 | iex
```

`irm | iex` cannot pass parameters. Use the scriptblock form, or environment variables:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/seanheiney/consensus/main/install.ps1))) -Yes
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/seanheiney/consensus/main/install.ps1))) -Version 0.2.0 -NoSetup
$env:CONSENSUS_YES = 1; irm https://raw.githubusercontent.com/seanheiney/consensus/main/install.ps1 | iex
```

Parameters: `-Yes`, `-NoSetup`, `-NoFirstRun`, `-Version <ver>`, `-Dir <root>`, `-NoModifyPath`, `-DryRun`, `-Help`, `-InstallerVersion`. It installs to `%LOCALAPPDATA%\consensus`, adds `%LOCALAPPDATA%\consensus\current\bin` to your **user** `PATH` (no admin) and to the current window, and runs `consensus setup`. WSL users: run the sh installer inside WSL; note that a WSL install cannot see Windows-side IDE configs.

If PowerShell refuses to run a downloaded copy, either unblock it (`Unblock-File .\install.ps1`) or run it for this session only: `powershell -ExecutionPolicy Bypass -File .\install.ps1`.

### npm (you already have Node 22+)

```bash
npm install -g consensus-panel      # once published; until then:
npm install -g https://github.com/seanheiney/consensus/archive/refs/heads/main.tar.gz
consensus setup
```

The npm channel ships the same code. `consensus update` on an npm install prints the npm command instead of re-running the installer.

### From source

```bash
git clone https://github.com/seanheiney/consensus
cd consensus
pnpm install
pnpm build
npm link            # puts `consensus` on PATH pointing at this checkout
consensus setup
```

Without `npm link`, run it as `node dist/cli.js …` or `pnpm dev "…"` (tsx, no build needed). To build the standalone archive yourself: `node scripts/bundle.mjs && node scripts/package.mjs <darwin|linux|win> <x64|arm64>`.

### Pinning a version

```bash
curl -fsSL https://raw.githubusercontent.com/seanheiney/consensus/main/install.sh | sh -s -- 0.2.0
CONSENSUS_VERSION=v0.2.0 sh install.sh
```

Pinned installs download from `https://github.com/seanheiney/consensus/releases/download/v0.2.0/`; the default uses `releases/latest/download/`, so no GitHub API call (and no rate limit) is involved.

## What the installer does, step by step

`install.sh` prints each step as `[N/5]` and stops at the first failure with a message that names the fix:

1. **Platform.** `uname -s` / `uname -m`; on macOS `sysctl.proc_translated` detects a Rosetta shell and picks the arm64 build. musl libc and unsupported OS/CPU combinations get a clear message (exit 2). Refuses to run as root (and always under `sudo`), because a root-owned `~/.consensus` is the most common self-inflicted install bug.
2. **Download.** Fetches `SHA256SUMS`, then `consensus-<os>-<arch>.tar.gz`, with `curl` (`--proto =https --tlsv1.2`, 3 retries) or `wget`; a progress bar is shown only on a terminal. If the release's sha256 matches the receipt of what is already installed, nothing is downloaded.
3. **Verify.** Compares the archive's SHA-256 with `SHA256SUMS`; on mismatch it deletes the download and exits 4.
4. **Install.** Unpacks into a temp directory under `~/.consensus`, moves it to `~/.consensus/versions/<version>`, and points the `~/.consensus/current` symlink at it. The previous version is kept; older ones are pruned.
5. **Link and PATH.** Symlinks `~/.local/bin/consensus` (or `$XDG_BIN_HOME`, or `--dir`) to `~/.consensus/current/bin/consensus`, writes `~/.consensus/env` and `env.fish`, and adds **one** line to your shell rc files (details below). Then runs the installed launcher by absolute path to prove it works, writes `~/.consensus/receipt.json`, and prints the version and elapsed time.

Then the hand-off:

- **Config already exists** (`~/.config/consensus/config.json`): this is an upgrade. It runs `consensus doctor` and says "Upgrade complete"; it never re-runs the wizard.
- **Fresh install with a usable terminal** (stdout and stderr are terminals, `/dev/tty` really opens, no `--yes`, no `CI`): `exec consensus setup </dev/tty`, so the wizard owns the terminal, Ctrl-C and the exit code.
- **`--yes`**: `consensus setup --yes`.
- **No terminal** (docker without `-t`, CI, `ssh host 'curl … | sh'`): prints exactly how to finish (`consensus setup` or `consensus setup --yes`) and exits 0.

**Fallback while no release exists.** If the release download returns 404 (no GitHub Release has been cut yet), the release has no build for your platform, or you are on musl libc, the installer does not give up and does not touch your system Node or npm: it downloads the official Node 22 `tar.gz` from nodejs.org (verified against its `SHASUMS256.txt`) into the new version directory, runs that Node's own npm with `install -g --prefix <version dir>/npm` of `consensus-panel` (or, while that is unpublished, the repo tarball), writes the same launcher, and continues with step 5. The receipt records `"channel": "npm-fallback"`. On musl it uses your own Node 22+ instead, since official Node builds need glibc.

## What gets written, and where

### By the installer

| Path | What |
|---|---|
| `~/.consensus/versions/<version>/` | One directory per version: `bin/consensus` (launcher), `node/` (the private Node runtime), `app/cli.mjs` (the bundled CLI), `packs/`, `suites/`, docs. |
| `~/.consensus/current` | Symlink to the active version. |
| `~/.local/bin/consensus` | Symlink to `~/.consensus/current/bin/consensus`. This is the path MCP hosts are given, so it survives upgrades. |
| `~/.consensus/env`, `~/.consensus/env.fish` | Add the link directory to `PATH` only if it is missing; safe to source twice. |
| One line in rc files | `. "$HOME/.consensus/env"  # consensus` |
| `~/.config/fish/conf.d/consensus.fish` | `source "$HOME/.consensus/env.fish"  # consensus` (when fish is your shell or already configured). |
| `~/.consensus/receipt.json` | Version, platform, sha256, source URL, launcher, and every rc file that holds the line. `consensus update` and `consensus uninstall --all` read it. |
| `~/.consensus/install.log` | Output of the last install's unpack / npm steps. |

Which rc files get the line, based on your login shell (`$SHELL`, else your passwd entry), never on the `sh` running the script:

| Login shell | Always (created if missing) | Also, if the file already exists |
|---|---|---|
| zsh | `${ZDOTDIR:-~}/.zshrc`, `${ZDOTDIR:-~}/.zprofile` | `.bashrc`, `.bash_profile`, `.profile` |
| bash | `.bashrc`, plus the first existing of `.bash_profile` / `.bash_login` / `.profile` (if none: `.bash_profile` on macOS, `.profile` on Linux) | `.zshrc`, `.zprofile` |
| fish | `~/.config/fish/conf.d/consensus.fish` | `.bashrc`, `.profile`, `.zshrc` |
| anything else | `.profile` | `.bashrc`, `.zshrc` |

A line is never added twice, a file that does not end in a newline gets one first, and rc files that are symlinks pointing outside `$HOME`, not regular files, or not writable are left alone (and listed). `--no-modify-path` skips all of it.

On Windows: `%LOCALAPPDATA%\consensus\versions\<version>\`, a `current` junction, `receipt.json`, and one entry in your user `PATH`.

### By `consensus setup` (user level)

| Path | What | Written when |
|---|---|---|
| `~/.config/consensus/config.json` | Profiles, personas, installed packs, default profile. Respects `XDG_CONFIG_HOME`. | Always |
| `~/.config/consensus/credentials.json` | API keys you paste into the wizard. Created with mode `600`. | Only if you paste a key |
| `~/.claude/skills/consensus/SKILL.md` | Claude Code skill | Claude Code detected |
| `~/.claude.json` | MCP entry, via `claude mcp add -s user consensus` | Claude Code detected |
| `~/.codex/skills/consensus/SKILL.md` | Codex skill | Codex detected |
| `~/.codex/config.toml` | MCP entry, via `codex mcp add consensus` | Codex detected |
| `~/.gemini/settings.json` | MCP entry, via `gemini mcp add -s user consensus` | Gemini CLI detected |
| `~/.grok/skills/consensus/SKILL.md`, `~/.grok/AGENTS.md` | Grok skill and a marked rules block | Grok detected |
| `~/.grok/config.toml` or `~/.grok/mcp.json` | MCP entry, via `grok mcp add consensus` | Grok detected |
| `~/.cursor/mcp.json`, `~/.cursor/skills/consensus/SKILL.md` | Cursor MCP entry and skill | `~/.cursor` exists |
| `~/.codeium/windsurf/mcp_config.json`, `~/.codeium/windsurf/memories/global_rules.md` | Windsurf MCP entry and a marked rules block | Windsurf detected |
| `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)<br>`%APPDATA%\Claude\claude_desktop_config.json` (Windows)<br>`$XDG_CONFIG_HOME/Claude/claude_desktop_config.json` (Linux) | Claude Desktop MCP entry | Claude Desktop config exists |
| `~/.agents/skills/consensus/SKILL.md` | The cross-tool skill directory other agents read (Copilot, Gemini CLI, …) | Always |

JSON configs are **merged, not replaced**. Before touching an existing file, the installer writes a `.bak` next to it, and if the file is not plain JSON (comments, trailing commas) it refuses to write at all and prints the entry for you to paste by hand — so a merge can never silently drop your other MCP servers.

Marked blocks in Markdown files are delimited by `<!-- consensus:start -->` / `<!-- consensus:end -->`, so they can be updated or removed without disturbing the rest of the file.

### By `consensus setup --project` / `consensus install --project` (repo level)

Run in a repo, these write files that travel with it:

```
.claude/skills/consensus/SKILL.md
.agents/skills/consensus/SKILL.md
.cursor/rules/consensus.mdc
AGENTS.md            # marked block appended or updated
CLAUDE.md            # marked block appended or updated
.mcp.json            # mcpServers.consensus merged in
.cursor/mcp.json     # mcpServers.consensus merged in
.gitignore           # `.consensus/` added if it isn't there
```

### By running the panel

| Path | What |
|---|---|
| `.consensus/runs/<run-id>/debate.md` | The live debate log, appended as the panel argues. `tail -f` it. |
| `.consensus/runs/<run-id>/report.md` | The final report with the full transcript. |
| `.consensus/runs/<run-id>/run.json` | Machine-readable record: seats, per-seat model/effort/persona, every critique and revision, usage. |
| `.consensus/runs/<run-id>/debate.html` | Written only by `consensus log --html`. |
| `.consensus/bench/<timestamp>/` | Benchmark output. |

Saved runs contain your verbatim prompts and any context you pasted. Anything that writes into `.consensus/` also adds `.consensus/` to `.gitignore` when the directory is a git repo. Set a different location with `"runsDir"` in `consensus.config.json`.


## Node version handling

The one-line installers ignore whatever Node you have. consensus runs on the official Node 22 LTS binary inside `~/.consensus/versions/<version>/node`, so:

- `nvm use 20`, `fnm`, Homebrew upgrades or removing Node entirely never break `consensus`, and never break the MCP servers your IDEs launch (they are given `~/.local/bin/consensus`, not a versioned `node` path).
- The installer never installs, upgrades or selects a Node for your shell, never calls Homebrew, fnm, nvm, apt or `sudo`.

Only the npm and source channels use your Node, and they need 22+.

## npm channel and permission problems

The installers never run `npm install -g` into a system prefix and never change your npm config. This section is only for people installing with npm themselves.

A global install that hits `EACCES` means npm's prefix is root-owned (common with a `/usr/local` Node or a system package). **Do not use `sudo npm install -g`** — it leaves root-owned files in your cache and home directory. Use a user prefix instead:

```bash
npm install -g --prefix "$HOME/.local" https://github.com/seanheiney/consensus/archive/refs/heads/main.tar.gz
export PATH="$HOME/.local/bin:$PATH"     # add this to ~/.zshrc or ~/.bashrc
```

With nvm/fnm a global npm install belongs to one Node version: switching versions hides `consensus`. Prefer the one-line installer if that bites.

## Proxies and firewalls

The one-line installer needs HTTPS to:

- `raw.githubusercontent.com` — the installer script itself
- `github.com` and `objects.githubusercontent.com` / `release-assets.githubusercontent.com` — the release archive and `SHA256SUMS`
- only for the [fallback](#what-the-installer-does-step-by-step): `nodejs.org`, `registry.npmjs.org`, `codeload.github.com`

`curl` and `wget` honour `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`, so one setting covers the normal path:

```bash
export HTTPS_PROXY=http://proxy.example:3128
curl -fsSL https://raw.githubusercontent.com/seanheiney/consensus/main/install.sh | sh
```

The fallback's npm step also needs `npm config set proxy` / `https-proxy` if your proxy requires it. To avoid GitHub entirely, mirror the release assets internally and set `CONSENSUS_DOWNLOAD_BASE`.

**At run time**, consensus itself talks to whatever vendor you connected: the API endpoints for key-based seats (`api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com`, `api.x.ai`, `openrouter.ai`), or nothing at all for subscription seats — those are the vendor CLI's own connections, made by the CLI in its own process. Nothing is ever sent to any consensus-operated service; there isn't one.

## Offline and air-gapped installs

The release archive is self-contained (runtime + every dependency), so an offline install is a copy:

1. On a connected machine, download `consensus-<os>-<arch>.tar.gz` and `SHA256SUMS` from the [release page](https://github.com/seanheiney/consensus/releases), plus `install.sh`.
2. On the target, serve that directory over HTTP (`python3 -m http.server 8000`) and run
   ```bash
   CONSENSUS_DOWNLOAD_BASE=http://localhost:8000 sh install.sh --yes --no-first-run
   ```
   Or skip the installer: `tar -xzf consensus-linux-x64.tar.gz` anywhere and run `consensus/bin/consensus setup --yes --no-first-run`.
3. The first debate is the only part of setup that talks to a model.

An air-gapped panel needs models it can reach. The `compat:` provider takes any OpenAI-compatible endpoint (`compat:my-model@https://llm.internal/v1`, key from `COMPAT_API_KEY`), and `ollama:<model>` targets a local Ollama at `http://localhost:11434/v1`. Two local models under different personas make a valid panel.

## Verifying the install

```bash
consensus --version          # 0.2.0 (commit, build date)
consensus doctor             # accounts, profiles, which IDEs are wired up, and the install itself
consensus doctor --probe     # plus one tiny real call through each connection
consensus models             # the model catalog and how each vendor is reachable
consensus profiles           # your profiles (* = default)
```

`consensus doctor` is the single command to paste into a bug report. It prints **Accounts** (per vendor: connected / unverified / missing, and how), **Profiles**, **Hosts** (detected, and whether the MCP entry and skill file are actually present, plus the exact MCP launch command), and **Install** (standalone / npm / source, version, bundled Node, launcher).

Verifying a release yourself:

```bash
curl -fsSLO https://github.com/seanheiney/consensus/releases/latest/download/consensus-linux-x64.tar.gz
curl -fsSLO https://github.com/seanheiney/consensus/releases/latest/download/SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS            # macOS: shasum -a 256 -c --ignore-missing SHA256SUMS
gh attestation verify consensus-linux-x64.tar.gz --repo seanheiney/consensus   # build provenance from the release workflow
```

The archives are built by `.github/workflows/release.yml` from the tagged commit; the Node binary inside each one is the official nodejs.org build, checked against nodejs.org's `SHASUMS256.txt` at build time.

## Upgrading

```bash
consensus update             # standalone install: re-runs the installer for the latest release
consensus update 0.3.0       # or a specific one
```

`consensus update` downloads the current `install.sh` and runs it against your existing install (same root, same link directory, `--no-setup`). Re-running the one-liner does exactly the same thing. If the release is the one you already have, nothing is downloaded. The previous version stays in `~/.consensus/versions/` until the next upgrade.

On an npm install, `consensus update` prints `npm install -g consensus-panel@latest`; on a source checkout, `git pull && pnpm install && pnpm build`.

After upgrading:

```bash
consensus profile refresh    # re-materialize preset profiles against your current connections
consensus install            # re-register MCP + skills if host formats changed (or if you moved from npm to the standalone install)
```

`profile refresh` matters after you upgrade a *vendor* CLI too: it re-picks models your CLIs can actually drive, and removes preset profiles nothing can seat any more.

Your config, profiles, packs, personas, and saved runs are untouched by an upgrade.

## Uninstalling

```bash
consensus uninstall --all     # hosts + the standalone install (~/.consensus, the link, the PATH lines)
consensus uninstall           # only the MCP registrations and skill files
```

`uninstall` reverses each host change it made — `claude mcp remove`, `codex mcp remove`, `gemini mcp remove`, `grok mcp remove`, the `mcpServers.consensus` entry in each JSON config, the `~/.*/skills/consensus/` directories, and the marked blocks in `AGENTS.md` / Windsurf rules — and prints what it removed.

`--all` also removes the `~/.local/bin/consensus` link, `~/.consensus/versions`, `current`, `env`, `env.fish`, `receipt.json` and `install.log`, the fish `conf.d` drop-in, and **only** the `# consensus` lines from your rc files (everything else in them is kept byte for byte). Anything else in `~/.consensus` (for example `runs/` saved by running consensus in your home directory) is kept, and the directory is removed only if it ends up empty. On Windows it also removes the user `PATH` entry. npm installs: `npm uninstall -g consensus-panel`.

It **keeps** your config and saved API keys by default. To delete those too:

```bash
consensus uninstall --all --purge   # also deletes ~/.config/consensus entirely
```

Project-level files (`.mcp.json`, `.cursor/`, `.claude/`, `.agents/`, the blocks in `AGENTS.md` and `CLAUDE.md`) are part of your repo, so they are left for you to remove with git. Saved debates under `.consensus/` are also left in place.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `command not found: consensus` right after installing | This terminal was opened before the installer added the PATH line. | Open a new terminal, or `source ~/.consensus/env` (fish: `source ~/.consensus/env.fish`). It always works by absolute path: `~/.local/bin/consensus`. If a new terminal still cannot find it, `grep -n '# consensus' ~/.zshrc ~/.zprofile ~/.bashrc ~/.profile` shows which files got the line; your shell may read another one (add `. "$HOME/.consensus/env"` there). `--no-modify-path` installs never edit rc files. |
| `error: refusing to install as root` / `do not run this installer with sudo` | The installer writes into your home directory and needs no admin rights; a root-owned `~/.consensus` breaks later upgrades. | Run it as your normal user. In a root-only container, pass `--allow-root`. If an earlier `sudo` run left root-owned files: `sudo chown -R "$(id -un)" ~/.consensus ~/.local/bin`. |
| `musl libc (e.g. Alpine) detected` | Official Node builds need glibc. | `apk add nodejs npm` (Node 22+), then re-run the installer: it installs consensus on that Node, with the same launcher, PATH line and `consensus update`. |
| `checksum verification failed …` (exit 4) | The download does not match the release's `SHA256SUMS` (proxy rewriting, truncated download, or tampering). The file is deleted. | Re-run. If it repeats, do not work around it: open an issue with the full message. |
| `could not download …` (exit 3) | No network, a proxy, or a firewall blocking GitHub. | Check `HTTPS_PROXY`, see [Proxies and firewalls](#proxies-and-firewalls), or use `CONSENSUS_DOWNLOAD_BASE` with an internal mirror. |
| `warning: no consensus release is published yet; falling back to a private Node + npm install` | No GitHub Release with archives exists for the requested version yet. | Nothing to do: the fallback installs the same CLI with a private Node under `~/.consensus` and never touches your Node or npm. It needs `nodejs.org`, `registry.npmjs.org` and `codeload.github.com`. |
| `No interactive terminal, so setup was not started` | The installer ran without a usable terminal (docker without `-t`, CI, `ssh host 'curl … \| sh'`). | Run `consensus setup` in a terminal, or `consensus setup --yes` unattended. |
| `npm ERR! 404 Not Found - GET https://registry.npmjs.org/consensus-panel` | npm channel only: the package is not published yet. | Use the one-line installer, or `npm install -g https://github.com/seanheiney/consensus/archive/refs/heads/main.tar.gz`. Do **not** use `npm i -g github:seanheiney/consensus` — that shorthand is broken here. |
| `Need at least 2 connected models, found 1` (or `found 0`) | A panel needs two seats and only one vendor is reachable. | `consensus doctor` shows what is missing. Fastest fix: one `OPENROUTER_API_KEY` seats every vendor (`consensus connect openrouter`). Otherwise `consensus connect <vendor>`, or use a single-vendor panel: `consensus profile create claude-family --preset claude-family`, or personas on one model (`--preset perspectives`). |
| `pre-flight found seats that cannot run: …` | A seat's route was checked before spending anything and cannot work: the CLI is missing, not logged in, or too old for that model. | Each line names the fix. Do that, or change the panel (`--panel`, `--profile`), or re-seat the profile with `consensus profile refresh`. `--force` runs anyway and drops those seats; the run then exits with code 2. |
| `gemini produced no answer … IneligibleTierError` / "Google login file found but that tier no longer serves the CLI" | Google retired the free individual login for Gemini CLI. A login file on disk is no longer a working connection. | Set an API key: `consensus connect google` (or export `GEMINI_API_KEY`). Alternatively route Gemini through OpenRouter (`openrouter:google/gemini-3.1-pro-preview`). |
| `needs Codex >= 0.154.0, you have 0.1xx` | `gpt-6-astra` can only be driven by a recent Codex CLI. | `npm install -g @openai/codex@latest`, then `consensus profile refresh`. Or seat a model your Codex can drive: `codex:gpt-5.6-sol`. Preset profiles substitute the next tier down automatically. |
| `[--] missing` beside a vendor in `consensus doctor` | That is the "not connected" marker (ASCII mode renders `○` as `[--]`, `✓` as `[ok]`, `?` as `[?]`). The line's right-hand side says why: no key, CLI not installed, or not logged in. | Follow the reason on that line, then re-run `consensus doctor`. A `[?] unverified` means a CLI reports installed but login could not be confirmed — `consensus doctor --probe` settles it with one real call. |
| A run hangs with no output | Frontier seats at `max` effort genuinely take minutes per call; a stuck vendor CLI is capped at 20 minutes per call before it is killed. | `tail -f .consensus/runs/<id>/debate.md` — the path is printed when the run starts — to see which seat is outstanding. Use `-v` for live verdicts. `Ctrl-C` aborts cleanly and still writes the log. If one vendor is consistently stuck, `consensus doctor --probe` will show it; drop that seat with `--panel`. |
| The `consensus` MCP tool does not appear in Claude Code (or Cursor / Codex) | The MCP entry was not written, or the host cannot resolve the `consensus` command (GUI apps do not inherit your shell `PATH`). | `consensus doctor` shows "MCP registered / not registered" per host. Re-run `consensus install`. Then restart the host — none of them re-read MCP config live. With the one-line install every host is given the absolute launcher `~/.local/bin/consensus` (Windows: `%LOCALAPPDATA%\consensus\current\bin\consensus.cmd`), which survives upgrades; npm/source installs give GUI hosts (Cursor, Windsurf, Claude Desktop) an absolute node + script path. If you hand-edited the config, restore it with `consensus install --mcp-only`. Verify Claude Code separately with `claude mcp list`. |

Still stuck? Open an issue with the output of `consensus doctor` and `consensus --version`, plus your OS: <https://github.com/seanheiney/consensus/issues>.
