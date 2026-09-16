# consensus installer for Windows (PowerShell 5.1+ or pwsh) -- no Node, no npm, no admin:
#
#   irm https://raw.githubusercontent.com/seanheiney/consensus/main/install.ps1 | iex
#
# `irm | iex` cannot pass parameters. Use environment variables, or the scriptblock form:
#
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/seanheiney/consensus/main/install.ps1))) -Yes
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/seanheiney/consensus/main/install.ps1))) -Version 0.2.0 -NoSetup
#   $env:CONSENSUS_YES = 1; irm https://raw.githubusercontent.com/seanheiney/consensus/main/install.ps1 | iex
#
# What it does, in order:
#   1. detects x64 / arm64
#   2. downloads consensus-win-<arch>.zip from the GitHub Release (official Node 22 + the bundled CLI)
#   3. verifies it against the release's SHA256SUMS
#   4. unpacks it to %LOCALAPPDATA%\consensus\versions\<version> and points ...\current at it (a junction)
#   5. adds %LOCALAPPDATA%\consensus\current\bin to your *user* PATH (and to this window's PATH)
#   6. runs `consensus setup` (fresh install) or `consensus doctor` (upgrade: config already exists)
#
# While no release has been published yet, it falls back to a private official Node 22 zip plus
# `npm install --prefix` of consensus in the same place (never a global npm install).
# Safe to re-run. No telemetry. Everything written is listed in %LOCALAPPDATA%\consensus\receipt.json.
#
# Docs: https://github.com/seanheiney/consensus/blob/main/docs/install.md

[CmdletBinding()]
param(
  [switch]$Yes,
  [switch]$NoSetup,
  [switch]$NoFirstRun,
  [string]$Version = "",
  [switch]$NoModifyPath,
  [string]$Dir = "",
  [switch]$DryRun,
  [switch]$Help,
  [switch]$InstallerVersion
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # Invoke-WebRequest's progress bar makes 5.1 downloads crawl
$installerVer = "0.2.0"
$repoUrl = "https://github.com/seanheiney/consensus"
$pkg = "consensus-panel"

if ($Help) {
  @"
consensus installer $installerVer (Windows)

Usage:
  irm https://raw.githubusercontent.com/seanheiney/consensus/main/install.ps1 | iex
  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/seanheiney/consensus/main/install.ps1))) [options]
  .\install.ps1 [options]

Options:
  -Yes              non-interactive: run 'consensus setup --yes'
  -NoSetup          install only; do not start 'consensus setup'
  -NoFirstRun       passed to setup: skip the guided first debate
  -Version <ver>    install this release (e.g. 0.2.0); default: latest
  -Dir <path>       install root (default: %LOCALAPPDATA%\consensus)
  -NoModifyPath     do not change your user PATH
  -DryRun           print what would happen and exit
  -Help             show this and exit
  -InstallerVersion print the installer version and exit

Environment (for irm | iex, which cannot pass options):
  CONSENSUS_YES=1  CONSENSUS_NO_SETUP=1  CONSENSUS_NO_FIRST_RUN=1  CONSENSUS_VERSION=0.2.0
  CONSENSUS_INSTALL_DIR=<root>  CONSENSUS_NO_MODIFY_PATH=1
  CONSENSUS_DOWNLOAD_BASE=<url>   mirror: <url>/SHA256SUMS and <url>/consensus-win-<arch>.zip
  CONSENSUS_NODE_DIST=<url>       Node mirror for the fallback (default https://nodejs.org/dist)

Docs: $repoUrl/blob/main/docs/install.md
"@ | Write-Host
  return
}
if ($InstallerVersion) { Write-Host "consensus installer $installerVer"; return }

