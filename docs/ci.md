# Consensus in CI

The repository ships a GitHub Action, so a panel can review a pull request, gate a risky path, or answer a design question from a comment.

Subscription seats do not work here. CI has no vendor login, and the vendors' terms cover interactive use of those CLIs. In CI, seat models through API keys: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `GROQ_API_KEY` or `OPENROUTER_API_KEY`.

Always set `max-cost`. It defaults to `$2` per run, and a pull request that keeps getting pushed to will run the panel again each time.

## Review a pull request

Groq's open-weight models make this cheap enough to run on every PR: three angles, one round, seconds.

```yaml
name: consensus review
on:
  pull_request:
    paths: ["migrations/**", "src/auth/**"]

permissions:
  contents: read
  pull-requests: write

jobs:
  panel:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
        with:
          fetch-depth: 0

      - name: Collect the diff
        run: git diff "origin/${{ github.base_ref }}"... > /tmp/diff.patch

      - uses: seanheiney/consensus@main
        with:
          prompt: |
            Review this diff for correctness, security and operational risk.
            Name the specific failure it would cause, or say plainly that you found nothing.
          context-file: /tmp/diff.patch
          panel: groq:openai/gpt-oss-120b
          variants: 3
          for: code-review
          verify: "true"
          comment: "true"
          max-cost: "0.50"
        env:
          GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
```

`verify: "true"` matters for review: it separates what the diff actually shows from what the panel assumed.

## Escalate only when the cheap panel is unsure

```yaml
      - uses: seanheiney/consensus@main
        id: panel
        with:
          prompt: "Is this migration safe to run online against a 400M-row table?"
          context-file: migrations/0042.sql
          profile: groq-fast
          escalate: frontier      # only if the first pass leaves it unsettled
          escalate-when: unsettled
          max-cost: "3"
        env:
          GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}

      - name: Fail the job when the panel could not agree
        if: steps.panel.outputs.converged != 'true'
        run: |
          echo "::warning::the panel did not converge; a human should read the report"
          exit 1
```

Built-in presets such as `groq-fast` and `frontier` resolve by name from the API keys in the job's environment; a custom profile must be committed in the repo's `consensus.config.json`.

## Answer a question from a PR comment

```yaml
on:
  issue_comment:
    types: [created]

jobs:
  panel:
    if: github.event.issue.pull_request && startsWith(github.event.comment.body, '/consensus ')
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: seanheiney/consensus@main
        with:
          prompt: ${{ github.event.comment.body }}
          comment: "true"
          max-cost: "1"
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

A comment body is untrusted input written by whoever opened it. The panel has no tools, no repo access and no network of its own, so the worst a hostile comment gets is a wrong answer in a comment — but keep `permissions` minimal anyway, and do not pass secrets beyond the model keys.

## Inputs

| Input | Meaning |
|---|---|
| `prompt` (required) | The question, self-contained. |
| `context` / `context-file` | Material to paste in: a diff, a file, constraints. |
| `profile` / `panel` | Which models sit on the panel. |
| `variants` / `for` | Prompt-variant seats, or a task preset. |
| `rounds` / `effort` | Debate length and reasoning effort. |
| `verify` | Check the report's claims against the context supplied. |
| `escalate` / `escalate-when` | Promote to a stronger profile when the first pass is unsettled. |
| `max-cost` | Spend ceiling in USD (default 2). |
| `timeout-minutes` | Per-call timeout (default 10). |
| `comment` / `github-token` | Post the report on the pull request. |

## Outputs

| Output | Meaning |
|---|---|
| `answer` | The answer section alone. |
| `converged` | `true` when every seat accepted every other seat's answer. Agreement, not proof. |
| `run-id` | Id of the run. |
| `report` | Path to the full markdown report (also written to the job summary). |

## Gating on the result

`converged` reports agreement between models, not correctness. Failing a build on it is reasonable for "the panel could not agree, a human should look"; it is not a substitute for tests. Anything the panel asserts that the diff does not show is listed by `verify` as unsupported — that list is usually the useful part of the review.
