#!/bin/sh
# End-to-end test of install.sh in clean Linux containers, against a locally served release.
#
#   node scripts/bundle.mjs && node scripts/package.mjs linux arm64 && node scripts/package.mjs sums
#   sh test/install/run-docker.sh            # or: --build to do the three steps above for docker's arch
#
# The release directory (default dist-release/) is copied into a python3 http.server container on a
# private docker network, and every test container installs with
#   CONSENSUS_DOWNLOAD_BASE=http://relsrv:8000  curl -fsSL http://relsrv:8000/install.sh | sh
# No bind mounts, so it also works with remote docker daemons (colima, docker contexts).
#
# Images and what they prove:
#   ubuntu:24.04          no node, no sudo; curl; bash user; root refused; piped install; idempotent
#                         re-run; fresh login shell finds `consensus`; tty hand-off starts setup;
#                         setup --yes; MCP server answers through the launcher
#   debian:bookworm-slim  no node; wget only (no curl); dash user shell (.profile); custom
#                         CONSENSUS_INSTALL_DIR that is only reachable through our PATH line
#   node:22-bookworm      a system Node exists and is left alone; fish conf.d
#   (ubuntu, unless SKIP_FALLBACK=1) the no-release fallback: private Node from nodejs.org + npm
#                         install of the repo tarball, which needs internet access
#
# Env: KEEP=1 keeps containers for debugging. SKIP_FALLBACK=1 skips the network-heavy npm fallback.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
repo=$(CDPATH= cd -- "$here/../.." && pwd -P)
REL="${RELEASE_DIR:-$repo/dist-release}"
NET="consensus-install-test-$$"
SRV="relsrv"
FAILS=0
PASSES=0
CONTAINERS=""

log() { printf '%s\n' "$*"; }
pass() { PASSES=$((PASSES + 1)); printf '  PASS  %s\n' "$*"; }
fail() { FAILS=$((FAILS + 1)); printf '  FAIL  %s\n' "$*"; }

docker_arch=$(docker info --format '{{.Architecture}}')
case "$docker_arch" in
  aarch64|arm64) ARCH=arm64 ;;
  x86_64|amd64) ARCH=x64 ;;
  *) log "unsupported docker architecture: $docker_arch"; exit 2 ;;
esac

if [ "${1:-}" = "--build" ]; then
  (cd "$repo" && node scripts/bundle.mjs && node scripts/package.mjs linux "$ARCH" && node scripts/package.mjs sums)
fi
[ -f "$REL/consensus-linux-$ARCH.tar.gz" ] && [ -f "$REL/SHA256SUMS" ] || {
  log "missing $REL/consensus-linux-$ARCH.tar.gz or SHA256SUMS; run with --build"
  exit 2
}

cleanup() {
  if [ "${KEEP:-}" != 1 ]; then
    for c in $CONTAINERS; do docker rm -f "$c" >/dev/null 2>&1 || true; done
    docker network rm "$NET" >/dev/null 2>&1 || true
  else
    log "kept containers:$CONTAINERS (network $NET)"
  fi
}
trap cleanup EXIT

docker network create "$NET" >/dev/null
srv_c="consensus-relsrv-$$"
CONTAINERS="$CONTAINERS $srv_c"
docker run -d --name "$srv_c" --network "$NET" --network-alias "$SRV" python:3.12-alpine \
  sh -c 'mkdir -p /srv && sleep 3600' >/dev/null
docker exec "$srv_c" mkdir -p /srv/rel
for f in "$REL/consensus-linux-$ARCH.tar.gz" "$REL/SHA256SUMS" "$repo/install.sh"; do
  docker cp "$f" "$srv_c:/srv/rel/" >/dev/null
done
docker exec -d "$srv_c" python3 -m http.server 8000 --directory /srv/rel
BASE="http://$SRV:8000"

# start <image>: sets STARTED to the container name (not via $(...), so CONTAINERS stays tracked)
start() {
  STARTED="consensus-it-$(printf '%s' "$1" | tr ':/.' '---')-$$"
  CONTAINERS="$CONTAINERS $STARTED"
  docker run -d --name "$STARTED" --network "$NET" -e DEBIAN_FRONTEND=noninteractive "$1" sleep 3600 >/dev/null
}
root() { c=$1; shift; docker exec "$c" sh -c "$*"; }
as_user() { c=$1; u=$2; shift 2; docker exec -u "$u" -w "/home/$u" -e HOME="/home/$u" "$c" sh -c "$*"; }
# check <description> <container> <user> <command>  (command runs as user; exit 0 = pass)
check() {
  desc=$1; c=$2; u=$3; shift 3
  if out=$(as_user "$c" "$u" "$*" 2>&1); then pass "$desc"; else fail "$desc"; printf '%s\n' "$out" | tail -n 25 | sed 's/^/        /'; fi
}
wait_server() {
  c=$1
  i=0
  until as_user "$c" "$2" "$3" >/dev/null 2>&1; do
    i=$((i + 1)); [ $i -gt 30 ] && { fail "release server reachable from $c"; return 1; }
    sleep 1
  done
}

