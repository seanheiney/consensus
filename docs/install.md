# Installing consensus

Everything about getting `consensus` onto a machine: every install path, exactly what the installer writes and where, how to audit it, how to upgrade, how to remove it, and the fixes for the problems people actually hit.

- [Requirements](#requirements)
- [Install](#install)
- [What the installer does, step by step](#what-the-installer-does-step-by-step)
- [What gets written, and where](#what-gets-written-and-where)
- [Node version handling](#node-version-handling)
- [npm permission problems](#npm-permission-problems)
- [Proxies and firewalls](#proxies-and-firewalls)
- [Offline and air-gapped installs](#offline-and-air-gapped-installs)
- [Verifying the install](#verifying-the-install)
- [Upgrading](#upgrading)
- [Uninstalling](#uninstalling)
- [Troubleshooting](#troubleshooting)

## Requirements

| | |
|---|---|
| Node.js | **22 or newer** (`engines.node: ">=22"`). The installer will install it if it is missing. |
| Package manager | npm (ships with Node). pnpm only if you build from source. |
| OS | macOS, Linux, Windows. The shell installer is POSIX `sh` and works under macOS's bash 3.2. |
| Model connections | **At least two seats.** A logged-in vendor CLI, an API key, or one `OPENROUTER_API_KEY` (which can seat every vendor by itself). |
| Disk | About 60 MB for the CLI and its dependencies. |

The package is not on npm yet, so every path below installs from the repo tarball
`https://github.com/seanheiney/consensus/archive/refs/heads/main.tar.gz`. `dist/` is committed, so a tarball install needs no build step.

> The npm `github:seanheiney/consensus` shorthand does **not** work — npm routes it through its git-dependency path, which fails here. Use the full tarball URL.

## Install

### macOS / Linux (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/seanheiney/consensus/main/install.sh | sh
```

Unattended (no questions, no prompts — good for a fresh box or a container):

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

Installer flags and environment:

| Flag | Effect |
|---|---|
| `-y`, `--yes` | Non-interactive; passes `--yes` to `consensus setup`. |
| `--no-setup` | Install the CLI only. |
| `--no-first-run` | Passed through to setup: skip the guided first debate. |
| `--project` | Passed through to setup: also write project files in the current directory. |
| `--probe` | Passed through to setup: make one tiny live call per connection. |
| `-h`, `--help` / `-V`, `--version` | Usage / installer version. |

| Variable | Effect |
|---|---|
| `CONSENSUS_INSTALL_DIR` | Install prefix. The binary lands in `$CONSENSUS_INSTALL_DIR/bin/consensus`; add that to `PATH` yourself. |
| `CONSENSUS_REPO` | Install this spec instead of the npm package (any npm-installable URL, tarball, or path). |
| `CONSENSUS_MIN_NODE` | Minimum Node major version (default `22`). |
| `CONSENSUS_SYSTEM_NODE=1` | Allow a `sudo`/apt NodeSource install on Linux. Off by default; the installer prefers a user-local fnm install so it never needs root. |

Re-running the installer is safe: npm upgrades the package in place, and `consensus setup` is idempotent (it re-registers the same MCP entry and rewrites the same skill files).

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/seanheiney/consensus/main/install.ps1 | iex
```

A piped script cannot take parameters, so for flags download it first:

```powershell
irm https://raw.githubusercontent.com/seanheiney/consensus/main/install.ps1 -OutFile install.ps1
.\install.ps1 -Help
.\install.ps1 -Yes
```

If PowerShell refuses to run the downloaded file, either unblock it (`Unblock-File .\install.ps1`) or run it for this session only: `powershell -ExecutionPolicy Bypass -File .\install.ps1`.

### By hand (you already have Node 22+)

```bash
npm install -g https://github.com/seanheiney/consensus/archive/refs/heads/main.tar.gz
consensus setup
```

Into your own prefix, with no global write:

```bash
npm install -g --prefix "$HOME/.local" https://github.com/seanheiney/consensus/archive/refs/heads/main.tar.gz
export PATH="$HOME/.local/bin:$PATH"     # add this to ~/.zshrc or ~/.bashrc
consensus setup
```

### From source

```bash
git clone https://github.com/seanheiney/consensus
cd consensus
pnpm install
pnpm build
npm link            # puts `consensus` on PATH pointing at this checkout
consensus setup
```

Without `npm link`, run it as `node dist/cli.js …` or `pnpm dev "…"` (tsx, no build needed).

### npm (once published)

```bash
npm install -g consensus-panel      # not available yet
```

The installer already tries this first and falls back to the tarball on `E404`, so the one-liner will start using the npm release the moment it exists, with no change on your side.

### Pinning a version

Until the npm release, pin to a commit or tag instead of `main`:

```bash
npm install -g https://github.com/seanheiney/consensus/archive/<sha-or-tag>.tar.gz
# or, with the installer:
CONSENSUS_REPO=https://github.com/seanheiney/consensus/archive/<sha-or-tag>.tar.gz \
  sh install.sh --yes
```

## What the installer does, step by step

`install.sh` does five things, in this order, and stops at the first failure:

1. **Prints a banner** with the installer version and a docs link, and reports an existing `consensus` install if it finds one.
2. **Checks Node.** `node -p 'process.versions.node.split(".")[0]'` must be ≥ 22. If not, it installs Node — see [Node version handling](#node-version-handling). It never installs Node when a good one is already on `PATH`.
3. **Installs the package**: `npm install -g consensus-panel`, capturing output to a temp log. On `E404` it retries with the repo tarball; on `EACCES` it switches to a user-local prefix (see [npm permission problems](#npm-permission-problems)); on anything else it prints npm's output and exits.
4. **Confirms the binary is on `PATH`** and prints the version (or the upgrade, `0.1.0 -> 0.1.1`).
5. **Runs `consensus setup`**, handing it the real terminal (`/dev/tty`) because stdin is the piped script itself. Under `--yes`, or when there is no terminal at all, it runs `consensus setup --yes`.

Nothing runs as root unless you explicitly opt into `CONSENSUS_SYSTEM_NODE=1` on Linux. The installer itself writes nothing outside npm's prefix; everything else is written by `consensus setup`, and `consensus uninstall` reverses it.

## What gets written, and where

### By npm

| Path | What |
|---|---|
| `$(npm prefix -g)/lib/node_modules/consensus-panel/` | The package (`dist/`, `packs/`, docs, `install.sh`). |
| `$(npm prefix -g)/bin/consensus` | The CLI shim. |

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

`consensus` requires Node 22+. The installer checks the running `node` and, only if it is missing or too old, installs one — preferring methods that need no root, in this order:

1. **Homebrew** on macOS, if `brew` is on `PATH` (`brew install node`).
2. **fnm**, if already installed (`fnm install --lts`).
3. **nvm**, if `~/.nvm/nvm.sh` exists (`nvm install --lts`).
4. **NodeSource via apt** on Linux — only when you set `CONSENSUS_SYSTEM_NODE=1`, because that path pipes a script into `sudo bash`.
5. **The fnm installer** (`--skip-shell`, user-local, no sudo) as the default fallback.

After a fresh fnm or nvm install the new Node may only be on `PATH` inside the installer's own shell. If the installer ends with "Node 22+ still not on PATH", open a new terminal and re-run it.

If you manage Node yourself, install it your way first; the installer will leave it alone.

## npm permission problems

A global install that hits `EACCES` means npm's prefix is root-owned (common with a `/usr/local` Node or a system package). **Do not use `sudo npm install -g`** — it leaves root-owned files in your cache and home directory.

The installer handles this automatically: it sets `npm config set prefix ~/.npm-global`, retries there, and appends the `PATH` line to `~/.zshrc` and `~/.bashrc` if it is not already present. To do it yourself:

```bash
mkdir -p "$HOME/.npm-global"
npm config set prefix "$HOME/.npm-global"
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc   # or ~/.bashrc
exec "$SHELL" -l
npm install -g https://github.com/seanheiney/consensus/archive/refs/heads/main.tar.gz
```

Or keep npm's prefix alone and use a one-off prefix: `npm install -g --prefix "$HOME/.local" …`, or set `CONSENSUS_INSTALL_DIR="$HOME/.local"` before running the installer.

## Proxies and firewalls

The installer and npm need HTTPS to:

- `raw.githubusercontent.com` — the installer script itself
- `registry.npmjs.org` — the package and its dependencies
- `codeload.github.com` / `github.com` — the fallback tarball
- `fnm.vercel.app` or `deb.nodesource.com` — only if Node has to be installed

Behind a proxy:

```bash
export HTTPS_PROXY=http://proxy.example:3128
export HTTP_PROXY=http://proxy.example:3128
export NO_PROXY=localhost,127.0.0.1
npm config set proxy "$HTTPS_PROXY"
npm config set https-proxy "$HTTPS_PROXY"
curl -fsSL https://raw.githubusercontent.com/seanheiney/consensus/main/install.sh | sh
```

With a private registry or an npm mirror, point `CONSENSUS_REPO` at a tarball your network can reach, or vendor the package (below).

**At run time**, consensus itself talks to whatever vendor you connected: the API endpoints for key-based seats (`api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com`, `api.x.ai`, `openrouter.ai`), or nothing at all for subscription seats — those are the vendor CLI's own connections, made by the CLI in its own process. Nothing is ever sent to any consensus-operated service; there isn't one.

## Offline and air-gapped installs

1. On a connected machine, produce a tarball:
   ```bash
   git clone https://github.com/seanheiney/consensus && cd consensus
   pnpm install && pnpm build
   npm pack            # -> consensus-panel-0.1.0.tgz
   ```
   `npm pack` ships `dist/`, `packs/`, `README.md`, `PACKS.md`, `LICENSE`, and `install.sh`, so the target machine needs no build toolchain — but it still resolves runtime dependencies from a registry. For a fully offline target, also mirror those (`npm pack` each dependency, or use a registry proxy such as Verdaccio).
2. Copy the `.tgz` across and install it:
   ```bash
   npm install -g ./consensus-panel-0.1.0.tgz
   ```
3. Run setup without any network calls:
   ```bash
   consensus setup --yes --no-first-run
   ```
   The first debate is the only part of setup that talks to a model.

An air-gapped panel needs models it can reach. The `compat:` provider takes any OpenAI-compatible endpoint (`compat:my-model@https://llm.internal/v1`, key from `COMPAT_API_KEY`), and `ollama:<model>` targets a local Ollama at `http://localhost:11434/v1`. Two local models under different personas make a valid panel.

## Verifying the install

```bash
consensus --version          # 0.1.0
consensus doctor             # accounts, profiles, and which IDEs are wired up
consensus doctor --probe     # plus one tiny real call through each connection
consensus models             # the model catalog and how each vendor is reachable
consensus profiles           # your profiles (* = default)
```

`consensus doctor` is the single command to paste into a bug report. It prints three sections: **Accounts** (per vendor: connected / unverified / missing, and how), **Profiles**, and **Hosts** (detected, and whether the MCP entry and skill file are actually present).

Checksums and signature verification for the installer are **planned, not implemented**. Until then, the auditable path is to download `install.sh`, read it, and run it — or skip it and use `npm install -g <tarball>` directly.

## Upgrading

```bash
# whichever way you installed, this upgrades in place:
curl -fsSL https://raw.githubusercontent.com/seanheiney/consensus/main/install.sh | sh -s -- --yes
# or, by hand:
npm install -g https://github.com/seanheiney/consensus/archive/refs/heads/main.tar.gz
```

After upgrading:

```bash
consensus profile refresh    # re-materialize preset profiles against your current connections
consensus install            # re-register MCP + skills if host formats changed
```

`profile refresh` matters after you upgrade a *vendor* CLI too: it re-picks models your CLIs can actually drive, and removes preset profiles nothing can seat any more.

Your config, profiles, packs, personas, and saved runs are untouched by an upgrade.

## Uninstalling

```bash
consensus uninstall           # remove MCP registrations and skill files from every host
npm uninstall -g consensus-panel
```

`uninstall` reverses each host change it made — `claude mcp remove`, `codex mcp remove`, `gemini mcp remove`, `grok mcp remove`, the `mcpServers.consensus` entry in each JSON config, the `~/.*/skills/consensus/` directories, and the marked blocks in `AGENTS.md` / Windsurf rules — and prints what it removed.

It **keeps** your config and saved API keys by default. To delete those too:

```bash
consensus uninstall --purge   # also deletes ~/.config/consensus entirely
```

Project-level files (`.mcp.json`, `.cursor/`, `.claude/`, `.agents/`, the blocks in `AGENTS.md` and `CLAUDE.md`) are part of your repo, so they are left for you to remove with git. Saved debates under `.consensus/` are also left in place.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `npm ERR! 404 Not Found - GET https://registry.npmjs.org/consensus-panel` | The npm package is not published yet. | Install the tarball: `npm install -g https://github.com/seanheiney/consensus/archive/refs/heads/main.tar.gz`. The one-liner does this automatically. Do **not** use `npm i -g github:seanheiney/consensus` — that shorthand is broken here. |
| `npm warn EBADENGINE Unsupported engine … required: {"node":">=22"}` (or an install that "works" then crashes on modern syntax) | Node is older than 22. | `node -v` to confirm, then upgrade: `brew install node`, `fnm install 22 && fnm use 22`, or `nvm install 22 && nvm use 22`. Re-run the installer afterwards. |
| `command not found: consensus` right after a successful install | The npm global `bin` is not on `PATH`, or your version manager changed shells. With **nvm/fnm** a global install belongs to *that* Node version, so switching versions hides it. | `npm prefix -g` prints the prefix; make sure `<prefix>/bin` is on `PATH` and open a new terminal. With nvm/fnm, either re-install after `nvm use 22`, or install into a version-independent prefix: `npm install -g --prefix "$HOME/.local" <tarball>` and add `~/.local/bin` to `PATH`. If you used the `~/.npm-global` fallback, the installer appended the `PATH` line to your rc file — start a new shell. |
| `install.sh: line N: $@: unbound variable`, or odd `$VAR`-adjacent parse errors | macOS `/bin/sh` is bash 3.2, which errors on `"$@"` under `set -u` with no arguments and mis-parses some non-ASCII bytes immediately after a variable. | The shipped script is bash-3.2-clean (`sh -n install.sh` passes, and it expands `${@+"$@"}`). If you edited it, keep both rules. If you hit this from an old copy, re-download the script. |
| `Need at least 2 connected models, found 1` (or `found 0`) | A panel needs two seats and only one vendor is reachable. | `consensus doctor` shows what is missing. Fastest fix: one `OPENROUTER_API_KEY` seats every vendor (`consensus connect openrouter`). Otherwise `consensus connect <vendor>`, or use a single-vendor panel: `consensus profile create claude-family --preset claude-family`, or personas on one model (`--preset perspectives`). |
| `pre-flight found seats that cannot run: …` | A seat's route was checked before spending anything and cannot work: the CLI is missing, not logged in, or too old for that model. | Each line names the fix. Do that, or change the panel (`--panel`, `--profile`), or re-seat the profile with `consensus profile refresh`. `--force` runs anyway and drops those seats; the run then exits with code 2. |
| `gemini produced no answer … IneligibleTierError` / "Google login file found but that tier no longer serves the CLI" | Google retired the free individual login for Gemini CLI. A login file on disk is no longer a working connection. | Set an API key: `consensus connect google` (or export `GEMINI_API_KEY`). Alternatively route Gemini through OpenRouter (`openrouter:google/gemini-3.1-pro-preview`). |
| `needs Codex >= 0.154.0, you have 0.1xx` | `gpt-6-astra` can only be driven by a recent Codex CLI. | `npm install -g @openai/codex@latest`, then `consensus profile refresh`. Or seat a model your Codex can drive: `codex:gpt-5.6-sol`. Preset profiles substitute the next tier down automatically. |
| `[--] missing` beside a vendor in `consensus doctor` | That is the "not connected" marker (ASCII mode renders `○` as `[--]`, `✓` as `[ok]`, `?` as `[?]`). The line's right-hand side says why: no key, CLI not installed, or not logged in. | Follow the reason on that line, then re-run `consensus doctor`. A `[?] unverified` means a CLI reports installed but login could not be confirmed — `consensus doctor --probe` settles it with one real call. |
| A run hangs with no output | Frontier seats at `max` effort genuinely take minutes per call; a stuck vendor CLI is capped at 20 minutes per call before it is killed. | `tail -f .consensus/runs/<id>/debate.md` — the path is printed when the run starts — to see which seat is outstanding. Use `-v` for live verdicts. `Ctrl-C` aborts cleanly and still writes the log. If one vendor is consistently stuck, `consensus doctor --probe` will show it; drop that seat with `--panel`. |
| The `consensus` MCP tool does not appear in Claude Code (or Cursor / Codex) | The MCP entry was not written, or the host cannot resolve the `consensus` command (GUI apps do not inherit your shell `PATH`). | `consensus doctor` shows "MCP registered / not registered" per host. Re-run `consensus install`. Then restart the host — none of them re-read MCP config live. For GUI hosts (Cursor, Windsurf, Claude Desktop) consensus writes an **absolute** node + script path for exactly this reason; if you hand-edited the config back to bare `consensus`, restore the absolute form: `consensus install --mcp-only`. Verify Claude Code separately with `claude mcp list`. |

Still stuck? Open an issue with the output of `consensus doctor` and `consensus --version`, plus your OS and `node -v`: <https://github.com/seanheiney/consensus/issues>.
