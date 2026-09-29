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

## A cheap gate: check first, debate only on a split

`mode: check` asks every seat once, with no critique or revision, and reports whether the answers agree. Disagreement between independent models is a cheap uncertainty signal: when they all say the same thing there is little a debate would add; when they split, that is the case worth a full run and a human's attention.

```yaml
      - uses: seanheiney/consensus@main
        id: gate
        with:
          mode: check
          prompt: "Does this diff change the public API? Answer yes or no."
          context-file: /tmp/diff.patch
          panel: groq:openai/gpt-oss-120b
          variants: 3
          max-cost: "0.10"
        env:
          GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}

      - name: Full debate only when the quick check split
        if: steps.gate.outputs.needs-human == 'true'
        uses: seanheiney/consensus@main
        with:
          prompt: "Does this diff change the public API, and is the change safe for existing callers?"
          context-file: /tmp/diff.patch
          profile: frontier
          comment: "true"
          max-cost: "3"
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

A check costs one call per seat plus, only when the answers differ in wording, one call to the captain to group them into positions. Ask questions with a short answer (yes or no, a choice, a number): that is what makes the answers comparable. `rounds`, `verify` and `escalate` do not apply in check mode.

The step itself does not fail on disagreement; branch on the outputs. `agreement` is `unanimous`, `majority`, `split`, or `insufficient` (fewer than two seats answered, so there is no signal); `needs-human` is `true` for everything but `unanimous`. A seat that fails is reported as dropped in the report and never counted towards a position. Outside the action, `consensus check` exits `0` when unanimous, `1` when not, and `2` when it could not produce a signal, so a plain shell step can gate on it too:

```bash
consensus check "Is this migration reversible? Answer yes or no." -c migrations/0042.sql -P groq-fast || echo "models disagree (exit 1) or no signal (exit 2): escalate"
```

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
| `mode` | `run` (default, the full debate) or `check` (every seat answers once; sets `agreement` and `needs-human`). |
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
| `agreement` | Check mode: `unanimous`, `majority`, `split` or `insufficient`. |
| `needs-human` | Check mode: `true` unless every seat that answered agreed. |

## Gating on the result

`converged` reports agreement between models, not correctness. Failing a build on it is reasonable for "the panel could not agree, a human should look"; it is not a substitute for tests. Anything the panel asserts that the diff does not show is listed by `verify` as unsupported — that list is usually the useful part of the review.
