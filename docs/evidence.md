# Evidence: does the panel beat one model?

This page exists because the product's central claim deserves a measurement, not an assertion. It will be updated as runs accumulate; every table here links to the raw `results.json` and every run's full debate.

## Ablation 1 — 2026-09-16 (starter suite, protocol before the convergence fix)

**Setup.** The 5-case starter suite (3 objective: digit counting, dice probability, a bug in `secondLargest`; 1 objective debugging case: an EventEmitter listener leak; 1 judgment case: pagination design), 2 trials each, 4 arms: the `balanced` profile (Opus 5 + GPT-5.6 Sol, 3 rounds, external judge not yet default), the `fast` profile (Haiku 4.5 + GPT-5.6 Luna, 1 round), and two single-model baselines answering once with no panel framing. Graded blind and two-phase by `claude:claude-sonnet-5` on the seat's own machine. Raw data: [`docs/evidence/ablation-2026-09-16-results.json`](evidence/ablation-2026-09-16-results.json) (40 runs, each with its saved debate).

**Caveats stated up front.** (1) The grader shares a vendor with the Anthropic seats and with the Opus baseline; LLM judges favour their own family. (2) n = 10 graded runs per arm; treat differences under ~1 point as noise. (3) These are easy cases by design (the starter suite is a smoke test, not a benchmark); on all of them the single models were already near ceiling on accuracy. (4) This ablation ran under the previous convergence rule, under which the panel converged on first critique in every `balanced` run: **the revise phase never executed**. That rule has since been changed (any dispute now forces one revision), so a follow-up ablation is needed before any claim about the concede-or-rebut mechanic.

| Arm | n | Accuracy /10 | Quality /10 | Converged | Avg time | Tokens in / out |
|---|---:|---:|---:|---:|---:|---:|
| balanced | 10 | 9.8 | 9.4 | 100% | 91s | 184,528 / 97,596 |
| fast | 10 | 9.5 | 7.5 | 70% | 119s | 264,148 / 133,922 |
| single:claude:claude-opus-5 | 10 | 9.6 | 8.7 | n/a | 12s | 2,460 / 10,799 |
| single:codex:gpt-5.6-sol | 10 | 9.5 | 7.2 | n/a | 17s | 72,475 / 7,063 |

Head-to-head on the same case and trial (wins / ties / losses for the panel):

| Panel | Baseline | Quality | Accuracy |
|---|---|---:|---:|
| balanced | single:claude:claude-opus-5 | 6 / 4 / 0 | 1 / 7 / 0 |
| balanced | single:codex:gpt-5.6-sol | 10 / 0 / 0 | 2 / 6 / 0 |
| fast | single:claude:claude-opus-5 | 0 / 3 / 7 | 0 / 7 / 1 |
| fast | single:codex:gpt-5.6-sol | 6 / 0 / 4 | 0 / 8 / 0 |

**What this does and does not show.** On easy objective questions a single frontier model is already correct; the panel's measurable effect here is on quality (completeness, verification, honesty about assumptions), where `balanced` beat both baselines and `fast` (cheap models, one round) did not beat the stronger single model. The cost of that quality gain is roughly 7× wall time and ~50× the tokens of a single Opus call. Nothing here tests hard or ambiguous problems, which is where a debate should matter most, and nothing here separates "a second model reviewed it" from "the models argued", because no revision ran.

**Next measurements** (in priority order): re-run this suite under the new convergence rule and report how often revision fires and what it changes; add a harder suite (ambiguous design decisions with expert-written rubrics); re-grade every arm with a non-Anthropic grader (`consensus bench regrade <dir> -g codex:gpt-5.6-sol`) and report inter-grader agreement; add a "one model, N samples, majority vote" arm at matched cost.

_How to reproduce:_ `consensus bench -P balanced,fast --baseline claude:claude-opus-5,codex:gpt-5.6-sol --trials 2 -g claude:claude-sonnet-5 --parallel`.
