# Contributing to consensus

Thanks for looking. This is a small, opinionated tool; the bar for changes is "does it make the panel more trustworthy or the first five minutes easier".

## Development setup

Requires **Node 22+** and **pnpm 10+**.

```bash
git clone https://github.com/seanheiney/consensus
cd consensus
pnpm install

pnpm test          # vitest; no API keys or network needed
pnpm typecheck     # tsc --noEmit
pnpm build         # tsc -> dist/
pnpm ci            # typecheck + test + build + npm pack --dry-run (what CI runs)
```

Running it while you work:

```bash
pnpm dev "your question"          # tsx, straight from src/, no build
pnpm build && npm link            # `consensus` on PATH pointing at this checkout
node dist/cli.js --help
```

To avoid clobbering your real setup while testing config or install behaviour, point the tool at a scratch config directory:

```bash
XDG_CONFIG_HOME=$(mktemp -d) node dist/cli.js doctor
```

(Set `XDG_CONFIG_HOME` in the *same* command; exporting `HOME=…` and then referring to `$HOME` in the same line expands the old value and will write to your real config — that mistake produced two bogus findings in the first QA run.)

`dist/` is committed on purpose: tarball and git installs must work without a build step. Rebuild and include `dist/` in any PR that changes `src/`.

## Project layout

```
src/cli.ts            commander wiring; every command and flag
src/setup.ts          the setup wizard
src/config.ts         config schema, profile resolution, panel building
src/catalog.ts        model catalog, prices, presets, routing (direct vs OpenRouter)
src/doctor.ts         connection scanning, live probes, pre-flight
src/hosts.ts          IDE/agent integration: where MCP config and skills live
src/skillpack.ts      the SKILL.md / rules text installed into hosts
src/personas.ts       built-in personas and persona wrapping
src/packs.ts          pack schema, install/diff/create
src/bench.ts          benchmark runner, grading, report
src/protocol/         the debate itself: prompts, schemas, engine
src/providers/        one file per route (API SDKs, vendor CLIs, OpenAI-compatible)
test/                 vitest; providers are faked, nothing hits the network
packs/                packs shipped with the CLI
docs/                 install / usage / faq, and the QA reports
```

## Tests

`pnpm test` must pass with no credentials and no network. Anything that would call a model uses the fakes in `test/fake.ts`.

What to add with a change:

- **Protocol change** — a test in `test/engine.test.ts` driving a fake panel through the phases and asserting on the run record.
- **Spec, profile or config parsing** — `test/providers.test.ts` / `test/profiles.test.ts`.
- **Host integration** — `test/hosts.test.ts`, writing into a temp `HOME`.
- **Anything that has ever broken before** — a regression test, not a comment.

## Adding a provider

A provider is a function returning a `Panelist`: `{ id, provider, model, effort?, complete(req) }`.

