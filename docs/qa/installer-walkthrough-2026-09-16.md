# Installer walkthrough: the public one-liner as a brand-new user (2026-09-16)

What we tested: `curl -fsSL https://raw.githubusercontent.com/seanheiney/consensus/main/install.sh | sh`.
We fetched it from GitHub on the day of the test, and it matched the local `install.sh` byte for byte.
Setup: Docker 29.2.1 on an arm64 Mac, one fresh container per run, and the Mac with an isolated HOME. We entered no API keys and made no paid calls.
The installed package came from `main`, which moved while we tested: commit `4e2136d` in the first runs, `9bf276e` about 5 minutes later.

Line numbers below refer to `install.sh` as of this date unless another file is named.

## (a) Results

"Extra steps" means what a new user must do beyond the paste to get a working `consensus doctor` in a **new terminal**.
Wall time covers only the one-liner and excludes image build time.

| # | Scenario | Result | Wall | Exit | Extra steps beyond the paste | Time to first working `consensus doctor` |
|---|---|---|---|---|---|---|
| 1 | ubuntu:24.04, curl only, non-root, no sudo | **FAIL** (blocked at fnm) | 0 s | 1 | Unknown to the user. We found: (1) `apt install unzip` needs root, which the user lacks; (2) re-run; (3) run a `script`/tty workaround or `--yes`; (4) find `~/.local/share/fnm/node-versions/v24.21.0/installation/bin` and add it to PATH by hand | Never, from the paste alone |
| 1b | same, with `unzip` preinstalled | **FAIL** | 27 s | 2 | Node and the CLI install, then setup crashes on `/dev/tty` (line 197). `consensus` and `node` are missing in the new `sh -lc`, `bash -lc` and `bash -ic` shells | Never without finding the fnm path by hand |
| 2 | ubuntu:24.04, passwordless sudo | **FAIL** (same as 1; sudo is never used) | 0 s | 1 | Same as 1 | Never |
| 2b | same, `CONSENSUS_SYSTEM_NODE=1` (the documented escape hatch) | **FAIL** | 41 s | 1 | NodeSource installs Node 22 through sudo, then `npm install -g <tarball>` fails with EACCES on `/usr/lib/node_modules` | Never |
| 3 | node:22-bookworm as `node` | **FAIL** | 6 s | 1 | EACCES on `/usr/local/lib/node_modules`. The `~/.npm-global` fallback never runs | Never |
| 3b | same, `CONSENSUS_INSTALL_DIR=$HOME/.local` | **PARTIAL** | 22 s | 2 | Setup crashes on `/dev/tty`. A new **login** shell finds `~/.local/bin/consensus` (Ubuntu's `.profile` adds it); `bash -ic` does not | ~25 s plus opening a new login terminal, then a separate `consensus setup` |
| 4 | debian:bookworm-slim (sh = dash) | **FAIL** (same as 1, unzip) | 0 s | 1 | Same as 1 | Never |
| 4b | same, with `unzip` | **FAIL** | 9 s | 1 | `fnm env` fails with "Can't infer shell!" because bookworm-slim has no `ps`, then `die` at line 122 | Never |
| 5a | ubuntu + unzip, `sh -s -- --yes --no-first-run`, no tty | **PASS, but the CLI is not on PATH** | 28 s | 0 | Prints "Done. Next step: consensus …", but `command -v consensus` is empty in this shell and in `bash -lc` | 28 s, but only through the absolute fnm path we found by hand (doctor takes 1 s, exit 0) |
| 5b | re-run the plain one-liner (upgrade), no tty | **FAIL** | 5 s | 2 (see 1b) | Downloads fnm again. Does not say "already installed" (no `consensus` on PATH). Crashes at line 197 | – |
| 5c | `--no-setup` | **PASS, not on PATH** | 6 s | 0 | Says "Next step: consensus setup", a command that is not found | – |
| 5d | plain one-liner under a pty (`script -qfec`) | **PASS** (wizard runs to the end if you answer No 5 times) | 46 s total, first question at 14–22 s | 0 | Must press → then Enter 5 times, then Enter 3 times. Leaving the defaults (Enter) installs `@openai/codex` globally and blocks in `codex login` waiting for a browser | Same PATH problem as 5a |
| 6a | macOS, isolated HOME, owner's real PATH order (nvm Node 20 before `/opt/homebrew/bin`), brew stubbed | **FAIL (loop)** | 1 s | 1 | `brew install node` runs, but the nvm Node 20 still comes first on PATH, so `die "Node 22+ still not on PATH. Open a new terminal and re-run"`. A new terminal changes nothing | Never |
| 6b | macOS, Node 22 on PATH, piped stdin, no tty | **FAIL** | 11 s | 1 | `sh: line 197: /dev/tty: Device not configured` | – |
| 6c | macOS, same, `--yes --no-first-run` | **PASS, not on PATH** | 5 s | 0 | The `CONSENSUS_INSTALL_DIR` prefix is not on PATH in `env -i … zsh -lic` or `bash -lc` (this matches the docs, but the installer never says so) | 5 s plus a manual `export PATH` |
| 6d | macOS, no Node, no Homebrew (a fresh Mac) | **FAIL** (silent) | 0 s | 1 | fnm's installer requires Homebrew on macOS | Never |

About 6b and 6c: for safety we set `CONSENSUS_INSTALL_DIR` on the Mac. A real Mac user with Homebrew Node would install into `/opt/homebrew`, which is already on PATH, so 6c's PATH issue is partly caused by our test setup. The crashes in 6a, 6b and 6d are not.

Bottom line: **none of the six clean environments reaches a working `consensus doctor` in a new terminal from the paste alone.** The best case is Node 22 already installed with a writable global prefix, which in practice means Homebrew Node on a Mac. None of our clean rooms had that.

## (b) Findings

Each finding is falsifiable: the given environment and command reproduce the quoted output.

### P0: the paste dead-ends

**F1. The default no-Node path requires `unzip` and dies with no consensus error message.** (Scenarios 1, 2, 4.)
`ubuntu:24.04` and `debian:bookworm-slim` ship without `unzip`. fnm's installer checks for it and exits:
```
  using fnm installer (user-local, no sudo; set CONSENSUS_SYSTEM_NODE=1 to use apt instead)
Checking availability of unzip... Missing!
Not installing fnm due to missing dependencies.
== ONE-LINER EXIT=1 WALL=0s
```
- Responsible lines: 119, `curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell`, with `set -eu` on line 23. `install_node` is the last command of `node_ok || install_node` (line 125), so `set -e` still applies inside it. The failed pipeline kills the script before the friendly `die` on line 122. The user sees fnm's message, never ours, and no next step.
- The header claim "one line, no prerequisites" (line 2) is false on these images.
- The sudo user in scenario 2 fares no better: sudo is never considered unless `CONSENSUS_SYSTEM_NODE=1` is set.
- Fix: stop depending on fnm's installer. Download the official Node tarball (`.tar.xz` or `.tar.gz`, which need no unzip) into `~/.consensus/node`, or ship the bundled runtime from the design doc. Short term: check `have unzip` before line 119, and write the call as `if ! curl … | bash …; then die "…needs unzip: sudo apt-get install -y unzip, or install Node 22 from nodejs.org"; fi` so `set -e` cannot swallow the message.

**F2. Every non-root Linux user with a system Node hits EACCES, and the `~/.npm-global` fallback can never run while the package is unpublished.** (Scenarios 3 and 2b.)
```
  consensus-panel is not on npm yet; installing from https://github.com/seanheiney/consensus/archive/refs/heads/main.tar.gz
npm error code EACCES
npm error path /usr/local/lib/node_modules/consensus-panel
[31merror:[0m install from https://github.com/seanheiney/consensus/archive/refs/heads/main.tar.gz failed (see output above)
```
- Responsible lines: 146–158. The first `npm install -g consensus-panel` fails with **E404**, because npm resolves the package before it touches the directory. That takes the E404 branch, and the tarball retry on line 157 fails with EACCES and calls `die`. The EACCES branch (lines 159–169) is only reached by a first attempt that fails with EACCES, which is impossible until `consensus-panel` is on npm.
- This hits `node:22-*` images, NodeSource or distro `nodejs` packages, and the documented `CONSENSUS_SYSTEM_NODE=1` path, which spends 41 s installing Node through sudo and then fails the same way.
- Fix: decide on the prefix before installing. If `[ -w "$(npm prefix -g)/lib/node_modules" ]` (or its parent) is false, use a user prefix up front, and do not change the global npm config (see F10). Alternatively, re-run the EACCES check on `$LOG` after the tarball attempt.

**F3. Piped installs without a usable terminal crash at line 197 instead of falling back to `--yes`.** (Scenarios 1b, 3b, 5b in Docker; 6b on macOS.)
```
sh: 197: cannot open /dev/tty: No such device or address        (dash, Docker)
sh: line 197: /dev/tty: Device not configured                   (macOS /bin/sh)
```
- Responsible lines: 196–197. `[ -r /dev/tty ]` only checks permission bits. `/dev/tty` exists and is mode 0666 even when the process has no controlling terminal, so the test passes, and the redirection `</dev/tty` then fails.
- This hits `docker run` without `-t`, CI, `ssh host 'curl … | sh'`, cron, and agent or IDE runners.
- The exit code is 2 (dash) or 1 (bash) after "consensus 0.1.0" was already printed, so the CLI is installed but setup never ran and no "Done" is printed.
- `docs/install.md:153` says "when there is no terminal at all, it runs `consensus setup --yes`". That is false today.
- Fix: probe by actually opening the device inside a subshell, e.g. `( exec </dev/tty ) 2>/dev/null`, and fall through to the non-interactive branch. **Do not** use the design doc's `{ : </dev/tty; } 2>/dev/null` (see G1).

**F4. After a fnm install, nothing persists: no new terminal ever finds `node` or `consensus`.** (Scenarios 1b and 5a.)
```
  consensus 0.1.0 (9bf276e, built 2026-09-16)
…
Done. Next step:
  consensus "Should we use optimistic locking or a distributed lock for inventory holds?"
== EXIT=0 WALL=28s
consensus after in this shell: none
/home/user/.local/share/fnm/node-versions/v24.21.0/installation/bin/consensus
login bash: consensus NOT FOUND
```
- Responsible lines: 119 (`--skip-shell`), 120–121 (`export PATH`, then `eval "$(fnm env)"` in the installer's own process only) and 202–204, which print "Done. Next step: consensus …" and exit 0 even though the command is not found in any shell the user owns.
- The global prefix is under a versioned fnm directory, so the binary also disappears on a Node version switch.
- Line 176 (`have consensus`) passes only because of the PATH the script exported itself. It proves nothing about new shells.
- Fix: install the CLI into a version-independent location (`~/.local/bin` or `~/.consensus/bin`), write an env file and guarded rc lines (`.profile`, `.bashrc`, `.zshrc`, `.zprofile`), and verify with `env -i HOME="$HOME" "$SHELL" -lc 'command -v consensus'`. If that check fails, print `export PATH=…` for the current shell instead of "Done".

**F5. On macOS, an older nvm Node shadows the Homebrew install: an endless "open a new terminal and re-run" loop.** (Scenario 6a, the owner's own PATH order.)
```
[1mNode.js 22+ is required. Installing...[0m
  using Homebrew
[STUB brew install node] (real brew not invoked)
[31merror:[0m Node 22+ still not on PATH. Open a new terminal and re-run, or install from https://nodejs.org
```
- Responsible lines: 105–106 and 126. `brew install node` puts Node into `/opt/homebrew/bin`, but `~/.nvm/versions/node/v20.20.1/bin` comes earlier on PATH (the owner's real PATH puts it 6th, `/opt/homebrew/bin` 7th). `node_ok` still sees v20, and a new terminal has the same order, so re-running loops.
- The brew check (line 105) also runs *before* the nvm check (line 111), so a user who manages Node with nvm gets an unwanted global Homebrew Node.
- The run also prints "already installed: … (this run upgrades it in place)" and then fails.
- Fix: when `node` exists but is too old, check nvm and fnm first (`nvm install 22 && nvm use 22`, and tell the user to run `nvm alias default 22`). After any install, run the newly installed binary by absolute path (`/opt/homebrew/bin/node`) rather than whatever PATH resolves. Best: use a bundled runtime and ignore the user's Node entirely.

**F6. On a fresh Mac without Homebrew, the fnm fallback dies silently.** (Scenario 6d.)
```
  using fnm installer (user-local, no sudo; set CONSENSUS_SYSTEM_NODE=1 to use apt instead)
Downloading fnm using Homebrew...
Checking availability of Homebrew (brew)... Missing!
Not installing fnm due to missing dependencies.
```
- Responsible line: 119. fnm's installer uses Homebrew on Darwin unless given `--force-install`. As in F1, `set -e` kills the script before the `die` on line 122, and the exit code is 1.
- A Mac with neither Node nor Homebrew is the most common "brand-new user" machine.
- Fix: pass `--force-install` on Darwin as the short-term fix, or (better) download Node's official `darwin-arm64`/`darwin-x64` tarball, or use the bundled runtime.

### P1: works, but stalls or misleads

**F7. `fnm env` needs `ps`, so Node installs and then `die`s on minimal images.** (Scenario 4b.)
```
error: Can't infer shell!
fnm can't infer your shell based on the process tree.
Installing Node v24.21.0 (arm64)
error: We can't find the necessary environment variables to replace the Node version.
[31merror:[0m could not install Node automatically. Install Node 22+ from https://nodejs.org and re-run.
```
- Responsible line: 121, `eval "$(fnm env)"`. The same step works on ubuntu:24.04, which has `ps`; bookworm-slim has none. This is caused by the missing process tree tool, not by dash itself.
- Fix: `eval "$(fnm env --shell bash)"`, or skip `fnm env` and prepend `$FNM_DIR/node-versions/<v>/installation/bin` to PATH directly.

**F8. Pressing Enter through the wizard installs third-party CLIs globally and blocks on a browser login.** (Scenario 5d.)
Every "Connect X?" defaults to Yes (`src/setup.ts:137`, `initialValue: true`). For a vendor whose CLI is missing, the first option is "Install codex and log in" (`src/setup.ts:78`). Two presses of Enter give:
```
◇  Connect OpenAI / ChatGPT
│  Install codex and log in (ChatGPT Plus/Pro)
◇  Running: npm install -g @openai/codex
added 2 packages in 4s
◇  Running: codex login  (a browser window may open)
Starting local login server on http://localhost:1455.
On a remote or headless machine? Use `codex login --device-auth` instead.
```
- The wizard then hangs; our 150 s timeout killed it.
- Because of F13, **no config was written**: `~/.config/consensus/config.json` did not exist, but `~/.codex` did.
- The first run of the wizard asks five yes/no questions before doing anything useful, and a user without subscriptions must decline each one.
- Fix: start with one multiselect ("Which do you have? Claude sub / ChatGPT sub / API keys / OpenRouter key / none yet"). Default to "Paste an API key" or "Skip" when the CLI is not installed. Use `codex login --device-auth` when `SSH_CONNECTION` is set or `DISPLAY`/`BROWSER` is missing. Put a timeout on `interactive()` (`src/setup.ts:67–70`).

**F9. The "success" screens print commands that do not work.**
- Line 188 (`--no-setup`) says "Next step: consensus setup", and lines 202–204 say "Done. Next step: consensus …". In 5a, 5c and 6c neither command is on PATH.
- With 0 connections the wizard says `Done. Try: consensus "Should we use …"` (`src/setup.ts:244`), and following that advice gives:
```
Error: Need at least 2 connected models, found 0. Run `consensus setup` to connect your subscriptions or add API keys, or pass --panel.
```
- Setup still exits 0 (see also design gap 6).
- Fix: print the absolute path whenever `consensus` is not resolvable in a new shell. When fewer than 2 connections exist, end with "Not ready: connect 2 models. Fastest: `consensus connect openrouter`" and a non-zero status under `--yes`.

**F10. The MCP launch command is bare `consensus mcp` even when `consensus` is only on the installer's temporary PATH.**
- Every run printed `Installed (MCP command: consensus mcp)`, including 5a (fnm) and 6c (custom prefix).
- `src/hosts.ts:172` checks `onPath("consensus")` against the installer-exported PATH (lines 120–121, 141), so Claude Code and Codex get `consensus mcp` registered and then cannot launch it from a normal environment.
- Fix: pass the absolute launcher path from the installer (`CONSENSUS_LAUNCHER`) and prefer it in `mcpLaunchCommand`.

**F11. Re-running is not an upgrade, it is a full reinstall.** (Scenario 5b.)
- `have consensus` (line 91) is false in a new process after a fnm install, so the run neither says "already installed" nor skips Node.
- fnm is downloaded again ("Downloading …fnm-arm64.zip…", "warning: Version already installed"), the tarball is reinstalled, and the setup wizard is launched again (or it crashes, per F3).
- Fix: keep a receipt file, detect by absolute path, and on re-run with existing config run `consensus doctor` instead of `setup` (design 3.9 covers this).

**F12. `CONSENSUS_SYSTEM_NODE=1` in a container hits an interactive `tzdata` prompt.** (Scenario 2b.)
- `apt-get install -y nodejs` pulls in `python3` and `tzdata`. Without `DEBIAN_FRONTEND=noninteractive`, the log shows `Geographic area:` 13 times before it falls back to UTC. In a pty this waits for input.
- Responsible line: 116. Fix: `sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs`. The escape hatch then still fails at F2.

### P2: rough edges

**F13. Config is written only after all account and profile questions.** `saveUserConfig` runs at `src/setup.ts:189`. Aborting during a vendor login (F8) leaves nothing behind, so the next run asks every question again. Fix: save after each connection step.

**F14. No progress feedback during the ~20 s tarball install.** Lines 132–134 send npm output to `$LOG`, so a user in scenario 3b sees "installing from https://github.com/…" and nothing more for about 20 s. Fix: a spinner or elapsed-time ticker. (Covered by design gap 8.)

**F15. The installer tracks moving `main` with no version pin shown.** Two runs 5 minutes apart installed `4e2136d`, then `9bf276e`, both reported as `0.1.0`, so "0.1.0 -> 0.1.0 (already current)" cannot tell builds apart. Fix: releases and tags (design gap 7). Meanwhile, compare the build hash on line 178.

**F16. Running `CONSENSUS_SYSTEM_NODE=1` on a non-apt distro, or without sudo, silently uses fnm anyway.** Line 115 requires both `apt-get` and `sudo`, otherwise it drops to fnm with no warning that the requested option was ignored. Fix: `info` when the option is set but cannot be honoured.

### P3: cosmetic

**F17. A zero-width pty makes clack print one character per line.** Under `script` without a window size (some CI pty wrappers), the Detected box and every prompt rendered one letter per line (first 5d attempt). Setting `stty cols 100` fixed it. Fix: in `src/setup.ts`, fall back to 80 when `process.stdout.columns` is 0.

**F18. Grammar and wrapping.** `▲  Only 0 vendor connected.` (`src/setup.ts:150`): pluralize, and say "No models connected yet" for 0. At 80 columns the Detected box wraps `claude not installed, no\n│  ANTHROPIC_API_KEY`: shorten the status text.

**F19. The fnm curl progress bar floods non-tty logs** (`#=#=#   ##O#-#` repeated on one very long line in Docker logs). Fix: `curl -sS` when stderr is not a tty.

## (c) What `docs/design/one-paste-installer.md` does and does not address

**Addressed, in whole or in part, by the bundled-runtime design:**
- F1 and F6: no fnm, no unzip, no Homebrew dependency. Gap 1 names unzip only for Alpine; this walkthrough shows stock Ubuntu and Debian hit it too.
- F2: no npm global prefix at all.
- F4, F9 (first half) and F10: env file, rc lines, absolute launcher path, "for this shell" hint (3.4, 3.5).
- F5: "your own Node, if any, is untouched".
- F7: no fnm.
- F11: receipt and doctor-on-rerun (3.9).
- F9 (second half): exit 3 when not ready (3.6).
- F14: progress output (3.7).
- F15: releases with SHA256SUMS.

**Gaps and errors in the design doc:**

- **G1 (P0 if copied as written). The proposed `can_prompt` kills dash with no message.** Section 3.5 uses `{ : </dev/tty; } 2>/dev/null`. Under POSIX a redirection error on a special built-in (`:`) is fatal in a non-interactive shell. Verified:
  ```
  T='set -eu; can(){ { : </dev/tty; } 2>/dev/null; }; if can; then echo prompt; else echo no-tty-branch; fi; echo reached-end'
  macOS /bin/sh -c "$T"                        -> no-tty-branch / reached-end  rc=0
  docker debian:bookworm-slim sh -c "$T"       -> (no output)                   rc=2
  ```
  `( exec </dev/tty ) 2>/dev/null` works in both. Use that form.
- **G2. Gap 6 describes current behaviour incorrectly.** It says "on a non-TTY we silently switch to `--yes`". In fact the script crashes at line 197 (F3), because `-r /dev/tty` is true without a controlling terminal. `docs/install.md:153` makes the same wrong claim. Nothing in the migration plan fixes the current script before the rewrite lands.
- **G3. `set -e` swallowing every `die` inside `install_node`** (F1, F6) is not mentioned. The rewrite needs an explicit rule: pipelines to external installers must sit inside `if !` or `||` so the failure message is ours.
- **G4. EACCES fallback unreachable while unpublished** (F2) is not listed. Gap 3 only covers the side effect of the branch, and "PR 1: publish to npm" would change behaviour silently. If npm stays a second channel, this ordering bug should be fixed or the branch removed.
- **G5. nvm-before-Homebrew PATH shadowing** (F5) is not listed. Gap 4 covers nvm version switching, not the install-time loop that affects the owner's own machine.
- **G6. Missing `ps` for `fnm env`** (F7) is not listed. Moot if fnm goes, but it breaks today's script.
- **G7. The wizard flow itself.** The design says "Unchanged: the wizard's questions" (section 4). The biggest post-install friction is in the wizard: five sequential Yes-defaulting questions, Enter triggering a global `npm install -g @openai/codex`, a browser login that hangs on headless machines with no `--device-auth`, no timeout, and config not saved until late (F8, F13). A one-paste experience needs a "which of these do you have?" first screen and headless-aware logins.
- **G8. The 0-connection end state in interactive mode.** 3.6 fixes `--yes` exit codes, but the interactive wizard still ends with `Done. Try: consensus "…"`, which errors (F9). The "aha" moment needs a no-subscription path, e.g. "paste one OpenRouter key" as the highlighted first option.
- **G9. Container and CI specifics:** `DEBIAN_FRONTEND` for the apt path (F12), zero-width pty rendering (F17) and curl progress spam in logs (F19).
- **G10. No interim fix list.** The design needs about 4 PRs and a release pipeline. Meanwhile F1–F7 each have a 1–5 line fix in today's `install.sh` that would make scenarios 3, 4 and 6b pass. The doc should say whether to patch the current script or leave it broken until PR 4.

## Appendix: how to reproduce

- **Docker images:** `FROM ubuntu:24.04` (and `debian:bookworm-slim`), then `apt-get install -y curl ca-certificates [sudo] [unzip]`, `useradd -m -s /bin/bash user`, `USER user`. For scenario 3: `FROM node:22-bookworm`, `USER node`.
- **Runs:** `docker run --rm IMAGE sh -c "$SCRIPT" </dev/null`, where `$SCRIPT` runs the one-liner, then `consensus --version`, `consensus doctor`, `sh -lc`, `bash -lc` and `bash -ic 'command -v consensus'`.
- **Pty wizard:** `(until grep -q 'Connect Anthropic' $L; do sleep 1; done; for k in 1 2 3 4 5; do sleep 3; printf '\033[C'; sleep 1; printf '\r'; done; …) | timeout 200 script -qfec "stty cols 100 rows 40; curl -fsSL $URL | sh" $L`.
- **macOS:**
  - `HOME`, `XDG_CONFIG_HOME` and `CONSENSUS_INSTALL_DIR` were all under the session scratchpad.
  - `NVM_DIR` was unset.
  - PATH was restricted to `stub-brew:nvm-v20/bin:/usr/bin:/bin` (6a), `node-v22.23.2-darwin-arm64/bin:/usr/bin:/bin` (6b, 6c), or `env -i PATH=/usr/bin:/bin` (6d).
  - Brew was stubbed so the real Homebrew was never invoked.
  - No real dotfile or global npm prefix was touched.
