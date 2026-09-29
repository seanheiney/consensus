# Clean rooms: threat model and evidence

A panel is only independent if each seat sees the question and nothing else: not your repo, not your global agent instructions, not the tools and MCP servers you use day to day, not another vendor's keys. This page says what a seat can and cannot see, how strongly each vendor's isolation is evidenced, how to check it yourself, and where the gaps are.

For the exact lockdown flags per CLI, see [the FAQ](faq.md#what-does-the-clean-room-actually-block).

## What a seat sees

Every seat receives exactly two things: the protocol's system prompt (plus its persona, if it has one) and the text of the debate so far, which starts from your `prompt` and `context`. Beyond that:

| | Can see | Cannot see |
|---|---|---|
| Working directory | A fresh empty temp directory, deleted after the call | The directory you ran consensus from, its `CLAUDE.md` / `AGENTS.md` / `Agents.md`, its git history |
| Environment | An allow-list: what any CLI needs to start (`PATH`, `HOME`, locale, temp dirs, proxy and CA variables) plus that vendor's own auth variables | Other vendors' keys, `GITHUB_TOKEN`, `SSH_AUTH_SOCK`, the host agent's session state (`CLAUDECODE`, its session id and messaging socket) |
| Tools | None. Claude Code's structured-output tool is the one exception; it only returns the JSON answer | Shell, file, browser, web and computer-use tools |
| Add-ons | CLI built-ins that ship with the binary (Claude Code `@builtin` plugins, grok bundled skills) | Your MCP servers, installed plugins, user skills, hooks, global instruction files |
| Other seats | Their answers and critiques, relayed by the protocol under anonymous labels | Their identities, reasoning traces, or anything they did not write into an answer |

A seat can still reach the network (it has to, to call its model), and its model provider sees the prompt. That is the point of the call, not a leak.

## Evidence levels

Each call returns a receipt, and a run records one per seat. The receipt's `evidence` says how strong the claim is:

- **observed**: the CLI itself reported what it loaded, and consensus checked the list. A seat is marked not clean if anything that counts against it appears.
- **configured**: consensus passed the lockdown flags and the allow-listed environment, but the CLI does not report what it actually loaded. This is a claim, not a verification.
- **request**: an API seat. The request is built by consensus with no tools attached, so there is nothing for the provider to load.

A seat's evidence is the weakest across all its calls.

| Seat | Evidence | How it is observed |
|---|---|---|
| `claude` (Claude Code) | observed | Claude Code's `stream-json` startup event lists the tools, MCP servers and plugins of that very call. |
| `grok` (Grok CLI) | observed | The seat runs with its own empty `HOME` and `GROK_HOME` holding only a copy of the login. Once per process, consensus runs `grok inspect --json` in a sandbox built the same way (a fresh temp-dir cwd holding a prompt file and the empty home, the same allow-listed environment, the login copied in) and records what grok says it would load there: project instructions, skills, plugins, MCP servers and hooks. `inspect` makes no model call. |
| `codex` (Codex CLI) | configured | See [Codex](#codex-why-it-stays-configured) below. |
| `gemini` (Gemini CLI) | configured | Gemini CLI's headless JSON carries no tool or MCP list. |
| API seats | request | No tools are attached to the request. |

### What counts against a seat

Any tool other than structured output, any MCP server, any installed plugin (enabled or not), any skill that is not a CLI built-in, any hook, any instruction file. On grok, also any agent that is not one of grok's own (source `builtin`), any LSP server, and remote settings having been loaded; these are listed as "other add-ons". A plugin that is installed but disabled still counts: grok found it, and one setting turns it on.

Built-ins are listed in the receipt but do not count: Claude Code's `@builtin` plugins, and grok skills whose source is `bundled` (shipped inside grok's install at `~/.grok/bundled`, the equivalent of Claude Code's built-ins). An empty sandbox reports none on grok 1.0.41; if a future grok starts shipping bundled skills into every home, they appear as `name@bundled` and the seat stays clean. User, plugin and config-file skills make it not clean. Built-in status comes from the source grok reports, never from the name: a user skill or plugin named `x@bundled` or `x@builtin` is recorded as `x@bundled (user)` and counts against the seat. Each suffix is honoured only in its own list (`@builtin` for Claude Code plugins, `@bundled` for grok skills).

Grok's inspect report does not list tools. Grok seats run with `--tools ""`, and the receipt says "tools off by flag" rather than claiming an observation it did not make.

### Codex: why it stays configured

Codex's clean room rests on `codex exec --ignore-user-config --ignore-rules -c mcp_servers={}` plus disabled features. Codex 0.148 has introspection commands (`codex mcp list --json`, `codex debug prompt-input`, `codex features list`, `codex doctor --json`), but none of them accepts `--ignore-user-config` or `--ignore-rules`: they only take `-c`, `--enable` and `--disable`. Running them would describe Codex with your `config.toml` loaded, which is not the configuration the seat runs under. It would report MCP servers the seat never sees (a false "not clean"), and it cannot show what `exec` loads with the user config ignored. Pointing `CODEX_HOME` at an empty directory would change where the seat finds its login, so it is not the same configuration either. Until Codex can report its loaded surface under the seat's own flags (for example a startup event in `exec --json`), codex seats are recorded as configured-only.

## The trust line

Every run carries a verdict in `run.json` (`cleanRooms`), at the end of the report, and in the MCP summary:

```
Clean rooms: 3/3 seats observed clean.
Clean rooms: 2 observed clean, 1 configured-only (codex:gpt-5.6-sol: lockdown flags, the CLI does not report what it loaded).
Clean rooms: NOT CLEAN: grok; 1 observed clean, 1 configured-only (3 seats).
```

"Observed clean" is verified: the CLI said it loaded nothing that counts. "Configured-only" is claimed: the flags were passed, and nothing checked what the CLI did with them. The per-seat lines below it give the details, including the observed lists and CLI built-ins.

`cleanRooms` has `seats`, `observedClean`, `configuredOnly`, `api`, `notClean` (seat ids) and `line`. Runs saved before this field existed get the same line derived from their `isolation` receipts when the report is rendered.

## Check it yourself

```bash
consensus doctor --isolation          # one tiny live call per subscription seat, human-readable
consensus doctor --isolation --json   # the same receipts as JSON, for CI or a bug report
```

Both make one small real call per connected subscription seat (it spends a little of each vendor's quota) and exit 1 if any seat is not clean or could not be checked. The JSON has this shape:

```json
{
  "ok": false,
  "seats": [
    { "id": "grok", "ok": true, "clean": true, "receipt": { "route": "cli", "evidence": "observed", "observedVia": "grok inspect --json in an identical sandbox", "skills": [], "mcpServers": [], "hooks": [], "instructions": [], "plugins": [], "flags": ["..."], "envPassed": ["..."], "envDropped": 41, "calls": 1, "clean": true } },
    { "id": "codex", "ok": false, "clean": false, "error": "codex produced no answer ..." }
  ],
  "cleanRooms": { "seats": 1, "observedClean": ["grok"], "configuredOnly": [], "api": [], "notClean": [], "line": "Clean rooms: NOT VERIFIED: codex could not be checked; 1/1 seats observed clean." },
  "unchecked": ["codex"],
  "withheld": ["GITHUB_TOKEN", "SSH_AUTH_SOCK"]
}
```

`cleanRooms` covers the seats that returned a receipt; `unchecked` names the ones that did not, and the line leads with them so a failed probe never reads as a clean room. `withheld` lists names (never values) of variables in your shell that look like keys, tokens or host-agent state and that no seat receives.

You can also look at grok's view directly, without a model call, by running `grok inspect --json` in an empty directory with `HOME` and `GROK_HOME` pointed at an empty folder. Run it in your real home to see what the sandbox keeps out.

## Known gaps

- **This is a configuration clean room, not a sandbox.** It relies on each vendor CLI honouring its own flags and environment. There is no OS-level isolation, container or seccomp profile. If you need a hard boundary, run consensus inside your own container.
- **Grok is observed once per process, not per call.** The inspect runs in a sandbox built exactly like each seat's, and every seat's sandbox is fresh, so the configuration is the same; but it is not the same process as the call. Anything grok would load only at call time (for example, something fetched from a remote settings service after login) is not covered. The inspect report includes `externalCompat.remoteSettingsLoaded`; it is `false` in an empty sandbox on grok 1.0.41.
- **Grok's inspect does not report tools.** Tools rest on `--tools ""`.
- **Grok's built-in agents are not counted.** Its own subagents (`general-purpose`, `explore`, `plan`, source `builtin`) always appear, and with no tools a seat cannot spawn them. Any other agent means something reached the sandbox, so it counts against the seat.
- **Codex and Gemini are configured-only.** See above. Gemini's MCP lockdown is an allow-list naming a server that does not exist, and has not been verified against a live Gemini CLI.
- **The login is copied in.** A grok seat's sandbox holds a copy of `~/.grok/auth.json`; a token grok refreshes during a call is copied back. The inspect sandbox never copies anything back.
- **Your own vendor key reaches its seat.** An `ANTHROPIC_API_KEY` in the launching shell still reaches the Claude seat (and switches it to per-token billing); consensus warns before a run.