1. If the endpoint is OpenAI-compatible, you probably do not need code at all — `compat:<model>@<baseURL>` already works. Adding a named entry to `PROVIDERS` in `src/providers/index.ts` (with `baseURL`, `envKey`, `reasoning`) is enough for a first-class alias.
2. For a genuinely different API, add `src/providers/<vendor>.ts` exporting `create<Vendor>Panelist(opts)`, and wire it into the `switch` in `createPanelist`.
3. Map effort onto whatever that route offers, and document the mapping in [docs/usage.md](docs/usage.md#effort-across-routes). Do not invent a rung the route does not have.
4. Report usage honestly. If the route does not tell you the input/output split, return **no usage** rather than a mislabelled number — cost estimation treats missing usage as unpriced, and that is the correct outcome.
5. Throw on failure with a message that names the fix. Transient errors (429, 529, timeouts) are retried once by the engine; everything else drops the seat.
6. For a **subscription CLI** route: run it in a temp directory, with every flag that ignores user config, tools and MCP servers, and document those flags in [docs/faq.md](docs/faq.md#what-does-the-clean-room-actually-block). The clean room is a promise the README makes; do not weaken it silently.
7. Add the models to `src/catalog.ts` with prices and, if relevant, an OpenRouter id and a `minCodex`-style minimum CLI version. Add to `src/doctor.ts` if the vendor has a CLI whose login must be detected.

## Adding a persona

Add an entry to `PERSONAS` in `src/personas.ts` with `name` (lowercase, dashes), a one-line `description` for `consensus personas`, and a `prompt`.

A good persona changes *how the model reasons*, not just its tone, and stays useful during critique and revision (it is applied to propose / critique / revise, never to synthesis). Keep it to a few sentences and make it about method: what to look for, what to distrust, what to quantify. Personas named after real people belong in a pack, not in the built-ins.

## Adding a pack

Packs shipped with the CLI live in `packs/*.json` and are installable by bare name (`consensus pack add security-council`).

```bash
consensus pack create my-pack -p profile-a,profile-b -o packs/my-pack.json
```

Requirements for a shipped pack:

- Seats must be portable (`any:<vendor model id>`) so the pack resolves on someone else's connections. `pack create` does this rewriting for you.
- Every persona's full text is shown to the user at install time, so write it to be read.
- Include a `suite` of two or three cases showing where the pack beats `balanced`. A pack that ships evidence is worth having; a bare model list is not.
- Add a row to the table in [PACKS.md](PACKS.md).

Third-party packs do not need a PR: publish `consensus-pack.json` at a repo root and tag the repo with the GitHub topic `consensus-pack`.

## Adding a host (IDE or agent)

Add an entry to `listHosts()` in `src/hosts.ts` with `detected`, `installed()`, `installMcp()`, `installSkill()` and — required — `uninstall()`. Rules that exist because they were violated once:

- Merge JSON configs, never replace them. If the file will not parse, **refuse to write** and print the entry for the user to paste; a comment in someone's `mcp.json` must not delete their other MCP servers. `mergeMcpJson` already does this; use it.
- Write a `.bak` beside any file you modify.
- Markdown files get the marked block (`<!-- consensus:start -->` … `<!-- consensus:end -->`) via `upsertBlock`, so it can be updated and removed cleanly.
- GUI hosts do not inherit a shell `PATH`: use `mcpLaunchCommand({ absolute: true })`.
- `installed()` must check reality (does the entry exist in the file), not just whether the host was detected.

## Docs

Docs are part of the change, not a follow-up.

- The README stays short: hero, quickstart, install matrix, agent integration, protocol, cost, links. Long material goes in `docs/`.
- Every factual claim must match the code. If you change a flag, command name, default, file path, or error message, grep the docs for it.
- No benchmark claims without the suite and the run that produced them. `consensus bench --baseline` exists so comparisons can be honest.
- Keep the subscription rate-limit and vendor-terms disclosure intact and prominent. It is not marketing copy to be trimmed.

## Pull requests

Before opening one:

```bash
pnpm ci
sh -n install.sh          # if you touched the installer
node dist/cli.js --help   # if you touched commands or flags
```

In the PR:

- One concern per PR. Behaviour change and refactor in the same diff makes review guesswork.
- Say what a reviewer should be suspicious of, and what you verified by hand (a real panel run, a real host install, the exact command).
- Include the docs update in the same PR.
- Include `dist/` if `src/` changed.
- New behaviour comes with a test. A bug fix comes with a test that fails without the fix.

Installer rules, because these have bitten before:

- `install.sh` must stay POSIX `sh` and work under macOS bash 3.2: `sh -n install.sh` passes, `"$@"` is written `${@+"$@"}`, and no non-ASCII character ever follows a `$VAR` directly.
- The installer must be safe to re-run and must not need root. Anything that wants `sudo` is opt-in behind an environment variable.

CI runs on Ubuntu and macOS with Node 22 and 24: typecheck, tests, build, `npm pack --dry-run`, `--help`, and a check that a bare word is still refused as a prompt.

## Reporting bugs

Use the issue templates, and include the output of `consensus doctor` and `consensus --version`. For anything security-related, see [SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

By contributing you agree your contribution is licensed under the [MIT License](LICENSE).