if ($env:CONSENSUS_YES -eq "1") { $Yes = $true }
if ($env:CONSENSUS_NO_SETUP -eq "1") { $NoSetup = $true }
if ($env:CONSENSUS_NO_FIRST_RUN -eq "1") { $NoFirstRun = $true }
if ($env:CONSENSUS_NO_MODIFY_PATH -eq "1") { $NoModifyPath = $true }
if (-not $Version -and $env:CONSENSUS_VERSION) { $Version = $env:CONSENSUS_VERSION }
if (-not $Dir -and $env:CONSENSUS_INSTALL_DIR) { $Dir = $env:CONSENSUS_INSTALL_DIR }
if ($Version -eq "stable") { $Version = "latest" }
if (-not $Version) { $Version = "latest" }
if ($Version -ne "latest" -and -not $Version.StartsWith("v")) { $Version = "v$Version" }

$t0 = Get-Date
function Step($n, $label, $detail) { Write-Host ("  [{0}/5] {1,-14} {2}" -f $n, $label, $detail) }
function Detail($text) { Write-Host ("  {0,-20} {1}" -f "", $text) }
function Warn($text) { Write-Host "  warning: $text" -ForegroundColor Yellow }

try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

# Returns $true on success, $false on HTTP 404; throws on any other failure.
function Get-File($url, $out) {
  try {
    Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing
    return $true
  } catch {
    $status = $null
    try { $status = [int]$_.Exception.Response.StatusCode } catch { }
    if ($status -eq 404) { return $false }
    throw "could not download ${url}: $($_.Exception.Message). Check your connection or proxy and re-run."
  }
}

Write-Host "consensus installer $installerVer" -ForegroundColor Cyan

# ---------------------------------------------------------------- 1. platform
$archRaw = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$arch = if ($archRaw -eq "ARM64") { "arm64" } elseif ($archRaw -eq "AMD64") { "x64" } else { throw "unsupported CPU architecture: $archRaw (supported: x64, arm64)" }
$platform = "win-$arch"
$asset = "consensus-$platform.zip"
$root = if ($Dir) { [IO.Path]::GetFullPath($Dir) } else { Join-Path $env:LOCALAPPDATA "consensus" }
$base = if ($env:CONSENSUS_DOWNLOAD_BASE) { $env:CONSENSUS_DOWNLOAD_BASE.TrimEnd("/") } elseif ($Version -eq "latest") { "$repoUrl/releases/latest/download" } else { "$repoUrl/releases/download/$Version" }
$cfgDir = Join-Path $(if ($env:XDG_CONFIG_HOME) { $env:XDG_CONFIG_HOME } else { Join-Path $HOME ".config" }) "consensus"
$hadConfig = Test-Path (Join-Path $cfgDir "config.json")
$binDir = Join-Path $root "current\bin"
$launcher = Join-Path $binDir "consensus.cmd"

if ($DryRun) {
  Write-Host "  platform:  Windows, $platform"
  Write-Host "  download:  $base/$asset (verified against $base/SHA256SUMS)"
  Write-Host "  install:   $root\versions\<version>, $root\current"
  Write-Host "  PATH:      $(if ($NoModifyPath) { 'not modified' } else { "adds $binDir to your user PATH" })"
  Write-Host "  then:      $(if ($NoSetup) { 'nothing' } elseif ($hadConfig) { 'consensus doctor (upgrade)' } else { 'consensus setup' })"
  return
}