CURL_INSTALL="curl -fsSL $BASE/install.sh | CONSENSUS_DOWNLOAD_BASE=$BASE sh"

# ------------------------------------------------------------------ ubuntu:24.04
log ""
log "== ubuntu:24.04 (no node, no sudo, curl, bash)"
start ubuntu:24.04; U=$STARTED
root "$U" 'apt-get update -qq >/dev/null && apt-get install -y -qq curl ca-certificates >/dev/null && useradd -m -s /bin/bash tester' >/dev/null
wait_server "$U" tester "curl -fsS $BASE/SHA256SUMS"
check "no node and no sudo in the image" "$U" tester '! command -v node && ! command -v sudo'
if out=$(docker exec "$U" sh -c "curl -fsSL $BASE/install.sh | CONSENSUS_DOWNLOAD_BASE=$BASE sh" 2>&1); then
  fail "root is refused"; printf '%s\n' "$out" | tail -5
else
  printf '%s' "$out" | grep -q -- "--allow-root" && pass "root is refused (with --allow-root hint)" || { fail "root refusal message"; printf '%s\n' "$out" | tail -5; }
fi
check "piped install (no tty) exits 0 and says how to finish" "$U" tester "$CURL_INSTALL > /tmp/out1 2>&1; s=\$?; cat /tmp/out1; [ \$s = 0 ] && grep -q 'consensus installer' /tmp/out1 && grep -q 'consensus setup' /tmp/out1 && grep -q 'installed in' /tmp/out1"
check "receipt, env file, current symlink, launcher link" "$U" tester 'test -f ~/.consensus/receipt.json && test -f ~/.consensus/env && test -L ~/.consensus/current && test -L ~/.local/bin/consensus && grep -q "\"kind\": \"standalone\"" ~/.consensus/receipt.json'
check "one guarded line in ~/.bashrc and ~/.profile" "$U" tester '[ "$(grep -c "# consensus" ~/.bashrc)" = 1 ] && [ "$(grep -c "# consensus" ~/.profile)" = 1 ]'
check "fresh login shell: consensus --version" "$U" tester "bash -lc 'consensus --version'"
check "fresh interactive bash: consensus --version" "$U" tester "bash -ic 'consensus --version' 2>/dev/null"
check "re-run is idempotent (no download, still one rc line)" "$U" tester "$CURL_INSTALL > /tmp/out2 2>&1; cat /tmp/out2; grep -q 'already current' /tmp/out2 && [ \"\$(grep -c '# consensus' ~/.bashrc)\" = 1 ] && [ \"\$(grep -c '# consensus' ~/.profile)\" = 1 ]"
check "tty hand-off execs consensus setup" "$U" tester "rm -rf ~/.config/consensus; curl -fsSL $BASE/install.sh -o /tmp/install.sh; CONSENSUS_DOWNLOAD_BASE=$BASE timeout 25 script -qec 'sh /tmp/install.sh' /dev/null < /dev/null > /tmp/out3 2>&1; cat /tmp/out3; grep -q 'Starting setup' /tmp/out3 && grep -q 'consensus setup' /tmp/out3"
check "install --yes runs setup --yes and ends with a summary" "$U" tester "CONSENSUS_DOWNLOAD_BASE=$BASE sh /tmp/install.sh --yes --no-first-run > /tmp/out4 2>&1; s=\$?; cat /tmp/out4; grep -q 'Telemetry' /tmp/out4"
check "upgrade path (config exists) runs doctor, not the wizard" "$U" tester "test -f ~/.config/consensus/config.json && CONSENSUS_DOWNLOAD_BASE=$BASE sh /tmp/install.sh > /tmp/out5 2>&1; cat /tmp/out5; grep -q 'Upgrade complete' /tmp/out5 && grep -q 'Accounts' /tmp/out5"
check "doctor reports the stable launcher as the MCP command" "$U" tester "bash -lc 'consensus doctor' 2>&1 | grep 'MCP launch command' | grep -q '/home/tester/.local/bin/consensus mcp'"
check "MCP server answers initialize through the launcher" "$U" tester "printf '%s\n' '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{},\"clientInfo\":{\"name\":\"t\",\"version\":\"0\"}}}' | timeout 20 ~/.local/bin/consensus mcp 2>/dev/null | head -n 1 | grep -q '\"serverInfo\"'"
check "consensus update re-runs the installer (already current)" "$U" tester "CONSENSUS_INSTALLER_URL=$BASE/install.sh CONSENSUS_DOWNLOAD_BASE=$BASE bash -lc 'consensus update' > /tmp/out6 2>&1; s=\$?; cat /tmp/out6; [ \$s = 0 ] && grep -q 'already current' /tmp/out6"
check "consensus uninstall --all removes the install and the rc lines" "$U" tester "bash -lc 'consensus uninstall --all' && test ! -e ~/.consensus/versions && test ! -e ~/.local/bin/consensus && ! grep -q '# consensus' ~/.bashrc ~/.profile"
if [ "${SKIP_FALLBACK:-}" != 1 ]; then
  check "no release published (404): private Node + npm fallback, no node on the box, works in a new login shell" "$U" tester "rm -rf ~/.config/consensus; CONSENSUS_DOWNLOAD_BASE=$BASE/no-release sh -c 'curl -fsSL $BASE/install.sh | sh -s -- --no-setup' > /tmp/fb 2>&1; s=\$?; tail -n 15 /tmp/fb; [ \$s = 0 ] && grep -q 'consensus installer' /tmp/fb && grep -q 'falling back' /tmp/fb && grep -q npm-fallback ~/.consensus/receipt.json && bash -lc 'consensus --version' && ! command -v node && ! command -v npm"
