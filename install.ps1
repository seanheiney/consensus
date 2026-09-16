# consensus installer for Windows PowerShell:
#
#   irm https://raw.githubusercontent.com/seanheiney/consensus/main/install.ps1 | iex
#
# With options, download first (a piped script cannot take parameters):
#
#   irm https://raw.githubusercontent.com/seanheiney/consensus/main/install.ps1 -OutFile install.ps1
#   .\install.ps1 -Yes
#
# What it does: makes sure Node 22+ is present, installs the `consensus` CLI
# (falling back to the repo tarball while the npm package is unpublished), then
# runs `consensus setup`. Safe to re-run; it upgrades in place.
#
# Docs: https://github.com/seanheiney/consensus/blob/main/docs/install.md

[CmdletBinding()]
param(
  [switch]$Yes,
  [switch]$NoSetup,
  [switch]$Help,
  [switch]$Version
)

$ErrorActionPreference = "Stop"
$installerVersion = "0.1.0"
$pkg = "consensus-panel"
$minNode = 22
$repo = if ($env:CONSENSUS_REPO) { $env:CONSENSUS_REPO } else { "https://github.com/seanheiney/consensus/archive/refs/heads/main.tar.gz" }
$prefix = $env:CONSENSUS_INSTALL_DIR

if ($Help) {
  @"
consensus installer $installerVersion

Usage:
  irm https://raw.githubusercontent.com/seanheiney/consensus/main/install.ps1 | iex
  .\install.ps1 [-Yes] [-NoSetup] [-Help] [-Version]

Options:
  -Yes        non-interactive: no questions during setup
  -NoSetup    install the CLI only; do not run 'consensus setup'
  -Help       show this and exit
  -Version    print the installer version and exit

Environment:
  CONSENSUS_INSTALL_DIR   install prefix (binary lands in <prefix>\bin)
  CONSENSUS_REPO          tarball/spec to install instead of the npm package

Docs: https://github.com/seanheiney/consensus/blob/main/docs/install.md
"@ | Write-Host
  exit 0
}
if ($Version) { Write-Host "consensus installer $installerVersion"; exit 0 }

function Have($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

Write-Host "consensus installer $installerVersion" -ForegroundColor Cyan
Write-Host "  docs: https://github.com/seanheiney/consensus/blob/main/docs/install.md"

$before = if (Have consensus) { (consensus --version) } else { $null }
if ($before) { Write-Host "  already installed: consensus $before (this run upgrades it in place)" }

if (-not (Have node)) {
  Write-Host "Node.js $minNode+ is required." -ForegroundColor Yellow
  if (Have winget) {
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    # winget updates the machine PATH, not this session's copy of it.
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
  } else {
    throw "Install Node $minNode+ from https://nodejs.org and re-run."
  }
}
if (-not (Have node)) { throw "Node is installed but not on PATH. Open a new terminal and re-run." }

$major = [int]((node -p "process.versions.node.split('.')[0]"))
if ($major -lt $minNode) { throw "Node $major found; consensus needs $minNode+. Upgrade from https://nodejs.org and re-run." }
Write-Host ("  node {0}, npm {1}" -f (node -v), (npm -v))

function Install-Spec($spec) {
  if ($prefix) { return (npm install -g --prefix $prefix $spec 2>&1) }
  return (npm install -g $spec 2>&1)
}

if ($prefix) {
  Write-Host "Installing $pkg into $prefix (CONSENSUS_INSTALL_DIR)..."
  New-Item -ItemType Directory -Force -Path $prefix | Out-Null
  $env:Path = "$prefix;$prefix\bin;$env:Path"
} else {
  Write-Host "Installing $pkg..."
}

$out = Install-Spec $pkg
if ($LASTEXITCODE -ne 0) {
  if ("$out" -match "E404|404 Not Found") {
    Write-Host "$pkg is not on npm yet; installing from $repo"
    $out = Install-Spec $repo
    if ($LASTEXITCODE -ne 0) { Write-Host $out; throw "install from $repo failed" }
  } else {
    Write-Host $out
    throw "npm install -g $pkg failed"
  }
}

if (-not (Have consensus)) {
  throw "consensus was installed but is not on PATH. Add `"$(npm prefix -g)`" to PATH, open a new terminal, and run: consensus setup"
}
$after = consensus --version
if ($before -and $before -eq $after) { Write-Host "  consensus $after (already current)" }
elseif ($before) { Write-Host "  consensus $before -> $after" }
else { Write-Host "  consensus $after" }

if ($NoSetup) {
  Write-Host "Installed. Next step:" -ForegroundColor Cyan
  Write-Host "  consensus setup      connect your subscriptions or keys, then ask the panel a question"
  exit 0
}

if ($Yes) { consensus setup --yes } else { consensus setup }

Write-Host "Done. Next step:" -ForegroundColor Cyan
Write-Host '  consensus "Should we use optimistic locking or a distributed lock for inventory holds?"'
Write-Host "  consensus doctor     see what is connected;  consensus --help   see everything else"
