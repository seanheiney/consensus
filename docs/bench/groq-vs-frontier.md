# Cheap teams vs frontier models

**Question.** Can a team of cheap open-weight models on Groq, each seat prompted to attack the problem from a different angle, match or beat a frontier model answering alone? And if it does, is that because of the angles, the debate, or just more samples?

Status: plan and tooling ready (`packs/groq-teams.json`, `suites/reasoning.json`, `scripts/bench-groq-vs-frontier.sh`). Results will be added here with raw JSON.

## Arms

| Arm | What it is | What it isolates |
|---|---|---|
| `groq-angles` | 5 × gpt-oss-120b, angles: first-principles, skeptic, pragmatist, enumerator, alternate-method; gpt-oss-120b captain; 2 rounds | The headline cheap team |
| `groq-plain` | Same 5 seats and captain, no angle | What the angles add over a plain debate |
| `groq-angles-small` | Same angles on 2 × gpt-oss-120b + 3 × gpt-oss-20b | How cheap the team can get |
| `selfx5:groq:openai/gpt-oss-120b` | gpt-oss-120b answers 5 times, then merges its own best, no debate | What the debate adds over matched sampling |
| `single:groq:openai/gpt-oss-120b`, `single:groq:openai/gpt-oss-20b` | One answer | The floor |
| `single:claude:claude-fable-5-1`, `single:claude:claude-opus-5`, `single:codex:gpt-5.6-sol` | A frontier model alone, one answer | The bar to beat |
| `groq-angles-frontier-captain` (optional, `HYBRID=1`) | The cheap team argues, Opus 5 moderates and writes the report | Whether a frontier referee is worth paying for |

GPT-6 Astra is left out because it needs Codex CLI 0.154 or newer and this machine has 0.148; upgrade Codex and add `codex:gpt-6-astra` to the baselines to include it.

## Suites and scoring

- **Objective, `suites/reasoning.json`** (14 cases, 3 trials): counting, probability, JavaScript/Python/SQL semantics, calendar, concurrency. Every reference answer was verified by brute force or by running the code. **Accuracy is exact match on the answer's `FINAL:` line, computed by the bench, not by a model.**
- **Judgment, `suites/judgment.json`** (8 design and operations decisions, 2 trials): expert-written rubrics, graded by a model.
- **Quality** is graded blind by GPT-5.6 Sol, then the same answers are re-graded by Claude Sonnet 5. Both graders share a vendor with a frontier arm, and neither shares one with the Groq teams, so any self-preference favours the frontier side. A cheap-team win is therefore a conservative result; a frontier win needs both graders to agree.
- Every table reports n, standard deviation, per-case paired wins/ties/losses, wall time, and cost. Groq arms bill real API dollars at Groq list price; frontier arms run on subscriptions and report list-price equivalents.

## Fairness notes

- Same prompt text for every arm. Single-model arms get the plain problem, not the panel framing.
- Teams run 2 rounds (not 3) and the captain may end a stalemate early, to keep the team's wall time honest.
- Reasoning effort is `high` everywhere it is supported (gpt-oss `reasoning_effort`, Claude adaptive thinking, Codex `high`).
- Groq's per-minute token limits can slow the team arms; the provider retries 429s with backoff and the bench records wall time as measured, including those waits.

## Expected cost and time

Rough, before measurement: a Groq team debate is about 20–30 calls. Objective cases run around $0.05–0.10 per debate, judgment cases $0.15–0.25, so the full run is on the order of **$25 of Groq usage**. Frontier singles are about 60 Fable, 60 Opus and 60 Sol calls against subscription quota (plus about 170 Opus captain calls with `HYBRID=1`). Groq phases take seconds; the frontier CLI calls dominate wall time.

## Run it

```sh
consensus connect groq                     # key, plus base URL for a Groq-backed gateway
consensus pack add ./packs/groq-teams.json
sh scripts/bench-groq-vs-frontier.sh objective   # then: judgment
```

Interrupted runs resume where they stopped (the script passes `--resume` when results exist).
