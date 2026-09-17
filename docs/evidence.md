# Evidence: does the panel beat one model?

This page exists because the product's central claim deserves a measurement, not an assertion. It will be updated as runs accumulate; every table here links to the raw `results.json` and every run's full debate.

## Ablation 2 — 2026-09-16 (judgment suite, captain, revision on any dispute)

**Setup.** `suites/judgment.json`: 8 open design and operations decisions (payments idempotency, a zero-downtime primary-key migration, cache invalidation under a freshness bound, on-call alerting, session tokens, queue choice, multi-tenant rate limiting, search indexing), each with an expert-written rubric. Four arms: the `balanced` panel (Claude Opus 5 + GPT-5.6 Sol, 3 rounds, auto captain), Opus 5 answering once, Sol answering once, and **self-consistency** (Opus 5 answers three times, then merges its own best: more tokens, no debate). Every answer was graded blind, twice, by graders from different vendors: GPT-5.6 Sol and Claude Sonnet 5. Raw results: [`grader-sol`](evidence/ablation2-2026-09-16-grader-sol.json), [`grader-sonnet`](evidence/ablation2-2026-09-16-grader-sonnet.json).

**Caveats.** (1) n is small: 9 panel runs (8 cases, one case twice) against 16 per baseline; paired comparisons use the 9 matching case/trial pairs. Treat this as a directional result, not a benchmark. (2) The panel ran two trials on the first case only: a Claude subscription session limit interrupted the run, and it was resumed with one trial per case to limit quota. (3) The auto captain was Opus 5 in every run because Fable was out of quota. (4) Each grader shares a vendor with some arms; that is why both are reported.

| Arm | n | Quality (Sol grader) | Quality (Sonnet grader) | Accuracy vs rubric (Sol / Sonnet) | Avg time | Subscription equiv. per run |
|---|---:|---:|---:|---:|---:|---:|
| balanced panel | 9 | 8.4 | **8.7** | **9.6** / **9.0** | 1,555 s | ~$6.05 |
| self-consistency, Opus 5 ×3 | 16 | 8.3 | 8.3 | 9.1 / 8.9 | 166 s | ~$0.93 |
| single Opus 5 | 16 | 7.6 | 7.6 | 8.8 / 8.3 | 71 s | ~$0.18 |
| single GPT-5.6 Sol | 16 | 8.1 | 6.5 | 8.6 / 7.2 | 157 s | ~$0.27 |

Paired on the same case and trial (panel wins / ties / losses on quality):

| Panel vs | Sol grader | Sonnet grader |
|---|---:|---:|
| single Opus 5 | 7 / 0 / 2 | 8 / 0 / 1 |
| single GPT-5.6 Sol | 7 / 0 / 2 | 8 / 0 / 1 |
| self-consistency, Opus 5 ×3 | 3 / 3 / 3 | 7 / 1 / 1 |

**What this shows.** On judgment questions, unlike the easy suite in ablation 1, both graders prefer the debated answer to either single model on 7–8 of 9 cases, and both score it highest on rubric accuracy. Against a matched-effort control (the same model sampled three times and self-merged) the evidence is mixed: Sonnet prefers the panel 7–1–1, Sol calls it even. The debate ran every mechanism this time: in 9/9 runs a seat revised its answer and the captain moderated. The price is large: about 9× the wall time and 6× the quota of self-consistency, and about 22× the time of one answer.

**What it found wrong, and what changed.** Two protocol defects surfaced, both now fixed (commit `d4f4e37`), and neither fix is measured yet:
- *No debate converged.* Every critique round raised 8–16 fresh disputes instead of checking whether the earlier ones were resolved, so every run hit the round cap (about 26 minutes). Follow-up rounds now show each critic its own earlier disputes and the author's concede/rebut responses, allow only unresolved or new major disputes, and converge once no major dispute remains.
- *The one case both graders marked as a panel loss* (rate limiting) produced a 32,000-character report whose Answer section cited "A's script" and "B argues". The synthesis prompt now requires a standalone, proportionate Answer section, and a deterministic check rewrites the report once if it still references the debate.

**Live check of those fixes** (one `balanced` debate on the rate-limiting case, 2026-09-17, not graded): open disputes fell from 15 after round 1 to 2 after round 2, where before they stayed at 13–15 every round. The Answer section had no debate references and was shorter than the longest panelist's final answer (16,096 vs 19,525 characters). The same two major disputes survived rounds 2 and 3, so the run still took 26 minutes. The captain can now end a debate early in that situation (`stop_debate`) and report the disputes as unresolved; that change is not yet measured. The Fable captain hit its usage limit during this run and handed off to Opus 5, as designed.

_How to reproduce:_ `consensus bench -P balanced -s suites/judgment.json --baseline claude:claude-opus-5,codex:gpt-5.6-sol --self-consistency claude:claude-opus-5x3 -g codex:gpt-5.6-sol`, then `consensus bench regrade <dir> -g claude:claude-sonnet-5 -s suites/judgment.json`. Add `--resume <dir>` to continue an interrupted run.

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

### Same runs, re-graded by an OpenAI model

The first grader (Sonnet) shares a vendor with the Anthropic seats. Re-grading the identical 40 answers with `codex:gpt-5.6-sol` (`consensus bench regrade … -g codex:gpt-5.6-sol`; raw: [`ablation-2026-09-16-regrade-codex.json`](evidence/ablation-2026-09-16-regrade-codex.json)) flips the ranking:

| Arm | n | Accuracy /10 | Quality /10 |
|---|---:|---:|---:|
| single:claude:claude-opus-5 | 10 | 9.8 | 8.9 |
| single:codex:gpt-5.6-sol | 10 | 10.0 | 9.6 |
| balanced | 10 | 10.0 | 9.1 |
| fast | 10 | 9.4 | 8.6 |

**Read together:** each grader rates its own vendor's answers higher (the Anthropic grader preferred the Anthropic-heavy panel and the Opus baseline; the OpenAI grader preferred the Sol baseline). Across both graders the `balanced` panel ties or trails the best single model on accuracy and is within a point on quality, at roughly 7× the wall time. On this easy suite there is **no evidence that the panel beats the best single model**; there is evidence that grader self-preference is large enough to manufacture a "win" in either direction, which is why the bench now warns on grader/vendor overlap and why every claim on this page cites two graders. The protocol changes made after this ablation (revision on any dispute, captain moderation with referee rulings) have not been measured yet.

**Next measurements** (in priority order): re-run this suite under the new convergence rule and report how often revision fires and what it changes; add a harder suite (ambiguous design decisions with expert-written rubrics); re-grade every arm with a non-Anthropic grader (`consensus bench regrade <dir> -g codex:gpt-5.6-sol`) and report inter-grader agreement; add a "one model, N samples, majority vote" arm at matched cost.

_How to reproduce:_ `consensus bench -P balanced,fast --baseline claude:claude-opus-5,codex:gpt-5.6-sol --trials 2 -g claude:claude-sonnet-5 --parallel`.
