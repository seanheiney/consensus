#!/bin/sh
# consensus installer -- one line, no prerequisites (no Node, no npm, no sudo):
#
#   curl -fsSL https://raw.githubusercontent.com/seanheiney/consensus/main/install.sh | sh
#
# Options come after `-s --`, e.g.:
#
#   curl -fsSL https://raw.githubusercontent.com/seanheiney/consensus/main/install.sh | sh -s -- --yes
#
# What it does, in order:
#   1. detects your platform (macOS / Linux, arm64 / x64, Rosetta-aware)
#   2. downloads consensus-<os>-<arch>.tar.gz from the GitHub Release; it contains
#      the official Node 22 runtime plus the bundled CLI, so your own Node (if any)
#      is never used or touched
#   3. verifies it against the release's SHA256SUMS
#   4. unpacks it to ~/.consensus/versions/<version> and points ~/.consensus/current at it
#   5. links ~/.local/bin/consensus, and adds one marked line to your shell rc files
#      so new terminals find it
#   6. starts `consensus setup` (fresh install) or `consensus doctor` (upgrade)
#
# Safe to re-run: same version = nothing downloaded, links and PATH repaired.
# Never runs as root. Writes only under ~/.consensus, ~/.local/bin and the rc files
# it lists. No telemetry. Every file is listed in ~/.consensus/receipt.json.
#
# While no release has been published yet (and on musl libc), it falls back to a private
# official Node 22 under ~/.consensus plus `npm install --prefix` of consensus next to it;
# your own Node, global npm prefix and npm config are never touched.
#
# See docs/install.md in the repo for exactly what is written where.
#
# Intentional: literal $HOME / ~ in files and messages (SC2016, SC2088), sourcing
# files that only exist at runtime (SC1091), `a && b || c` where b cannot fail (SC2015).
# shellcheck disable=SC2016,SC2088,SC1091,SC2015,SC2012
set -eu

INSTALLER_VERSION="0.2.0"
REPO_URL="https://github.com/seanheiney/consensus"
PKG="consensus-panel"

