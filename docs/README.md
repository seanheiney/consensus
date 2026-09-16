# consensus documentation

Start at the [project README](../README.md) for what consensus is and the 90-second quickstart. These pages are the detail.

## Guides

| Page | What is in it |
|---|---|
| [install.md](install.md) | Every install path with exact commands, what the installer does step by step and what it writes where, Node version handling, npm permissions, proxies, air-gapped installs, upgrading, uninstalling, and a troubleshooting table. |
| [usage.md](usage.md) | CLI reference organized by task — ask, watch, replay, profiles, personas, packs, bench, MCP, library — plus the `provider[:model][#effort][+persona]` seat grammar, the model-id spelling rule, effort mapping per route, and exit codes. |
| [faq.md](faq.md) | Does it actually help, what it costs, subscriptions and vendor terms, what the clean room blocks, privacy, dropped seats, `agree` with disputes, `--rounds 1`, bringing your own model, sharing panels, CI, and whether there is an API. |
| [../PACKS.md](../PACKS.md) | Packs: bundling profiles, personas and a bench suite into one shareable JSON file, and publishing yours. |

## Project

| Page | What is in it |
|---|---|
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Dev setup with pnpm, running tests, adding a provider / persona / pack / host, and what a PR needs. |
| [../SECURITY.md](../SECURITY.md) | How to report a vulnerability, what the tool does and does not send anywhere, and credential file handling. |
| [../CHANGELOG.md](../CHANGELOG.md) | Releases. |

## Reference

| Page | What is in it |
|---|---|
| [qa/ux-validation-2026-09-15.md](qa/ux-validation-2026-09-15.md) | Two expert UX-validation runs against the real binary: rubric scoreboard, ranked findings, what was fixed between runs, and what is still open. Most of the current design decisions are answers to something in here. |

## Where to look for a specific thing

| Question | Page |
|---|---|
| The install one-liner failed | [install.md § Troubleshooting](install.md#troubleshooting) |
| `command not found: consensus` | [install.md § Troubleshooting](install.md#troubleshooting) |
| What files did this put on my machine? | [install.md § What gets written, and where](install.md#what-gets-written-and-where) |
| How do I spell a model id? | [usage.md § The spelling rule](usage.md#the-spelling-rule) |
| How do I stop it spending my quota? | [faq.md § How much does it cost?](faq.md#how-much-does-it-cost) |
| Is using my Claude subscription allowed? | [faq.md § Does it use my subscription](faq.md#does-it-use-my-subscription-and-am-i-allowed-to-do-that) |
| Can the panel read my repo? | [faq.md § Can panelists see my files?](faq.md#can-panelists-see-my-files) |
| A seat disappeared mid-run | [faq.md § Why did a seat get dropped?](faq.md#why-did-a-seat-get-dropped) |
| How do I wire this into my agent? | [usage.md § MCP server](usage.md#mcp-server) |
| How do I use it from Node? | [usage.md § Library](usage.md#library) |
