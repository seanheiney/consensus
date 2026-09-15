# consensus installer for Windows PowerShell:
#   irm https://raw.githubusercontent.com/seanheiney/consensus/main/install.ps1 | iex
$ErrorActionPreference = "Stop"
$pkg = "consensus-panel"
$repo = if ($env:CONSENSUS_REPO) { $env:CONSENSUS_REPO } else { "github:seanheiney/consensus" }
function Have($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
if (-not (Have node)) {
  Write-Host "Node.js 20+ is required." -ForegroundColor Yellow
  if (Have winget) { winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements }
  else { throw "Install Node 20+ from https://nodejs.org and re-run." }
}
$major = [int]((node -p "process.versions.node.split('.')[0]"))
if ($major -lt 20) { throw "Node $major found; consensus needs 20+." }
Write-Host "Installing $pkg..."
$out = npm install -g $pkg 2>&1
if ($LASTEXITCODE -ne 0) {
  if ("$out" -match "E404") { Write-Host "$pkg is not on npm yet; installing from $repo"; npm install -g $repo; if ($LASTEXITCODE -ne 0) { throw "install from $repo failed" } }
  else { Write-Host $out; throw "npm install -g $pkg failed" }
}
consensus setup
