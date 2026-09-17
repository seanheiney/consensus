#!/bin/sh
# Cheap Groq teams with scoped angles vs frontier models answering alone.
# Plan and how to read the results: docs/bench/groq-vs-frontier.md
#
#   consensus connect groq          # once: key, and base URL if you use a Groq-backed gateway
#   consensus pack add ./packs/groq-teams.json
#   sh scripts/bench-groq-vs-frontier.sh [objective|judgment|all]
#
# Env: TRIALS_OBJECTIVE (3), TRIALS_JUDGMENT (2), HYBRID=1 adds the frontier-captain arm (spends Claude quota),
#      OUT (.consensus/bench/groq-vs-frontier), CONSENSUS (consensus binary).
set -eu
WHICH="${1:-all}"
C="${CONSENSUS:-consensus}"
OUT="${OUT:-.consensus/bench/groq-vs-frontier}"
TEAMS="groq-angles,groq-plain,groq-angles-small"
[ "${HYBRID:-0}" = 1 ] && TEAMS="$TEAMS,groq-angles-frontier-captain"
BASE="groq:openai/gpt-oss-120b,groq:openai/gpt-oss-20b,claude:claude-fable-5-1,claude:claude-opus-5,codex:gpt-5.6-sol"
SELF="groq:openai/gpt-oss-120bx5"

"$C" models groq >/dev/null || { echo "Groq is not reachable: run \`consensus connect groq\`" >&2; exit 1; }

run() { # suite trials dir
  if [ -f "$3/results.json" ]; then resume="--resume $3"; else resume="-o $3"; fi
  # shellcheck disable=SC2086
  "$C" bench run -P "$TEAMS" -b "$BASE" --self-consistency "$SELF" -s "$1" --trials "$2" \
    -g codex:gpt-5.6-sol --parallel --concurrency 2 $resume
  "$C" bench regrade "$3" -g claude:claude-sonnet-5 -s "$1"
}

case "$WHICH" in
  objective|all) run suites/reasoning.json "${TRIALS_OBJECTIVE:-3}" "$OUT/objective" ;;
esac
case "$WHICH" in
  judgment|all) run suites/judgment.json "${TRIALS_JUDGMENT:-2}" "$OUT/judgment" ;;
esac
echo "reports: $OUT/*/report.md and report-claude-claude-sonnet-5.md"