Step 1 "Platform" "Windows $([Environment]::OSVersion.Version), $platform"
New-Item -ItemType Directory -Force -Path $root | Out-Null
$tmp = Join-Path $root (".install." + [Guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$stage = Join-Path $tmp "x\consensus"

try {
  $mode = "release"
  $expected = ""
  if (Get-File "$base/SHA256SUMS" (Join-Path $tmp "SHA256SUMS")) {
    foreach ($line in Get-Content (Join-Path $tmp "SHA256SUMS")) {
      $parts = $line.Trim() -split "\s+"
      if ($parts.Count -ge 2 -and $parts[1].TrimStart("*") -eq $asset) { $expected = $parts[0].ToLower() }
    }
    if (-not $expected) { Warn "the release has no build for $platform; falling back to a private Node + npm install"; $mode = "fallback" }
  } else {
    Warn "no consensus release is published yet; falling back to a private Node + npm install"
    $mode = "fallback"
  }

  $receiptPath = Join-Path $root "receipt.json"
  $prev = $null
  if (Test-Path $receiptPath) { try { $prev = Get-Content $receiptPath -Raw | ConvertFrom-Json } catch { } }
  $skipped = $false
  $source = "$base/$asset"

  if ($mode -eq "release" -and $prev -and $prev.sha256 -eq $expected -and (Test-Path (Join-Path $root "current\bin\consensus.cmd"))) {
    $skipped = $true
    $newVersion = (Get-Content (Join-Path $root "current\VERSION") -Raw).Trim()
    Step 2 "Downloading" "skipped: consensus $newVersion for $platform is already installed"
    Step 3 "Verifying" "sha256 matches the installed build"
    Step 4 "Installing" "$root\current (unchanged)"
  } elseif ($mode -eq "release") {
    Step 2 "Downloading" $asset
    $zip = Join-Path $tmp $asset
    if (-not (Get-File "$base/$asset" $zip)) { throw "could not download $base/$asset (404 Not Found)" }
    $actual = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower()
    if ($actual -ne $expected) {
      Remove-Item -Force $zip
      throw "checksum verification failed for ${asset}: expected $expected, got $actual. The download was deleted. Re-run; if it repeats, open an issue at $repoUrl/issues"
    }
    Step 3 "Verifying" "sha256 ok (SHA256SUMS from the release)"
    Expand-Archive -Path $zip -DestinationPath (Join-Path $tmp "x") -Force
    Remove-Item -Force $zip
    if (-not (Test-Path (Join-Path $stage "bin\consensus.cmd"))) { throw "$asset does not look like a consensus release archive" }
    $newVersion = (Get-Content (Join-Path $stage "VERSION") -Raw).Trim()
    $nodeVersion = if (Test-Path (Join-Path $stage "node\VERSION")) { (Get-Content (Join-Path $stage "node\VERSION") -Raw).Trim() } else { "22" }
  } else {
    # ---- fallback: private Node zip + npm --prefix (no global npm, no admin)
    $nodeDist = if ($env:CONSENSUS_NODE_DIST) { $env:CONSENSUS_NODE_DIST.TrimEnd("/") } else { "https://nodejs.org/dist" }
    $sums = Join-Path $tmp "NODESUMS"
    if (-not (Get-File "$nodeDist/latest-v22.x/SHASUMS256.txt" $sums)) { throw "could not download $nodeDist/latest-v22.x/SHASUMS256.txt" }
    $nodeZip = $null; $nodeSha = $null
    foreach ($line in Get-Content $sums) {
      $parts = $line.Trim() -split "\s+"
      if ($parts.Count -ge 2 -and $parts[1] -match "^node-v22\.[0-9.]+-$platform\.zip$") { $nodeSha = $parts[0].ToLower(); $nodeZip = $parts[1] }
    }
    if (-not $nodeZip) { throw "nodejs.org has no Node 22 zip for $platform" }
    $nodeVersion = $nodeZip -replace "^node-v", "" -replace "-$platform\.zip$", ""
    Step 2 "Downloading" "Node $nodeVersion runtime from nodejs.org (a private copy; your own Node is untouched)"
    $nodeZipPath = Join-Path $tmp $nodeZip
    if (-not (Get-File "$nodeDist/latest-v22.x/$nodeZip" $nodeZipPath)) { throw "could not download $nodeDist/latest-v22.x/$nodeZip" }
    $actual = (Get-FileHash -Algorithm SHA256 $nodeZipPath).Hash.ToLower()
    if ($actual -ne $nodeSha) { Remove-Item -Force $nodeZipPath; throw "checksum verification failed for ${nodeZip}: expected $nodeSha, got $actual" }
    Step 3 "Verifying" "sha256 ok (nodejs.org SHASUMS256.txt)"
    New-Item -ItemType Directory -Force -Path (Join-Path $stage "bin") | Out-Null
    Expand-Archive -Path $nodeZipPath -DestinationPath $tmp -Force
    Move-Item (Join-Path $tmp ($nodeZip -replace "\.zip$", "")) (Join-Path $stage "node")
    Remove-Item -Force $nodeZipPath

    Step 4 "Installing" "consensus with npm into $root (takes about a minute)"
    $node = Join-Path $stage "node\node.exe"
    $npmCli = Join-Path $stage "node\node_modules\npm\bin\npm-cli.js"
    $prefix = Join-Path $stage "npm"
    $npmLog = Join-Path $tmp "npm.log"
    $env:Path = "$(Join-Path $stage 'node');$env:Path"
    function Install-Spec($spec) {
      & $node $npmCli install -g --prefix $prefix --no-fund --no-audit --loglevel=error $spec *> $npmLog
      return ($LASTEXITCODE -eq 0)
    }
    $regSpec = if ($Version -eq "latest") { "$pkg@latest" } else { "$pkg@$($Version.TrimStart('v'))" }
    $tarRef = if ($Version -eq "latest") { "refs/heads/main" } else { "refs/tags/$Version" }
    $tarball = if ($env:CONSENSUS_REPO) { $env:CONSENSUS_REPO } else { "$repoUrl/archive/$tarRef.tar.gz" }
    if (-not $env:CONSENSUS_REPO -and (Install-Spec $regSpec)) {
      $source = "npm:$regSpec"
    } else {
      if (-not $env:CONSENSUS_REPO) {
        if (-not (Select-String -Path $npmLog -Pattern "E404|ETARGET|404 Not Found|No matching version" -Quiet)) { Get-Content $npmLog -Tail 20 | Write-Host; throw "npm install $regSpec failed" }
        Detail "$pkg is not on the npm registry yet; installing from $tarball"
      }
      if (-not (Install-Spec $tarball)) { Get-Content $npmLog -Tail 20 | Write-Host; throw "npm install of $tarball failed" }
      $source = $tarball
    }
    $appDir = Join-Path $prefix "node_modules\$pkg"
    if (-not (Test-Path (Join-Path $appDir "dist\cli.js"))) { throw "npm finished but $appDir\dist\cli.js is missing" }
    $newVersion = (Get-Content (Join-Path $appDir "package.json") -Raw | ConvertFrom-Json).version
    Set-Content -Path (Join-Path $stage "VERSION") -Value $newVersion -Encoding ASCII
    $cmd = "@echo off`r`nrem consensus launcher (installer fallback: private Node + npm). Relocatable.`r`nsetlocal`r`nset `"CONSENSUS_HOME=%~dp0..`"`r`n`"%~dp0..\node\node.exe`" --no-warnings=ExperimentalWarning `"%~dp0..\npm\node_modules\$pkg\dist\cli.js`" %*`r`nexit /b %ERRORLEVEL%`r`n"
    [IO.File]::WriteAllText((Join-Path $stage "bin\consensus.cmd"), $cmd)
  }

  if (-not $skipped) {
    $versions = Join-Path $root "versions"
    New-Item -ItemType Directory -Force -Path $versions | Out-Null
    $target = Join-Path $versions $newVersion
    $current = Join-Path $root "current"
    # Remove the junction itself first (never recurse through it), then the old copy of this version.
    if (Test-Path $current) { cmd /c rmdir "$current" | Out-Null }
    if (Test-Path $target) { Remove-Item -Recurse -Force $target }
    Move-Item $stage $target
    New-Item -ItemType Junction -Path $current -Target $target | Out-Null
    Get-ChildItem -Recurse -File $target | Unblock-File -ErrorAction SilentlyContinue
    if ($mode -eq "release") { Step 4 "Installing" "$root (bundled Node $nodeVersion; your own Node, if any, is untouched)" }
    # keep the current and the previous version
    Get-ChildItem -Directory $versions | Sort-Object LastWriteTime -Descending | Select-Object -Skip 2 | Where-Object { $_.Name -ne $newVersion } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  }

  # ---------------------------------------------------------------- 5. PATH
  Step 5 "PATH" $binDir
  $pathHint = ""
  if ($NoModifyPath) {
    Detail "user PATH not changed (requested). Add $binDir to PATH to run consensus from any terminal."
    $pathHint = "add $binDir to your PATH"
  } else {
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $entries = @(); if ($userPath) { $entries = $userPath -split ";" | Where-Object { $_ } }
    if ($entries | Where-Object { $_.TrimEnd("\") -ieq $binDir }) {
      Detail "already on your user PATH"
    } else {
      [Environment]::SetEnvironmentVariable("Path", (@($binDir) + $entries) -join ";", "User")
      Detail "added to your user PATH; new terminals pick this up"
    }
  }
  if (-not (($env:Path -split ";") | Where-Object { $_.TrimEnd("\") -ieq $binDir })) { $env:Path = "$binDir;$env:Path" }

  $receipt = [ordered]@{
    kind = "standalone"
    channel = $(if ($mode -eq "release") { "release" } else { "npm-fallback" })
    version = $newVersion
    platform = $platform
    sha256 = $expected
    source = $source
    installedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    root = $root
    launcher = $launcher
    binDir = $binDir
    envFile = $null
    rcFiles = @()
    installer = "ps1 $installerVer"
  }
  $receipt | ConvertTo-Json | Set-Content -Path $receiptPath -Encoding UTF8

  & $launcher --version | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "the installed launcher did not run: $launcher --version failed" }
  $secs = [int]((Get-Date) - $t0).TotalSeconds
  Write-Host ""
  if ($prev -and $prev.version -and $prev.version -ne $newVersion) { $what = "consensus $($prev.version) -> $newVersion installed in ${secs}s." }
  elseif ($skipped) { $what = "consensus $newVersion is already current." }
  else { $what = "consensus $newVersion installed in ${secs}s." }
  Write-Host "  $what Nothing was sent anywhere; there is no telemetry." -ForegroundColor Green
} catch {
  Write-Host "error: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "  manual install: download $asset from $repoUrl/releases, extract anywhere, run consensus\bin\consensus.cmd setup"
  throw
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------- 6. hand-off
$env:CONSENSUS_INSTALLER = "1"
$env:CONSENSUS_PATH_HINT = $pathHint
if ($NoSetup) {
  Write-Host "Next:" -ForegroundColor Cyan
  Write-Host "  consensus setup      connect your subscriptions or keys, then ask the panel a question"
  return
}
if ($hadConfig) {
  Write-Host "Existing setup found in ${cfgDir}: upgraded, not re-running the wizard. Checking it:" -ForegroundColor Cyan
  & $launcher doctor
  Write-Host "Upgrade complete." -ForegroundColor Cyan
  Write-Host "  consensus setup      re-run the wizard any time"
  return
}
$setupArgs = @("setup")
if ($NoFirstRun) { $setupArgs += "--no-first-run" }
$interactive = -not $Yes -and -not $env:CI -and -not [Console]::IsInputRedirected
if ($interactive) {
  Write-Host "Starting setup (Ctrl-C any time; re-run with: consensus setup)" -ForegroundColor Cyan
  & $launcher @setupArgs
} elseif ($Yes) {
  & $launcher @setupArgs --yes
} else {
  Write-Host "No interactive console, so setup was not started. To finish, in a new terminal:" -ForegroundColor Cyan
  Write-Host "  consensus setup          interactive: connect accounts, wire your IDEs"
  Write-Host "  consensus setup --yes    unattended: use what is already connected"
}