usage() {
  cat <<EOF
consensus installer $INSTALLER_VERSION

Usage:
  curl -fsSL https://raw.githubusercontent.com/seanheiney/consensus/main/install.sh | sh
  curl -fsSL https://raw.githubusercontent.com/seanheiney/consensus/main/install.sh | sh -s -- [options] [version]
  sh install.sh [options] [version]

Options:
  -y, --yes             non-interactive: run \`consensus setup --yes\` (no questions)
      --no-setup        install only; do not start \`consensus setup\`
      --no-first-run    passed to setup: skip the guided first debate
      --project         passed to setup: also write project files in this directory
      --probe           passed to setup: make one tiny live call per connection
      --version <ver>   install this release (e.g. 0.2.0 or v0.2.0); default: latest
      --dir <path>      put the \`consensus\` link in <path>/bin instead of ~/.local/bin
      --no-modify-path  do not edit shell rc files
      --allow-root      allow running as root (not recommended; everything lands in root's home)
      --dry-run         print what would happen and exit
  -h, --help            show this and exit
  -V                    print the installer version and exit

A bare version (\`sh -s -- 0.2.0\`, \`latest\`) works too. Any other option is passed
through to \`consensus setup\`.

Environment:
  CONSENSUS_VERSION         release to install (e.g. v0.2.0); default: latest
  CONSENSUS_INSTALL_DIR     same as --dir (link lands in \$CONSENSUS_INSTALL_DIR/bin)
  CONSENSUS_ROOT            where versions live (default: ~/.consensus)
  CONSENSUS_DOWNLOAD_BASE   mirror: fetch <base>/SHA256SUMS and <base>/consensus-<os>-<arch>.tar.gz
  CONSENSUS_NO_MODIFY_PATH  set to 1 for --no-modify-path
  CONSENSUS_YES             set to 1 for --yes
  CONSENSUS_NO_SETUP        set to 1 for --no-setup
  NO_COLOR                  plain output

Fallback while no GitHub Release exists (private Node + npm, still no sudo):
  CONSENSUS_NODE_DIST       Node download mirror (default: https://nodejs.org/dist)
  CONSENSUS_REPO            tarball/spec to install instead of the npm package
  CONSENSUS_SHA256          verify the source tarball checksum before installing it

Exit codes: 0 ok, 1 error, 2 unsupported platform, 3 network, 4 checksum mismatch.
Docs: $REPO_URL/blob/main/docs/install.md
EOF
}

# ---------------------------------------------------------------- arguments
YES=""
[ "${CONSENSUS_YES:-}" = "1" ] && YES="--yes"
RUN_SETUP=1
[ "${CONSENSUS_NO_SETUP:-}" = "1" ] && RUN_SETUP=0
MODIFY_PATH=1
[ "${CONSENSUS_NO_MODIFY_PATH:-}" = "1" ] && MODIFY_PATH=0
ALLOW_ROOT=0
DRY_RUN=0
REQ_VERSION="${CONSENSUS_VERSION:-latest}"
INSTALL_DIR="${CONSENSUS_INSTALL_DIR:-}"
SETUP_ARGS=""

# bash 3.2 (macOS /bin/sh) and `set -u`: never expand "$@" when it may be empty;
# a while/shift loop over $# is safe everywhere.
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    -V) printf '%s\n' "consensus installer $INSTALLER_VERSION"; exit 0 ;;
    --version)
      case "${2:-}" in
        latest|stable|v[0-9]*|[0-9]*) REQ_VERSION="$2"; shift ;;
        *) printf '%s\n' "consensus installer $INSTALLER_VERSION"; exit 0 ;;
      esac ;;
    --version=*) REQ_VERSION="${1#--version=}" ;;
    -y|--yes) YES="--yes" ;;
    --no-setup) RUN_SETUP=0 ;;
    --no-modify-path) MODIFY_PATH=0 ;;
    --allow-root) ALLOW_ROOT=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --dir) [ $# -ge 2 ] || { echo "--dir needs a path" >&2; exit 1; }; INSTALL_DIR="$2"; shift ;;
    --dir=*) INSTALL_DIR="${1#--dir=}" ;;
    latest|stable|v[0-9]*.[0-9]*|[0-9]*.[0-9]*.[0-9]*) REQ_VERSION="$1" ;;
    *) SETUP_ARGS="$SETUP_ARGS $1" ;;   # e.g. --no-first-run, --project, --probe
  esac
  shift
done
[ "$REQ_VERSION" = "stable" ] && REQ_VERSION="latest"
case "$REQ_VERSION" in latest|v*) ;; *) REQ_VERSION="v$REQ_VERSION" ;; esac

# ---------------------------------------------------------------- output
if [ -t 2 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-}" != "dumb" ]; then
  B=$(printf '\033[1m'); D=$(printf '\033[2m'); R=$(printf '\033[31m'); Y=$(printf '\033[33m'); GR=$(printf '\033[32m'); N=$(printf '\033[0m')
else
  B=""; D=""; R=""; Y=""; GR=""; N=""
fi
say()  { printf '%s%s%s\n' "$B" "$*" "$N" >&2; }
info() { printf '  %s\n' "$*" >&2; }
warn() { printf '  %swarning:%s %s\n' "$Y" "$N" "$*" >&2; }
STEP_NAME=""
STEP_TOTAL=5
step() { STEP_NAME="$2"; printf '  %s[%s/%s]%s %-14s %s\n' "$D" "$1" "$STEP_TOTAL" "$N" "$2" "$3" >&2; }
detail() { printf '  %-20s %s\n' "" "$*" >&2; }
FAILED_MSG_SHOWN=0
die() {
  code="${2:-1}"
  printf '%serror:%s %s\n' "$R" "$N" "$1" >&2
  FAILED_MSG_SHOWN=1
  exit "$code"
}
have() { command -v "$1" >/dev/null 2>&1; }
now() { date +%s 2>/dev/null || echo 0; }
T0=$(now)
elapsed() { echo "$(( $(now) - T0 ))s"; }
# ~/ for display
tilde() { case "$1" in "$HOME"/*) printf '~/%s' "${1#"$HOME"/}" ;; *) printf '%s' "$1" ;; esac; }
# $HOME-relative for files we write (dotfiles stay portable)
homevar() { case "$1" in "$HOME"/*) printf '$HOME/%s' "${1#"$HOME"/}" ;; *) printf '%s' "$1" ;; esac; }
json_str() { printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"; }

TMP_DIR=""
cleanup() {
  status=$?
  [ -n "$TMP_DIR" ] && rm -rf "$TMP_DIR"
  if [ "$status" -ne 0 ] && [ "$FAILED_MSG_SHOWN" = 0 ] && [ "$status" -ne 130 ]; then
    printf '%serror:%s install failed%s (exit %s).\n' "$R" "$N" "${STEP_NAME:+ during: $STEP_NAME}" "$status" >&2
  fi
  if [ "$status" -ne 0 ] && [ "$status" -ne 130 ]; then
    [ -n "${LOG_FILE:-}" ] && [ -s "$LOG_FILE" ] && printf '  log: %s\n' "$LOG_FILE" >&2
    printf '  manual install: download consensus-<os>-<arch>.tar.gz from %s/releases, extract anywhere, run consensus/bin/consensus setup\n' "$REPO_URL" >&2
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

say "consensus installer $INSTALLER_VERSION"

# ---------------------------------------------------------------- root / sudo
if [ "$(id -u 2>/dev/null || echo 1)" = "0" ] && [ "$ALLOW_ROOT" != 1 ]; then
  if [ -n "${SUDO_USER:-}" ]; then
    die "do not run this installer with sudo. It installs into your home directory and needs no admin rights. Re-run without sudo." 1
  fi
  die "refusing to install as root (it would land in $HOME and root's PATH). Run as your normal user, or pass --allow-root if this really is a root-only box (e.g. a container)." 1
fi

# ---------------------------------------------------------------- locations
ROOT="${CONSENSUS_ROOT:-$HOME/.consensus}"
if [ -n "$INSTALL_DIR" ]; then BIN_DIR="$INSTALL_DIR/bin"; else BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"; fi
CFG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/consensus"
LOG_FILE=""


# ================================================================ fallback: private Node + npm
# Used only when there is no release archive to download: no GitHub Release published yet (404),
# a release without this platform, or musl libc. It never uses your Node (except on musl, where
# the official build cannot run), never runs `npm install -g` into a system prefix and never
# changes your npm config: it downloads the official Node 22 into the new version directory,
# npm-installs consensus into a prefix next to it, and writes the same launcher as a release
# archive has. Everything after that (link, PATH, receipt, hand-off) is shared.
NODE_DIST="${CONSENSUS_NODE_DIST:-https://nodejs.org/dist}"
NODE_DIST="${NODE_DIST%/}"

# npm_run <args...>: the staged (or, on musl, the system) npm with its node first on PATH
npm_run() {
  if [ -n "$SYSTEM_NODE" ]; then
    env PATH="$(dirname "$SYSTEM_NODE"):$PATH" npm "$@"
  else
    env PATH="$STAGE/node/bin:$PATH" "$STAGE/node/bin/node" "$STAGE/node/lib/node_modules/npm/bin/npm-cli.js" "$@"
  fi
}

# npm_install <spec>: install into $STAGE/npm, output to the log; a dot every 5s on a tty
npm_install() {
  : >"$TMP_DIR/npm.log"
  ticker=""
  if [ -t 2 ]; then
    ( while :; do sleep 5; printf '.' >&2; done ) &
    ticker=$!
  fi
  n_status=0
  npm_run install -g --prefix "$STAGE/npm" --no-fund --no-audit --loglevel=error "$1" >"$TMP_DIR/npm.log" 2>&1 || n_status=$?
  if [ -n "$ticker" ]; then kill "$ticker" 2>/dev/null || true; wait "$ticker" 2>/dev/null || true; printf '\n' >&2; fi
  cat "$TMP_DIR/npm.log" >>"$LOG_FILE"
  return "$n_status"
}

fallback_stage() {
  STAGE="$TMP_DIR/x/consensus"
  mkdir -p "$STAGE/bin" || die "cannot create $STAGE" 1
  if [ -n "$SYSTEM_NODE" ]; then
    NODE_VERSION=$("$SYSTEM_NODE" -p 'process.versions.node' 2>/dev/null || echo "?")
    step 2 Runtime "your Node $NODE_VERSION ($SYSTEM_NODE), because the official Node build needs glibc"
    step 3 Verifying "skipped (system Node)"
    have npm || die "npm is missing next to $SYSTEM_NODE. Install it (e.g. apk add npm) and re-run." 1
  else
    STEP_NAME="download Node"
    SUMS_URL="$NODE_DIST/latest-v22.x/SHASUMS256.txt"
    rc=0; fetch "$SUMS_URL" "$TMP_DIR/NODESUMS" || rc=$?
    [ "$rc" = 0 ] || die "could not download $SUMS_URL. Check your connection or proxy (HTTPS_PROXY) and re-run." 3
    NODE_TGZ=$(awk -v s="-$PLATFORM.tar.gz" '{ n = $2; if (index(n, "node-v22.") == 1 && substr(n, length(n) - length(s) + 1) == s) print n }' "$TMP_DIR/NODESUMS" | head -n 1)
    [ -n "$NODE_TGZ" ] || die "nodejs.org has no Node 22 build for $PLATFORM" 2
    NODE_SHA=$(awk -v f="$NODE_TGZ" '$2 == f { print $1 }' "$TMP_DIR/NODESUMS" | head -n 1)
    NODE_VERSION=${NODE_TGZ#node-v}
    NODE_VERSION=${NODE_VERSION%-"$PLATFORM".tar.gz}
    step 2 Downloading "Node $NODE_VERSION runtime from nodejs.org (a private copy; your own Node is untouched)"
    rc=0; fetch "$NODE_DIST/latest-v22.x/$NODE_TGZ" "$TMP_DIR/$NODE_TGZ" progress || rc=$?
    [ "$rc" = 0 ] || die "could not download $NODE_DIST/latest-v22.x/$NODE_TGZ. Check your connection or proxy and re-run." 3
    STEP_NAME="verify Node checksum"
    [ -n "$SHA_TOOL" ] || die "no sha256 tool found (sha256sum, shasum or openssl) to verify the download" 4
    ACTUAL=$(sha256_of "$TMP_DIR/$NODE_TGZ")
    if [ -z "$NODE_SHA" ] || [ "$ACTUAL" != "$NODE_SHA" ]; then
      rm -f "$TMP_DIR/$NODE_TGZ"
      die "checksum verification failed for $NODE_TGZ: expected ${NODE_SHA:-?}, got $ACTUAL. The download was deleted. Re-run." 4
    fi
    step 3 Verifying "sha256 ok (nodejs.org SHASUMS256.txt)"
    STEP_NAME="unpack Node"
    tar -xzf "$TMP_DIR/$NODE_TGZ" -C "$TMP_DIR" >>"$LOG_FILE" 2>&1 || die "could not unpack $NODE_TGZ (see $LOG_FILE)" 1
    mv "$TMP_DIR/${NODE_TGZ%.tar.gz}" "$STAGE/node" || die "could not stage the Node runtime" 1
    rm -f "$TMP_DIR/$NODE_TGZ"
  fi

  STEP_NAME="npm install"
  if [ "$REQ_VERSION" = latest ]; then
    REG_SPEC="$PKG@latest"; TAR_REF="refs/heads/main"
  else
    REG_SPEC="$PKG@${REQ_VERSION#v}"; TAR_REF="refs/tags/$REQ_VERSION"
  fi
  TARBALL_URL="${CONSENSUS_REPO:-$REPO_URL/archive/$TAR_REF.tar.gz}"
  step 4 Installing "consensus with npm into $(tilde "$ROOT") (takes about a minute)"
  SOURCE=""
  if [ -z "${CONSENSUS_REPO:-}" ] && [ -z "${CONSENSUS_SHA256:-}" ] && npm_install "$REG_SPEC"; then
    SOURCE="npm:$REG_SPEC"
  else
    if [ -z "${CONSENSUS_REPO:-}" ] && [ -z "${CONSENSUS_SHA256:-}" ]; then
      grep -qiE "E404|ETARGET|404 Not Found|No matching version" "$TMP_DIR/npm.log" || {
        tail -n 20 "$TMP_DIR/npm.log" >&2
        die "npm install $REG_SPEC failed (full log: $LOG_FILE)" 3
      }
      detail "$PKG is not on the npm registry yet; installing from $TARBALL_URL"
    fi
    SPEC="$TARBALL_URL"
    if [ -n "${CONSENSUS_SHA256:-}" ]; then
      rc=0; fetch "$TARBALL_URL" "$TMP_DIR/source.tar.gz" || rc=$?
      [ "$rc" = 0 ] || die "could not download $TARBALL_URL" 3
      ACTUAL=$(sha256_of "$TMP_DIR/source.tar.gz")
      [ "$ACTUAL" = "$CONSENSUS_SHA256" ] || die "checksum mismatch for $TARBALL_URL: expected $CONSENSUS_SHA256, got $ACTUAL" 4
      detail "source tarball sha256 ok (CONSENSUS_SHA256)"
      SPEC="$TMP_DIR/source.tar.gz"
    fi
    npm_install "$SPEC" || {
      tail -n 20 "$TMP_DIR/npm.log" >&2
      die "npm install of $TARBALL_URL failed (full log: $LOG_FILE)" 3
    }
    SOURCE="$TARBALL_URL"
  fi

  APP_DIR="$STAGE/npm/lib/node_modules/$PKG"
  [ -f "$APP_DIR/dist/cli.js" ] || die "npm finished but $APP_DIR/dist/cli.js is missing (see $LOG_FILE)" 1
  NODE_FOR_VERSION="${SYSTEM_NODE:-$STAGE/node/bin/node}"
  NEW_VERSION=$("$NODE_FOR_VERSION" -p 'require(process.argv[1]).version' "$APP_DIR/package.json" 2>>"$LOG_FILE") || die "could not read the installed version (see $LOG_FILE)" 1
  printf '%s\n' "$NEW_VERSION" >"$STAGE/VERSION"
  {
    echo '#!/bin/sh'
    echo '# consensus launcher (installer fallback: private Node + npm). Relocatable; follows symlinks.'
    echo 'self=$0'
    echo 'while [ -h "$self" ]; do'
    echo '  link=$(readlink "$self")'
    echo '  case $link in'
    echo '    /*) self=$link ;;'
    echo '    *) self=$(dirname -- "$self")/$link ;;'
    echo '  esac'
    echo 'done'
    echo 'here=$(CDPATH= cd -- "$(dirname -- "$self")/.." && pwd -P)'
    echo 'CONSENSUS_HOME=$here'
    echo 'export CONSENSUS_HOME'
    if [ -n "$SYSTEM_NODE" ]; then
      printf 'exec "%s" --no-warnings=ExperimentalWarning "$here/npm/lib/node_modules/%s/dist/cli.js" "$@"\n' "$SYSTEM_NODE" "$PKG"
    else
      printf 'exec "$here/node/bin/node" --no-warnings=ExperimentalWarning "$here/npm/lib/node_modules/%s/dist/cli.js" "$@"\n' "$PKG"
    fi
  } >"$STAGE/bin/consensus" || die "could not write the launcher" 1
  chmod 755 "$STAGE/bin/consensus" || die "could not make the launcher executable" 1
}

# ================================================================ release install
# ================================================================ standalone install
# ---------------------------------------------------------------- 1. platform
detect_platform() {
  os_raw=$(uname -s)
  arch_raw=$(uname -m)
  case "$os_raw" in
    Darwin) OS=darwin ;;
    Linux) OS=linux ;;
    MINGW*|MSYS*|CYGWIN*) die "this is the macOS/Linux installer. On Windows use PowerShell:  irm https://raw.githubusercontent.com/seanheiney/consensus/main/install.ps1 | iex" 2 ;;
    *) die "unsupported OS: $os_raw (supported: macOS, Linux, Windows via install.ps1)" 2 ;;
  esac
  case "$arch_raw" in
    x86_64|amd64) ARCH=x64 ;;
    arm64|aarch64) ARCH=arm64 ;;
    *) die "unsupported CPU architecture: $arch_raw (supported: x64, arm64)" 2 ;;
  esac
  ARCH_NOTE=""
  if [ "$OS" = darwin ]; then
    if [ "$ARCH" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then
      ARCH=arm64; ARCH_NOTE=" (Apple Silicon; this shell runs under Rosetta)"
    elif [ "$ARCH" = arm64 ]; then
      ARCH_NOTE=" (Apple Silicon)"
    fi
    OS_LABEL="macOS $(sw_vers -productVersion 2>/dev/null || echo)"
  else
    OS_LABEL="Linux"
    if [ -r /etc/os-release ]; then
      OS_LABEL=$(. /etc/os-release 2>/dev/null; printf '%s' "${PRETTY_NAME:-Linux}")
    fi
    if [ -f /etc/alpine-release ] || { have ldd && ldd --version 2>&1 | grep -qi musl; }; then
      MUSL=1
    fi
  fi
  PLATFORM="$OS-$ARCH"
}

MUSL=0
detect_platform

# ---------------------------------------------------------------- downloader
DL=""
if have curl; then DL=curl
elif have wget; then DL=wget
fi
WGET_PROGRESS=""
if [ "$DL" = wget ] && wget --help 2>&1 | grep -q -- '--show-progress'; then WGET_PROGRESS=1; fi

# fetch <url> <out> [progress]  -> 0 ok, 44 not found (404), 3 other network failure
fetch() {
  f_url="$1"; f_out="$2"; f_progress="${3:-}"
  case "$DL" in
    curl)
      if [ -n "$f_progress" ] && [ -t 2 ]; then f_flags="--progress-bar"; else f_flags="-sS"; fi
      case "$f_url" in https://*) f_proto="--proto =https --tlsv1.2" ;; *) f_proto="" ;; esac
      # The progress bar goes straight to our stderr. (Never `2>/dev/stderr`: on Linux that
      # re-opens a redirected log file with O_TRUNC and wipes everything printed so far.)
      if [ -n "$f_progress" ]; then
        # shellcheck disable=SC2086
        f_code=$(curl -fL $f_flags $f_proto --retry 3 --retry-delay 1 --connect-timeout 20 -w '%{http_code}' -o "$f_out" "$f_url") && return 0
      else
        # shellcheck disable=SC2086
        f_code=$(curl -fL $f_flags $f_proto --retry 3 --retry-delay 1 --connect-timeout 20 -w '%{http_code}' -o "$f_out" "$f_url" 2>"$f_out.err") && { rm -f "$f_out.err"; return 0; }
      fi
      rm -f "$f_out"
      [ "$f_code" = "404" ] && { rm -f "$f_out.err"; return 44; }
      [ -f "$f_out.err" ] && { cat "$f_out.err" >&2; rm -f "$f_out.err"; }
      return 3 ;;
    wget)
      if [ -n "$f_progress" ] && [ -t 2 ] && [ -n "$WGET_PROGRESS" ]; then f_flags="-q --show-progress"; else f_flags="-q"; fi
      # shellcheck disable=SC2086
      wget $f_flags --tries=3 --timeout=30 -O "$f_out" "$f_url" && return 0
      rm -f "$f_out"
      # tell "not published" (404) apart from a network failure
      if wget -S --spider --tries=1 --timeout=30 "$f_url" 2>&1 | grep -q 'HTTP/[0-9.]* 404'; then return 44; fi
      return 3 ;;
    *) die "neither curl nor wget is installed. Install one (e.g. apt-get install curl, apk add curl) and re-run." 3 ;;
  esac
}

sha256_of() {
  if [ -z "$SHA_TOOL" ]; then return 1
  elif have sha256sum; then sha256sum "$1" | cut -d' ' -f1
  elif have shasum; then shasum -a 256 "$1" | cut -d' ' -f1
  elif have openssl; then openssl dgst -sha256 "$1" | sed 's/.*= *//'
  fi
}
SHA_TOOL=""
for t in sha256sum shasum openssl; do have "$t" && { SHA_TOOL=$t; break; }; done

ASSET="consensus-$PLATFORM.tar.gz"
if [ -n "${CONSENSUS_DOWNLOAD_BASE:-}" ]; then
  BASE="${CONSENSUS_DOWNLOAD_BASE%/}"
elif [ "$REQ_VERSION" = latest ]; then
  BASE="$REPO_URL/releases/latest/download"
else
  BASE="$REPO_URL/releases/download/$REQ_VERSION"
fi

HAD_CONFIG=0
[ -f "$CFG_DIR/config.json" ] && HAD_CONFIG=1

if [ "$DRY_RUN" = 1 ]; then
  info "platform:  $OS_LABEL, $PLATFORM$ARCH_NOTE"
  info "download:  $BASE/$ASSET (verified against $BASE/SHA256SUMS)"
  info "install:   $ROOT/versions/<version>, $ROOT/current"
  info "link:      $BIN_DIR/consensus"
  info "PATH:      $([ "$MODIFY_PATH" = 1 ] && echo "one marked line in your shell rc files" || echo "not modified")"
  info "then:      $([ "$RUN_SETUP" = 0 ] && echo "nothing (--no-setup)" || { [ "$HAD_CONFIG" = 1 ] && echo "consensus doctor (upgrade)" || echo "consensus setup$YES$SETUP_ARGS"; })"
  exit 0
fi


MODE=release
SYSTEM_NODE=""
if [ "$MUSL" = 1 ]; then
  if have node && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 22 ] 2>/dev/null; then
    SYSTEM_NODE=$(node -p 'process.execPath')
    warn "musl libc (e.g. Alpine) detected: official Node builds need glibc, so consensus will run on your Node $(node -v)"
    MODE=fallback
  else
    die "musl libc (e.g. Alpine) detected. The standalone build needs glibc. Install Node 22+ (apk add nodejs npm) and re-run this installer; it will use that Node." 2
  fi
fi

step 1 Platform "$OS_LABEL, $PLATFORM$ARCH_NOTE"

STEP_NAME="prepare $ROOT"
[ -n "$DL" ] || die "neither curl nor wget is installed. Install one (e.g. apt-get install curl) and re-run." 3
mkdir -p "$ROOT" 2>/dev/null || die "cannot create $ROOT (check permissions on $(dirname "$ROOT"))" 1
[ -w "$ROOT" ] || die "$ROOT is not writable by $(id -un 2>/dev/null || echo you). If an earlier sudo run created it: sudo chown -R \"\$(id -un)\" \"$ROOT\"" 1
LOG_FILE="$ROOT/install.log"
: >"$LOG_FILE" || die "cannot write $LOG_FILE" 1
TMP_DIR=$(mktemp -d "$ROOT/.install.XXXXXX") || die "cannot create a temporary directory in $ROOT" 1

EXPECTED=""
if [ "$MODE" = release ]; then
  STEP_NAME="download SHA256SUMS"
  rc=0; fetch "$BASE/SHA256SUMS" "$TMP_DIR/SHA256SUMS" || rc=$?
  if [ "$rc" = 44 ]; then
    if [ "$REQ_VERSION" = latest ] && [ -z "${CONSENSUS_DOWNLOAD_BASE:-}" ]; then
      warn "no consensus release is published yet; falling back to a private Node + npm install"
    else
      warn "no release archives at $BASE; falling back to a private Node + npm install"
    fi
    MODE=fallback
  elif [ "$rc" != 0 ]; then
    die "could not download $BASE/SHA256SUMS (network error). Check your connection or proxy (HTTPS_PROXY) and re-run." 3
  else
    EXPECTED=$(awk -v f="$ASSET" '$2 == f || $2 == "*" f { print $1 }' "$TMP_DIR/SHA256SUMS" | head -n 1)
    if [ -z "$EXPECTED" ]; then
      warn "the release has no build for $PLATFORM; falling back to a private Node + npm install"
      MODE=fallback
    fi
  fi
fi

# ---------------------------------------------------------------- previous install
PREV_VERSION=""
PREV_SHA=""
PREV_RECEIPT=0
if [ -f "$ROOT/receipt.json" ]; then
  PREV_RECEIPT=1
  PREV_VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/receipt.json" | head -n 1)
  PREV_SHA=$(sed -n 's/.*"sha256": *"\([^"]*\)".*/\1/p' "$ROOT/receipt.json" | head -n 1)
elif have consensus; then
  PREV_VERSION=$(consensus --version 2>/dev/null | cut -d' ' -f1 || true)
fi

# ---------------------------------------------------------------- 2-4. download, verify, unpack
SKIPPED=0
SOURCE="$BASE/$ASSET"
if [ "$MODE" = release ] && [ "$PREV_SHA" = "$EXPECTED" ] && [ -x "$ROOT/current/bin/consensus" ] && [ -f "$ROOT/current/VERSION" ]; then
  SKIPPED=1
  NEW_VERSION=$(cat "$ROOT/current/VERSION")
  step 2 Downloading "skipped: consensus $NEW_VERSION for $PLATFORM is already installed"
  step 3 Verifying "sha256 matches the installed build"
  step 4 Installing "$(tilde "$ROOT/current") (unchanged)"
elif [ "$MODE" = release ]; then
  STEP_NAME="download $ASSET"
  step 2 Downloading "$ASSET"
  rc=0; fetch "$BASE/$ASSET" "$TMP_DIR/$ASSET" progress || rc=$?
  [ "$rc" = 0 ] || die "could not download $BASE/$ASSET$([ "$rc" = 44 ] && echo " (404 Not Found)"). Check your connection or proxy and re-run." 3

  STEP_NAME="verify checksum"
  [ -n "$SHA_TOOL" ] || die "no sha256 tool found (sha256sum, shasum or openssl) to verify the download" 4
  ACTUAL=$(sha256_of "$TMP_DIR/$ASSET")
  if [ "$ACTUAL" != "$EXPECTED" ]; then
    rm -f "$TMP_DIR/$ASSET"
    die "checksum verification failed for $ASSET: expected $EXPECTED, got $ACTUAL. The download was deleted. Re-run; if it repeats, open an issue at $REPO_URL/issues" 4
  fi
  step 3 Verifying "sha256 ok (SHA256SUMS from the release)"

  STEP_NAME="unpack"
  mkdir -p "$TMP_DIR/x" || die "cannot create $TMP_DIR/x" 1
  tar -xzf "$TMP_DIR/$ASSET" -C "$TMP_DIR/x" >>"$LOG_FILE" 2>&1 || die "could not unpack $ASSET (see $LOG_FILE)" 1
  rm -f "$TMP_DIR/$ASSET"
  { [ -f "$TMP_DIR/x/consensus/VERSION" ] && [ -x "$TMP_DIR/x/consensus/bin/consensus" ]; } || die "$ASSET does not look like a consensus release archive" 1
  NEW_VERSION=$(cat "$TMP_DIR/x/consensus/VERSION")
  NODE_VERSION=$(cat "$TMP_DIR/x/consensus/node/VERSION" 2>/dev/null || echo "22")
else
  fallback_stage
  EXPECTED=""
fi

if [ "$SKIPPED" = 0 ]; then
  STEP_NAME="install into $ROOT/versions"
  mkdir -p "$ROOT/versions" || die "cannot create $ROOT/versions" 1
  rm -rf "$ROOT/versions/$NEW_VERSION.old"
  if [ -e "$ROOT/versions/$NEW_VERSION" ]; then
    mv "$ROOT/versions/$NEW_VERSION" "$ROOT/versions/$NEW_VERSION.old" || die "cannot replace $ROOT/versions/$NEW_VERSION" 1
  fi
  mv "$TMP_DIR/x/consensus" "$ROOT/versions/$NEW_VERSION" || die "could not move the new version into $ROOT/versions" 1
  rm -rf "$ROOT/versions/$NEW_VERSION.old"
  { ln -sfn "versions/$NEW_VERSION" "$ROOT/current" 2>/dev/null || { rm -f "$ROOT/current" && ln -s "versions/$NEW_VERSION" "$ROOT/current"; }; } || die "could not point $ROOT/current at versions/$NEW_VERSION" 1
  if [ "$MODE" = release ]; then
    step 4 Installing "$(tilde "$ROOT") (bundled Node $NODE_VERSION; your own Node, if any, is untouched)"
  fi
  # keep the current and the previous version, prune older ones
  ( cd "$ROOT/versions" && ls -t 2>/dev/null | awk 'NR > 2' | while IFS= read -r old; do
      [ "$old" = "$NEW_VERSION" ] || rm -rf "./$old"
    done ) || true
fi

# ------------------------------------------------------------ 5. link + PATH
STEP_NAME="link launcher"
TARGET="$ROOT/current/bin/consensus"
if ! mkdir -p "$BIN_DIR" 2>/dev/null || [ ! -w "$BIN_DIR" ]; then
  warn "$BIN_DIR is not writable; linking into $ROOT/bin instead"
  BIN_DIR="$ROOT/bin"
  mkdir -p "$BIN_DIR" || die "cannot create $BIN_DIR" 1
fi
LAUNCHER="$BIN_DIR/consensus"
if [ -e "$LAUNCHER" ] && [ ! -L "$LAUNCHER" ]; then
  mv -f "$LAUNCHER" "$LAUNCHER.bak" && warn "moved an existing $(tilde "$LAUNCHER") to $(tilde "$LAUNCHER.bak")"
fi
ln -sfn "$TARGET" "$LAUNCHER" || die "could not link $LAUNCHER -> $TARGET" 1
step 5 Linking "$(tilde "$LAUNCHER")"

ENV_FILE="$ROOT/env"
ENV_FISH="$ROOT/env.fish"
BIN_REF=$(homevar "$BIN_DIR")
{
  echo '# consensus: put the consensus launcher on PATH. Sourced from your shell rc files; safe to source twice.'
  echo 'case ":${PATH}:" in'
  echo "  *\":$BIN_REF:\"*) ;;"
  echo "  *) export PATH=\"$BIN_REF:\$PATH\" ;;"
  echo 'esac'
} >"$ENV_FILE" || die "cannot write $ENV_FILE" 1
{
  echo '# consensus: put the consensus launcher on PATH (fish).'
  echo "if not contains -- \"$BIN_REF\" \$PATH"
  echo "    set -gx PATH \"$BIN_REF\" \$PATH"
  echo 'end'
} >"$ENV_FISH" || die "cannot write $ENV_FISH" 1
ENV_REF=$(homevar "$ENV_FILE")
RC_LINE=". \"$ENV_REF\"  # consensus"

# add_rc_line <file> <create:0|1>
RC_EDITED=""
RC_ALREADY=""
RC_SKIPPED=""
add_rc_line() {
  a_file="$1"; a_create="$2"
  if [ -L "$a_file" ]; then
    a_real=$(cd "$(dirname "$a_file")" && readlink "$a_file")
    case "$a_real" in /*) ;; *) a_real="$(dirname "$a_file")/$a_real" ;; esac
    case "$a_real" in "$HOME"/*) ;; *) RC_SKIPPED="$RC_SKIPPED $(tilde "$a_file")"; return 0 ;; esac
  fi
  if [ ! -e "$a_file" ]; then
    [ "$a_create" = 1 ] || return 0
    mkdir -p "$(dirname "$a_file")" && : >"$a_file" || { RC_SKIPPED="$RC_SKIPPED $(tilde "$a_file")"; return 0; }
  fi
  if [ ! -f "$a_file" ] || [ ! -w "$a_file" ]; then RC_SKIPPED="$RC_SKIPPED $(tilde "$a_file")"; return 0; fi
  if grep -Fq "$ENV_REF\"  # consensus" "$a_file" 2>/dev/null; then
    RC_ALREADY="$RC_ALREADY $a_file"; return 0
  fi
  if [ -s "$a_file" ] && [ "$(tail -c 1 "$a_file" | od -An -c | tr -d ' ')" != '\n' ]; then
    printf '\n' >>"$a_file"
  fi
  printf '%s\n' "$RC_LINE" >>"$a_file"
  RC_EDITED="$RC_EDITED $a_file"
}

user_shell() {
  u_shell="${SHELL:-}"
  if [ -z "$u_shell" ]; then
    if have getent; then u_shell=$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f7)
    elif have dscl; then u_shell=$(dscl . -read "/Users/$(id -un)" UserShell 2>/dev/null | sed 's/UserShell: *//')
    fi
  fi
  basename "${u_shell:-sh}"
}

PATH_HINT=""
PATH_STATUS=""
ON_PATH=0
case ":$PATH:" in *":$BIN_DIR:"*) ON_PATH=1 ;; esac
FISH_CONF="${XDG_CONFIG_HOME:-$HOME/.config}/fish/conf.d/consensus.fish"
if [ "$MODIFY_PATH" = 1 ]; then
  ZD="${ZDOTDIR:-$HOME}"
  SH_NAME=$(user_shell)
  case "$SH_NAME" in
    zsh)
      add_rc_line "$ZD/.zshrc" 1
      add_rc_line "$ZD/.zprofile" 1
      for f in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do add_rc_line "$f" 0; done ;;
    bash)
      add_rc_line "$HOME/.bashrc" 1
      LOGIN_RC=""
      for f in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
        [ -e "$f" ] && { LOGIN_RC="$f"; break; }
      done
      [ -n "$LOGIN_RC" ] || { [ "$OS" = darwin ] && LOGIN_RC="$HOME/.bash_profile" || LOGIN_RC="$HOME/.profile"; }
      add_rc_line "$LOGIN_RC" 1
      for f in "$ZD/.zshrc" "$ZD/.zprofile"; do add_rc_line "$f" 0; done ;;
    fish)
      for f in "$HOME/.bashrc" "$HOME/.profile" "$ZD/.zshrc"; do add_rc_line "$f" 0; done ;;
    *)
      add_rc_line "$HOME/.profile" 1
      for f in "$HOME/.bashrc" "$ZD/.zshrc"; do add_rc_line "$f" 0; done ;;
  esac
  # fish: a conf.d drop-in (the whole file is ours); written when fish is the login shell or already configured
  if [ "$SH_NAME" = fish ] || [ -d "${XDG_CONFIG_HOME:-$HOME/.config}/fish" ]; then
    mkdir -p "$(dirname "$FISH_CONF")" 2>/dev/null && {
      [ -f "$FISH_CONF" ] && grep -Fq "consensus" "$FISH_CONF" || RC_EDITED="$RC_EDITED $FISH_CONF"
      printf 'source "%s"  # consensus\n' "$(homevar "$ENV_FISH")" >"$FISH_CONF"
    }
  fi
  edited_list=""
  for f in $RC_EDITED; do edited_list="$edited_list${edited_list:+, }$(tilde "$f")"; done
  if [ "$SH_NAME" = fish ]; then THIS_SHELL="source $(tilde "$ENV_FISH")"; else THIS_SHELL="source $(tilde "$ENV_FILE")"; fi
  if [ -n "$RC_EDITED" ]; then
    PATH_STATUS="added one line to $edited_list"
    detail "PATH: $PATH_STATUS"
    if [ "$ON_PATH" = 1 ]; then
      detail "this terminal already has $(tilde "$BIN_DIR") on PATH"
    else
      detail "new terminals pick this up; for this one:  $THIS_SHELL"
      PATH_HINT="this shell: $THIS_SHELL"
    fi
  elif [ -n "$RC_ALREADY" ]; then
    PATH_STATUS="already set up in your shell rc files"
    detail "PATH: $PATH_STATUS"
    [ "$ON_PATH" = 1 ] || { detail "for this terminal:  $THIS_SHELL"; PATH_HINT="this shell: $THIS_SHELL"; }
  else
    PATH_STATUS="no shell rc file could be updated"
    detail "PATH: $PATH_STATUS; add this line to your shell profile:  $RC_LINE"
    PATH_HINT="add to your shell profile: export PATH=\"$(tilde "$BIN_DIR"):\$PATH\""
  fi
  [ -n "$RC_SKIPPED" ] && warn "left alone (symlink outside \$HOME, not a regular file, or not writable):$RC_SKIPPED"
else
  if [ "$ON_PATH" = 1 ]; then
    PATH_STATUS="PATH already includes $(tilde "$BIN_DIR"); no shell files changed"
  else
    PATH_STATUS="PATH not changed (requested)"
    PATH_HINT="add to your shell profile: export PATH=\"$(tilde "$BIN_DIR"):\$PATH\""
  fi
  detail "$PATH_STATUS${PATH_HINT:+. $PATH_HINT}"
fi

# ------------------------------------------------------------ receipt
STEP_NAME="write receipt"
RC_ALL=""
for f in "$HOME/.zshrc" "$HOME/.zprofile" "${ZDOTDIR:-$HOME}/.zshrc" "${ZDOTDIR:-$HOME}/.zprofile" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
  case " $RC_ALL " in *" $f "*) continue ;; esac
  [ -f "$f" ] && grep -Fq "$ENV_REF\"  # consensus" "$f" 2>/dev/null && RC_ALL="$RC_ALL $f"
done
[ -f "$FISH_CONF" ] && RC_ALL="$RC_ALL $FISH_CONF"
rc_json=""
for f in $RC_ALL; do rc_json="$rc_json${rc_json:+, }$(json_str "$f")"; done
cat >"$ROOT/receipt.json" <<EOF || die "cannot write $ROOT/receipt.json" 1
{
  "kind": "standalone",
  "channel": $(json_str "$([ "$MODE" = release ] && echo release || echo npm-fallback)"),
  "version": $(json_str "$NEW_VERSION"),
  "platform": $(json_str "$PLATFORM"),
  "sha256": $(json_str "$EXPECTED"),
  "source": $(json_str "$SOURCE"),
  "installedAt": $(json_str "$(date -u +%Y-%m-%dT%H:%M:%SZ)"),
  "root": $(json_str "$ROOT"),
  "launcher": $(json_str "$LAUNCHER"),
  "binDir": $(json_str "$BIN_DIR"),
  "envFile": $(json_str "$ENV_FILE"),
  "rcFiles": [$rc_json],
  "installer": $(json_str "sh $INSTALLER_VERSION")
}
EOF

# ------------------------------------------------------------ post-install check
STEP_NAME="post-install check"
"$LAUNCHER" --version >/dev/null 2>>"$LOG_FILE" || die "the installed launcher did not run: $LAUNCHER --version failed (see $LOG_FILE)" 1
info ""
if [ -n "$PREV_VERSION" ] && [ "$PREV_VERSION" != "$NEW_VERSION" ]; then
  say "  ${GR}consensus $PREV_VERSION -> $NEW_VERSION${N}${B} installed in $(elapsed). Nothing was sent anywhere; there is no telemetry."
elif [ "$SKIPPED" = 1 ]; then
  say "  ${GR}consensus $NEW_VERSION${N}${B} is already current (checked in $(elapsed)). Nothing was sent anywhere; there is no telemetry."
else
  say "  ${GR}consensus $NEW_VERSION${N}${B} installed in $(elapsed). Nothing was sent anywhere; there is no telemetry."
fi

# ================================================================ hand-off
# exec below skips the EXIT trap, so clean up now
[ -n "$TMP_DIR" ] && rm -rf "$TMP_DIR"
TMP_DIR=""

# A usable terminal: not --yes/CI, stdout+stderr are terminals, and /dev/tty can really be
# opened. `[ -r /dev/tty ]` alone is true without a controlling terminal (docker, CI, ssh
# host cmd), and `{ : </dev/tty; }` is fatal in dash when it fails (redirection error on a
# special built-in), so probe by opening it in a subshell.
can_prompt() {
  [ -z "$YES" ] && [ -z "${CI:-}" ] && [ -t 1 ] && [ -t 2 ] && ( exec </dev/tty ) 2>/dev/null
}

CONSENSUS_INSTALLER=1
export CONSENSUS_INSTALLER
CONSENSUS_PATH_HINT="${PATH_HINT:-}"
export CONSENSUS_PATH_HINT

if [ "$RUN_SETUP" = 0 ]; then
  say "Next:"
  [ -n "${PATH_HINT:-}" ] && info "$PATH_HINT"
  info "consensus setup      connect your subscriptions or keys, then ask the panel a question"
  exit 0
fi

if [ "$HAD_CONFIG" = 1 ]; then
  say "Existing setup found in $(tilde "$CFG_DIR"): upgraded, not re-running the wizard. Checking it:"
  "$LAUNCHER" doctor || true
  if [ "$PREV_RECEIPT" = 0 ]; then
    info "If your IDEs were wired to an older npm install, point them at this one:  consensus install"
  fi
  say "Upgrade complete."
  [ -n "${PATH_HINT:-}" ] && info "$PATH_HINT"
  info "consensus setup      re-run the wizard any time"
  exit 0
fi

if can_prompt; then
  say "Starting setup (Ctrl-C any time; re-run with: consensus setup)"
  info "A panel of frontier models will debate your question until they agree. First we connect the models."
  exec </dev/tty
  # shellcheck disable=SC2086
  exec "$LAUNCHER" setup $SETUP_ARGS
elif [ -n "$YES" ]; then
  # shellcheck disable=SC2086
  exec "$LAUNCHER" setup --yes $SETUP_ARGS
else
  say "No interactive terminal, so setup was not started. To finish:"
  [ -n "${PATH_HINT:-}" ] && info "$PATH_HINT"
  info "consensus setup          interactive: connect accounts, wire your IDEs"
  info "consensus setup --yes    unattended: use what is already connected"
  exit 0
fi