else
  log "  SKIP  npm fallback (SKIP_FALLBACK=1)"
fi

# ------------------------------------------------------------------ debian:bookworm-slim
log ""
log "== debian:bookworm-slim (no node, wget only, dash login shell, custom CONSENSUS_INSTALL_DIR)"
start debian:bookworm-slim; D=$STARTED
root "$D" 'apt-get update -qq >/dev/null && apt-get install -y -qq wget >/dev/null && useradd -m -s /bin/sh tester' >/dev/null
wait_server "$D" tester "wget -q -O /dev/null $BASE/SHA256SUMS"
check "no curl and no node in the image" "$D" tester '! command -v curl && ! command -v node'
check "wget | sh install with CONSENSUS_INSTALL_DIR" "$D" tester "wget -qO- $BASE/install.sh | CONSENSUS_DOWNLOAD_BASE=$BASE CONSENSUS_INSTALL_DIR=/home/tester/tools sh -s -- --no-setup"
check "link is in \$CONSENSUS_INSTALL_DIR/bin and ~/.profile has one line" "$D" tester 'test -L ~/tools/bin/consensus && [ "$(grep -c "# consensus" ~/.profile)" = 1 ]'
check "fresh dash login shell: consensus --version (only via our PATH line)" "$D" tester "env -i HOME=/home/tester PATH=/usr/bin:/bin sh -lc 'command -v consensus && consensus --version'"
check "fallback failure prints our own error and exit code (set -e never swallows it)" "$D" tester "CONSENSUS_DOWNLOAD_BASE=$BASE/missing CONSENSUS_NODE_DIST=$BASE/no-node sh -c 'wget -qO- $BASE/install.sh | sh -s -- --no-setup' > /tmp/o 2>&1; s=\$?; cat /tmp/o; [ \$s = 3 ] && grep -q 'falling back to a private Node' /tmp/o && grep -q 'error: could not download' /tmp/o"

# ------------------------------------------------------------------ node:22-bookworm
log ""
log "== node:22-bookworm (system node present, fish)"
start node:22-bookworm; N=$STARTED
root "$N" 'apt-get update -qq >/dev/null && apt-get install -y -qq fish >/dev/null; mkdir -p /home/node/.config/fish && chown -R node:node /home/node/.config' >/dev/null
wait_server "$N" node "curl -fsS $BASE/SHA256SUMS"
check "install next to a system node (fish login shell)" "$N" node "export SHELL=/usr/bin/fish; $CURL_INSTALL -s -- --no-setup"
check "system node is untouched and consensus uses the bundled one" "$N" node "[ \"\$(command -v node)\" = /usr/local/bin/node ] && readlink -f ~/.local/bin/consensus | grep -q '/.consensus/versions/'"
check "fish conf.d drop-in works in a fresh fish login shell" "$N" node "test -f ~/.config/fish/conf.d/consensus.fish && env -i HOME=/home/node PATH=/usr/bin:/bin fish -lc 'consensus --version'"
check "bash login shell also works" "$N" node "bash -lc 'consensus --version'"

log ""
log "passed: $PASSES  failed: $FAILS"
[ "$FAILS" = 0 ]
