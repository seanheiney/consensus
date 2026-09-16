# Security

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report it privately through GitHub: <https://github.com/seanheiney/consensus/security/advisories/new>. If private advisories are unavailable to you, open an issue titled "security contact request" with no details and you will be given a private channel.

Please include: the version (`consensus --version`), your OS and Node version, what an attacker controls, what they gain, and the smallest reproduction you can manage. A working proof of concept is welcome and stays private.

What to expect: an acknowledgement within 3 working days, an assessment within 10, and a fix released before public disclosure, crediting you unless you prefer otherwise. This is a solo-maintained project — if you have not heard back in a week, ping the issue tracker without details.

Please do not test against other people's machines, accounts, or vendor APIs.

## In scope

- Anything that causes consensus to exfiltrate prompts, context, keys or subscription tokens to a destination the user did not configure.
- Escapes from the subscription-seat clean room (a panelist reaching the user's files, MCP servers, memory, or shell through a vendor CLI consensus launched).
- Credential handling: file permissions, keys leaking into a subprocess environment, keys appearing in logs, reports, run records or the debate log.
- Pack, profile or config handling that executes code or writes outside the expected paths.
- Host integration that destroys or corrupts a user's existing configuration.
- Anything in the install path: the installer running unexpected code, writing outside npm's prefix, or escalating privileges.

## Out of scope

- The content of model answers, including a model being wrong, biased, or persuaded by a prompt injection in context you pasted. The panel is an advisory tool; treat its output as untrusted text.
- Vulnerabilities in the vendor CLIs (Claude Code, Codex, Gemini CLI, Grok) or vendor APIs themselves — report those to the vendor.
- Rate-limit consumption or billing surprises; see the cost and terms sections in [docs/faq.md](docs/faq.md).
- Anything requiring an attacker who already has write access to your home directory or your npm prefix.

## What consensus sends, and where

There is no consensus-operated server. No telemetry, no analytics, no usage reporting, no account, no update check.

**Outbound at run time**, and only this:

| Seat type | Destination | Made by |
|---|---|---|
| `claude`, `codex`, `gemini`, `grok` | The vendor's own endpoint, under your own CLI login | The vendor CLI, in its own process. consensus makes no network call. |
| `anthropic`, `openai`, `google`, `xai` | `api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com`, `api.x.ai` | The vendor's official SDK, with your key |
| `openrouter` | `openrouter.ai` | With your key |
| `compat:<model>@<url>`, `ollama` | Exactly the base URL you gave | With `COMPAT_API_KEY` if set |

**Outbound at install/setup time:** npm's registry and GitHub for the package; `github.com` / an arbitrary URL only when *you* run `consensus pack add <owner/repo|url>`.

**Written locally:** `~/.config/consensus/` (config and credentials), MCP entries and skill files in the IDEs you chose (listed in [docs/install.md](docs/install.md#what-gets-written-and-where)), and `.consensus/runs/<id>/` in the directory you ran from.

Saved runs contain your **verbatim** prompt and any context you pasted. `.consensus/` is added to `.gitignore` automatically inside a git repo; `--no-save` skips saving entirely and `"runsDir"` in config moves it off the project.

## Credentials

- Keys you paste into `consensus setup` are written to `~/.config/consensus/credentials.json` (or `$XDG_CONFIG_HOME/consensus/credentials.json`) with file mode **`600`**, set at creation and re-applied with `chmod` on every write. The directory is created with the default umask; on a shared machine, tighten it yourself (`chmod 700 ~/.config/consensus`).
- Keys are **never exported into `process.env`.** They are held in an in-process cache and handed only to the matching API client. This is deliberate: vendor CLIs are spawned as subscription seats, and a stored `ANTHROPIC_API_KEY` reaching Claude Code's environment would silently switch it from your subscription to per-token billing, while Codex would receive a competitor's key it has no business seeing.
- A key present in your shell environment always wins over a stored one.
- **Subscription seats never involve a key at all.** Auth stays inside the vendor CLI; consensus never reads, stores or forwards a subscription token.
- Keys are not written into reports, `run.json`, `debate.md`, or the shareable HTML page. If you ever find one there, that is a vulnerability — report it.
- `consensus uninstall --purge` deletes `~/.config/consensus` entirely, keys included. Plain `consensus uninstall` keeps them.

## Things worth knowing about the threat model

- **The clean room is configuration, not a sandbox.** Subscription seats are launched with every flag that disables tools, user config, rules files and MCP servers, in an empty temp directory — but it relies on the vendor CLI honouring its own flags. There is no OS-level isolation. If you need a hard boundary, run consensus inside your own container. The exact flags per vendor are listed in [docs/faq.md](docs/faq.md#what-does-the-clean-room-actually-block).
- **Context you paste is treated as data, not instructions.** It is wrapped in delimiters with an instruction to the panel that any instructions it appears to contain are not instructions. That is a mitigation, not a guarantee. Do not paste untrusted text and assume it cannot influence the panel.
- **Personas are instructions your models will follow on your quota.** `consensus pack add` prints every persona's full text and requires confirmation before installing, and never overwrites your own profiles or personas. Read packs from strangers before installing them, as you would any config.
- **Whatever you put in `prompt` or `context` goes to every seat**, which may be four different vendors. Strip secrets first.
- **Host configuration is merged, never replaced.** A config file that will not parse is left untouched and the entry is printed for you to paste, so an unparseable `mcp.json` can never cost you your other MCP servers. A `.bak` is written beside any file that is modified.

## Supply chain

The installer script is fetched over HTTPS from `raw.githubusercontent.com`. It downloads a release archive from GitHub Releases and **verifies its SHA-256 against the release's `SHA256SUMS`** before unpacking; a mismatch deletes the download and stops (exit 4). The archives are built by `.github/workflows/release.yml` from the tagged commit and carry **GitHub build-provenance attestations** (`gh attestation verify consensus-linux-x64.tar.gz --repo seanheiney/consensus`). The Node runtime inside each archive is the official nodejs.org binary, checked against nodejs.org's `SHASUMS256.txt` at build time. `SHA256SUMS` itself is not separately signed. See [docs/install.md](docs/install.md#verifying-the-install). The auditable path is still to download the script, read it, and run it:

```bash
curl -fsSL https://raw.githubusercontent.com/seanheiney/consensus/main/install.sh -o install.sh
less install.sh
sh install.sh
```

or skip the script entirely: download `consensus-<os>-<arch>.tar.gz` and `SHA256SUMS`, check them yourself, and extract anywhere.

The installer never uses `sudo` and refuses to run as root unless you pass `--allow-root`. It never installs a system Node or runs `npm install -g` into a system prefix; while no release exists, its fallback downloads the official Node into `~/.consensus` (sha256-verified) and npm-installs consensus into a prefix there.

## Supported versions

Pre-1.0: only the latest release on `main` receives fixes.
