#!/bin/sh
# consensus installer — one line, no prerequisites:
#   curl -fsSL https://raw.githubusercontent.com/seanheiney/consensus/main/install.sh | sh
# Non-interactive:  curl -fsSL ... | sh -s -- --yes
#
# What it does: makes sure Node 22+ exists (installs it if not), installs the
# `consensus` CLI, then runs `consensus setup`, which connects your AI
# subscriptions / API keys, creates model profiles, installs the skill pack and
# MCP server into every IDE and agent it finds, and runs a first debate.
set -eu

PKG="consensus-panel"
MIN_NODE="${CONSENSUS_MIN_NODE:-22}"
YES=""
SETUP_ARGS=""
for a in "$@"; do
  case "$a" in
    --yes|-y) YES="--yes" ;;
    *) SETUP_ARGS="$SETUP_ARGS $a" ;;   # e.g. --no-first-run, --project, --probe are passed through to `consensus setup`
  esac
done

say()  { printf '\033[1m%s\033[0m\n' "$*" >&2; }
info() { printf '  %s\n' "$*" >&2; }
die()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

node_ok() {
  have node || return 1
  major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  [ "$major" -ge "$MIN_NODE" ]
}

install_node() {
  say "Node.js $MIN_NODE+ is required. Installing..."
  OS=$(uname -s)
  if [ "$OS" = "Darwin" ] && have brew; then
    info "using Homebrew"; brew install node && return 0
  fi
  if have fnm; then
    info "using fnm"; fnm install --lts && fnm use lts-latest && return 0
  fi
  if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
    info "using nvm"; . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" && nvm install --lts && nvm use --lts && return 0
  fi
  # Prefer a user-local install that needs no sudo (fnm); system package managers are opt-in.
  if [ "${CONSENSUS_SYSTEM_NODE:-}" = "1" ] && [ "$OS" = "Linux" ] && have apt-get && have sudo; then
    info "using NodeSource (apt) because CONSENSUS_SYSTEM_NODE=1"; curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs && return 0
  fi
  info "using fnm installer (user-local, no sudo; set CONSENSUS_SYSTEM_NODE=1 to use apt instead)"
  curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell
  export PATH="$HOME/.local/share/fnm:$HOME/.fnm:$PATH"
  if have fnm; then eval "$(fnm env)"; fnm install --lts && fnm use lts-latest && return 0; fi
  die "could not install Node automatically. Install Node $MIN_NODE+ from https://nodejs.org and re-run."
}

node_ok || install_node
node_ok || die "Node $MIN_NODE+ still not on PATH. Open a new terminal and re-run, or install from https://nodejs.org"
info "node $(node -v), npm $(npm -v)"

# Fallback until the npm release: install straight from the repo tarball (no git needed).
# Pin a release with CONSENSUS_VERSION=v0.1.0 (a git tag); default is main.
REF="${CONSENSUS_VERSION:+refs/tags/$CONSENSUS_VERSION}"; REF="${REF:-refs/heads/main}"
REPO="${CONSENSUS_REPO:-https://github.com/seanheiney/consensus/archive/$REF.tar.gz}"
say "Installing ${PKG}..."
LOG=$(mktemp)
try_install() { npm install -g "$1" >"$LOG" 2>&1; }
if ! try_install "$PKG"; then
  if grep -qiE "E404|404 Not Found" "$LOG"; then
    info "$PKG is not on npm yet; installing from $REPO"
    try_install "$REPO" || { cat "$LOG" >&2; die "install from $REPO failed (see output above)"; }
  elif grep -qiE "EACCES|permission denied" "$LOG"; then
    # Global dir not writable: switch to a user-local prefix rather than sudo.
    PREFIX="$HOME/.npm-global"
    info "npm global dir not writable; using $PREFIX"
    mkdir -p "$PREFIX" && npm config set prefix "$PREFIX"
    export PATH="$PREFIX/bin:$PATH"
    try_install "$PKG" || try_install "$REPO" || { cat "$LOG" >&2; die "npm install failed (see output above)"; }
    for rc in "$HOME/.zshrc" "$HOME/.bashrc"; do
      if [ -f "$rc" ] && ! grep -q 'npm-global/bin' "$rc"; then printf '\nexport PATH="%s/bin:$PATH"\n' "$PREFIX" >> "$rc"; fi
    done
    info "added $PREFIX/bin to your shell PATH (open a new terminal later)"
  else
    cat "$LOG" >&2; die "npm install -g $PKG failed (see output above)"
  fi
fi
have consensus || die "consensus is installed but not on PATH; run: npm bin -g"
info "consensus $(consensus --version)"

say "Setting up..."
# When piped through `sh`, stdin is this script; give the wizard the terminal.
if [ -t 0 ]; then
  consensus setup $YES $SETUP_ARGS
elif [ -r /dev/tty ] && [ -z "$YES" ]; then
  consensus setup $SETUP_ARGS </dev/tty
else
  consensus setup --yes $SETUP_ARGS
fi
