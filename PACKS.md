# Packs

A pack is one JSON file bundling profiles, the personas they use, and optionally a bench suite that shows what the pack is good at. Seats are written as `any:<model>` so a pack resolves to whatever you have connected: a logged-in vendor CLI, an API key, or OpenRouter.

```bash
consensus pack add security-council                 # a pack shipped in this repo
consensus pack add <owner>/<repo>                   # consensus-pack.json at the root of a GitHub repo
consensus pack add <owner>/<repo>/packs/my.json     # any file in a repo
consensus pack add https://…/pack.json              # any URL
consensus pack add ./my-pack.json                   # a local file
consensus pack list
consensus pack remove security-council
consensus pack create my-pack -p frontier,perspectives -o my-pack.json   # share what you built
```

`pack add` shows everything the pack would install, including the full text of every persona (a persona is an instruction fed to your models on your quota, so read it), and asks before writing. Packs never overwrite a profile or persona you already have: a conflicting name is installed as `<pack>/<name>`. Packs never run anything.

## Packs in this repo

| Pack | What it is | Needs |
|---|---|---|
| `security-council` | attacker vs defender vs pragmatist vs generalist, plus a webhook-design bench case | 4 vendors, or 1 + OpenRouter |
| `startup-advisors` | economist, operator, skeptic, user advocate on one frontier model | just a Claude subscription or key |
| `product-review` | the expert review panel used to validate consensus itself: six reviewer archetypes plus an adversarial verifier, fixed 1–5 rubric, P0–P3 findings, ship/no-ship verdict; `product-review-lite` runs four seats on Sonnet 5 | 4 vendors or 1 + OpenRouter; lite needs only Claude |

## Publishing yours

Put a `consensus-pack.json` at the root of a public repo and tag it with the GitHub topic `consensus-pack`; people install it with `consensus pack add you/repo`. Include a `suite` with two or three cases that show where your panel beats `balanced`; `consensus bench -P balanced,your-profile -s suite.json` produces the scorecard.
