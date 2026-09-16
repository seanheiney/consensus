#!/bin/sh
# consensus installer -- one line, no prerequisites:
#
#   curl -fsSL https://raw.githubusercontent.com/seanheiney/consensus/main/install.sh | sh
#
# Options come after `-s --`, e.g.:
#
#   curl -fsSL https://raw.githubusercontent.com/seanheiney/consensus/main/install.sh | sh -s -- --yes
#
# What it does, in order:
#   1. makes sure Node 22+ is on PATH (installs it only if it is missing)
#   2. installs the `consensus` CLI with npm (falling back to the repo tarball
#      while the npm package is unpublished)
#   3. runs `consensus setup`, which connects your AI subscriptions / API keys,
#      creates model profiles, installs the skill pack and MCP server into every
#      IDE and agent it finds, and runs a first debate
#
# It is safe to re-run: step 2 upgrades in place and step 3 is idempotent.
# Nothing here is run as root, and no file outside npm's global prefix and
# ~/.config/consensus is written by the installer itself.
#
# See docs/install.md in the repo for exactly what is written where.
set -eu

INSTALLER_VERSION="0.1.0"
PKG="consensus-panel"
MIN_NODE="${CONSENSUS_MIN_NODE:-22}"
# Fallback until the npm release: install straight from the repo tarball (no git needed).
REPO="${CONSENSUS_REPO:-https://github.com/seanheiney/consensus/archive/refs/heads/main.tar.gz}"
# Optional: install into your own prefix instead of npm's global one.
PREFIX="${CONSENSUS_INSTALL_DIR:-}"
YES=""
RUN_SETUP=1
SETUP_ARGS=""

usage() {
  cat <<EOF
consensus installer $INSTALLER_VERSION

Usage:
  curl -fsSL https://raw.githubusercontent.com/seanheiney/consensus/main/install.sh | sh
  curl -fsSL https://raw.githubusercontent.com/seanheiney/consensus/main/install.sh | sh -s -- [options]
  sh install.sh [options]

Options:
  -y, --yes          non-interactive: no questions during setup
      --no-setup     install the CLI only; do not run \`consensus setup\`
      --no-first-run passed to setup: skip the guided first debate
      --project      passed to setup: also write project files in this directory
      --probe        passed to setup: make one tiny live call per connection
  -h, --help         show this and exit
  -V, --version      print the installer version and exit

Any other option is passed through to \`consensus setup\`.

Environment:
  CONSENSUS_INSTALL_DIR   install prefix (binary lands in \$CONSENSUS_INSTALL_DIR/bin)
  CONSENSUS_REPO          tarball/spec to install instead of the npm package
  CONSENSUS_MIN_NODE      minimum Node major version (default: 22)
  CONSENSUS_SYSTEM_NODE   set to 1 to allow a sudo/apt Node install on Linux

Docs: https://github.com/seanheiney/consensus/blob/main/docs/install.md
EOF
}

# bash 3.2 (macOS /bin/sh) errors on "\$@" under `set -u` when there are no
# positional parameters, so expand it only when it is set.
for a in ${@+"$@"}; do
  case "$a" in
    -h|--help) usage; exit 0 ;;
    -V|--version) printf '%s\n' "consensus installer $INSTALLER_VERSION"; exit 0 ;;
    -y|--yes) YES="--yes" ;;
    --no-setup) RUN_SETUP=0 ;;
    *) SETUP_ARGS="$SETUP_ARGS $a" ;;   # e.g. --no-first-run, --project, --probe
  esac
done

say()  { printf '\033[1m%s\033[0m\n' "$*" >&2; }
info() { printf '  %s\n' "$*" >&2; }
die()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

say "consensus installer $INSTALLER_VERSION"
info "docs: https://github.com/seanheiney/consensus/blob/main/docs/install.md"

BEFORE=""
if have consensus; then
  BEFORE=$(consensus --version 2>/dev/null || echo "")
  [ -n "$BEFORE" ] && info "already installed: consensus $BEFORE (this run upgrades it in place)"
fi

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

LOG=$(mktemp)
try_install() {
  if [ -n "$PREFIX" ]; then
    npm install -g --prefix "$PREFIX" "$1" >"$LOG" 2>&1
  else
    npm install -g "$1" >"$LOG" 2>&1
  fi
}

if [ -n "$PREFIX" ]; then
  say "Installing $PKG into $PREFIX (CONSENSUS_INSTALL_DIR)..."
  mkdir -p "$PREFIX"
  export PATH="$PREFIX/bin:$PATH"
else
  say "Installing $PKG..."
fi

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
rm -f "$LOG"

have consensus || die "consensus was installed but is not on PATH. Add \"\$(npm prefix -g)/bin\" to PATH, open a new terminal, and run: consensus setup"
AFTER=$(consensus --version 2>/dev/null || echo "?")
if [ -n "$BEFORE" ] && [ "$BEFORE" = "$AFTER" ]; then
  info "consensus $AFTER (already current)"
elif [ -n "$BEFORE" ]; then
  info "consensus $BEFORE -> $AFTER"
else
  info "consensus $AFTER"
fi

if [ "$RUN_SETUP" = "0" ]; then
  say "Installed. Next step:"
  info "consensus setup      connect your subscriptions or keys, then ask the panel a question"
  exit 0
fi

say "Setting up..."
# When piped through `sh`, stdin is this script; give the wizard the terminal.
if [ -t 0 ]; then
  consensus setup $YES $SETUP_ARGS
elif [ -r /dev/tty ] && [ -z "$YES" ]; then
  consensus setup $SETUP_ARGS </dev/tty
else
  consensus setup --yes $SETUP_ARGS
fi

say "Done. Next step:"
info 'consensus "Should we use optimistic locking or a distributed lock for inventory holds?"'
info "consensus doctor     see what is connected;  consensus --help   see everything else"
