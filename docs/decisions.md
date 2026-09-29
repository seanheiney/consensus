# Decision records and drift rechecks

`consensus adr` writes a run up as an architecture decision record under `docs/decisions/`. `consensus adr --recheck` asks the question again later and records whether the answer still holds.

## Writing a record

```bash
consensus adr                      # the last run -> docs/decisions/0007-....md
consensus adr <run-id> --status Accepted
consensus adr --stdout             # print it instead
```

The record holds the question, the decision, the confidence, what stayed unresolved, the panel, the grounding check if one ran, and how to replay the debate. At the end there is an HTML comment, invisible when rendered, that a recheck reads back:

```html
<!-- consensus-adr {"v":1,"run":"20260924T120000Z-abc123","profile":"balanced","panel":["claude:claude-opus-5#high","codex:gpt-5.6-sol#high+skeptic"],"rounds":3,"effort":"high","context":"given","contextFile":"docs/inventory.md"} -->
```

It names the context file, never the context itself. The path is stored relative to the repo root, so it resolves in CI and never leaks a local home directory; a context file outside the repo is not named at all. Pasted context stays in the saved run under `.consensus/runs`, which is kept out of git.

## Rechecking

Models change, and so do the facts a decision rested on. A recheck puts the recorded question to a panel again, then makes one judge call that compares the new answer with the recorded decision:

- **unchanged**: same recommendation, for materially the same reasons.
- **refined**: the decision stands, but the new answer adds a condition, caveat or step a reader should know about.
- **changed**: the new answer recommends something different, or narrows the decision so much that the record would mislead.

```bash
consensus adr --recheck docs/decisions/0003-use-optimistic-locking.md
consensus adr --recheck --all                  # every record in docs/decisions (or --dir)
consensus adr --recheck --all --dry-run        # what would run, and with which panel; no model calls
consensus adr --recheck --all --profile frontier --max-cost 3 --json
```

Each recheck appends a dated section to the end of the record: the verdict, the panel, a one-paragraph delta, the new panel's confidence and the new run id. The original text is never edited. The file only grows, so `git diff` shows exactly what the recheck added. The comparison is always against the original decision, not against an earlier recheck.

```markdown
## Rechecked 2026-10-01

- **Verdict:** refined
- **Panel:** anthropic:claude-opus-5, openai:gpt-5.6-sol (--profile "frontier")
- **New confidence:** high
- **Run:** `20261001T060012Z-9f2c1a` (replay: `consensus log 20261001T060012Z-9f2c1a`)

Optimistic locking still stands, but the new answer adds a retry budget ...
```

Files that `consensus adr` did not write are skipped with a note. Records written before the marker existed are still recognised by their layout.

### Which panel

1. `--profile <name>`, when given.
2. The profile the record names, if it still exists and every seat in it can run here.
3. The seats the record lists, with their effort and personas.
4. Otherwise the active profile, or whatever `consensus` would seat today. The appended section says the recorded panel no longer resolves and why.

### Which context

1. The saved run the record points at, when this machine still has it: the original question and context, exactly.
2. Otherwise, if the record names a context file, that file as it is now. The section says it may have changed since the decision.
3. Otherwise the question alone. The section says the context could not be recovered.

A record whose original run had no context is rechecked with the question alone, and nothing is flagged.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | every rechecked record is unchanged or refined (skipped records do not count) |
| 1 | at least one decision changed |
| 3 | no decision changed, but a recheck failed (a panel error, an interrupt, or a verdict that did not parse; that record was left untouched), or the recheck could not start (no records named, missing directory) |

`--dry-run` exits 0 unless a record could not be read or its panel could not be resolved. An unknown flag is rejected by the argument parser with exit 1 before anything runs, so a scheduled job should confirm a `changed` entry in the `--json` output before treating 1 as drift, as the workflow below does.

If a seat drops out during a recheck, the appended section lists it under **Dropped seats**: the verdict then rests on the seats that answered.

## Scheduled recheck in GitHub Actions

Monthly, with API-key seats (CI has no subscription logins). The job commits the appended sections and opens an issue when a decision changed. Rechecks run from a fresh checkout, so there are no saved runs: records made with `-c <file>` re-read that file, and the rest are rechecked with the question alone.

```yaml
name: decision drift
on:
  schedule:
    - cron: "0 6 1 * *"   # 06:00 UTC on the 1st of every month
  workflow_dispatch:

permissions:
  contents: write
  issues: write

jobs:
  recheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0

      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: 22

      - name: Recheck every decision record
        id: recheck
        run: |
          set +e
          npx -y consensus-panel adr --recheck --all --profile frontier --max-cost 3 --json > "$RUNNER_TEMP/recheck.json"
          code=$?
          set -e
          cat "$RUNNER_TEMP/recheck.json"
          echo "changed=$(jq -r '[.[] | select(.status == "changed") | .file] | join(" ")' "$RUNNER_TEMP/recheck.json")" >> "$GITHUB_OUTPUT"
          # 1 with changed records is the signal this job exists for. Anything else fails the
          # job in the last step, after the records that did recheck are committed.
          if [ "$code" -eq 1 ] && jq -e 'any(.[]; .status == "changed")' "$RUNNER_TEMP/recheck.json" > /dev/null; then code=0; fi
          echo "code=$code" >> "$GITHUB_OUTPUT"
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}

      - name: Commit the appended sections
        run: |
          git config user.name "decision-drift"
          git config user.email "decision-drift@users.noreply.github.com"
          git add docs/decisions
          if ! git diff --cached --quiet; then git commit -m "Recheck decision records" && git push; fi

      - name: Open an issue for each changed decision
        if: steps.recheck.outputs.changed != ''
        env:
          GH_TOKEN: ${{ github.token }}
          CHANGED: ${{ steps.recheck.outputs.changed }}
        run: |
          for f in $CHANGED; do
            gh issue create --title "Decision drift: $(head -1 "$f" | sed 's/^# //')" \
              --body "A monthly recheck found that the panel's answer no longer matches the recorded decision. See the latest \"Rechecked\" section of \`$f\`."
          done

      - name: Fail if a recheck failed
        if: steps.recheck.outputs.code != '0'
        run: exit ${{ steps.recheck.outputs.code }}
```

Run `--dry-run` locally first to see which panel each record will get. A recheck is a full debate, so `--max-cost` applies to each record, and a directory of twenty records costs twenty runs.
