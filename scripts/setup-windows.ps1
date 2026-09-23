# ============================================================================
#  Gamenite: one-shot Windows setup
#
#  What this does, in order:
#    1. Installs Git, Node.js (LTS) and VS Code using winget (built into Windows).
#    2. Fixes two common Windows problems (script policy, long file paths).
#    3. Asks for your name + GitHub email and tells Git who you are.
#    4. Installs Expo's build tool (eas-cli).
#    5. Downloads the Gamenite code into Documents\gamenite and installs it.
#
#  Run it by pasting this ONE line into PowerShell and pressing Enter:
#    irm https://raw.githubusercontent.com/Plamenite/Game-Nite---ClaudeCode/claude/modest-gates-unuglw/scripts/setup-windows.ps1 | iex
#
#  LOW ON DISK SPACE? Set $env:GAMENITE_SLIM = '1' first (same window):
#    $env:GAMENITE_SLIM = '1'; irm https://raw.githubusercontent.com/Plamenite/Game-Nite---ClaudeCode/claude/modest-gates-unuglw/scripts/setup-windows.ps1 | iex
#  Slim mode skips VS Code (~400 MB) and clears the npm download cache
#  after installing (~800 MB). Everything else is identical.
#
#  It is safe to run more than once. Steps already done are skipped.
# ============================================================================

$ErrorActionPreference = 'Stop'
$Slim    = ($env:GAMENITE_SLIM -eq '1')
$Branch  = 'claude/modest-gates-unuglw'
$RepoUrl = 'https://github.com/Plamenite/Game-Nite---ClaudeCode.git'
$Target  = Join-Path $HOME 'Documents\gamenite'

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    $msg" -ForegroundColor Yellow }

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}

function Install-IfMissing($command, $wingetId, $label) {
  if (Get-Command $command -ErrorAction SilentlyContinue) {
    Ok "$label is already installed. Skipping."
    return
  }
  Step "Installing $label (this can take a few minutes)"
  winget install -e --id $wingetId --accept-package-agreements --accept-source-agreements | Out-Host
  Refresh-Path
  if (Get-Command $command -ErrorAction SilentlyContinue) {
    Ok "$label installed."
  } else {
    Warn "$label was installed but this window cannot see it yet."
    Warn "Close PowerShell, open a new one, and run the same command again."
    exit 1
  }
}

Step "Checking that winget (Windows package manager) is available"
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  Write-Host "winget is missing. Open the Microsoft Store, install 'App Installer', then run this again." -ForegroundColor Red
  exit 1
}
Ok "winget found."

Install-IfMissing 'git'  'Git.Git'                   'Git'
Install-IfMissing 'node' 'OpenJS.NodeJS.LTS'         'Node.js LTS'
if ($Slim) { Warn "Slim mode: skipping VS Code." } else {
  Install-IfMissing 'code' 'Microsoft.VisualStudioCode' 'VS Code'
}

Step "Allowing npm helper scripts to run in PowerShell"
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force
Ok "Done."

Step "Letting Git handle very long folder paths"
git config --global core.longpaths true
Ok "Done."

Step "Telling Git who you are (shows on your commits)"
$existingName  = git config --global user.name
$existingEmail = git config --global user.email
if ($existingName -and $existingEmail) {
  Ok "Already set: $existingName <$existingEmail>"
} else {
  $name  = Read-Host "Your name"
  $email = Read-Host "The email on your GitHub account"
  git config --global user.name  "$name"
  git config --global user.email "$email"
  Ok "Saved."
}

Step "Installing Expo's build tool (eas-cli)"
npm install -g eas-cli | Out-Host
Ok "Done."

function Fail($msg, $details) {
  Write-Host ""
  if ($details) { $details -split "`n" | ForEach-Object { Write-Host "    $_" -ForegroundColor Red } }
  Write-Host "    $msg" -ForegroundColor Red
  Write-Host "    Nothing was lost. Copy ALL the red text to Claude." -ForegroundColor Red
  throw "Setup stopped."
}

# Runs git in the project folder and returns its exit code and every line it
# printed. (Windows PowerShell treats git's normal progress messages as errors
# when captured, so error handling is relaxed just for the call.)
function Invoke-Git {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $lines = & git -C $Target @args 2>&1 | ForEach-Object { "$_" } |
      Where-Object { $_ -ne 'System.Management.Automation.RemoteException' }
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  $lines | ForEach-Object { Write-Host "      $_" }
  [pscustomobject]@{ Code = $code; Text = ($lines -join "`n") }
}

Step "Downloading the Gamenite code"
if (Test-Path (Join-Path $Target '.git')) {
  Ok "Already downloaded at $Target. Getting the latest version."

  # A git that crashed can leave a lock file behind that blocks every update.
  $lock = Join-Path (Join-Path $Target '.git') 'index.lock'
  if ((Test-Path $lock) -and ((Get-Item $lock).LastWriteTime -lt (Get-Date).AddMinutes(-5))) {
    Warn "Removing a stale git lock file left by an earlier crash."
    Remove-Item $lock -Force
  }

  $r = Invoke-Git fetch origin $Branch
  if ($r.Code -ne 0) { Fail "Could not reach GitHub to download the update. Check the internet connection and run this again." $r.Text }

  # This PC's copy is a mirror of GitHub: nobody edits it by hand, but tools
  # rewrite some files (npm rewrites package-lock.json). Put any local edits
  # aside in a stash first: recoverable, nothing is deleted. Secret files
  # like .env.development.local are ignored by git and never touched.
  $changed = git -C $Target status --porcelain --untracked-files=no
  if ($changed) {
    Warn "Setting aside local changes to generated files:"
    $changed | ForEach-Object { Warn "  $_" }
    $r = Invoke-Git -c user.name=gamenite-setup -c user.email=setup@plamenite.app stash push -m "setup script: local changes set aside"
    if ($r.Code -ne 0) { Fail "Could not set aside local changes before updating." $r.Text }
  }

  $r = Invoke-Git merge --ff-only "origin/$Branch"
  if ($r.Code -ne 0) {
    # The simple update did not apply. Keep whatever this PC had on a backup
    # branch (nothing is lost), then make the copy match GitHub exactly.
    $backup = "backup/pc-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
    Warn "The simple update did not apply; saving this PC's version as $backup and matching GitHub."
    $r = Invoke-Git branch $backup
    if ($r.Code -ne 0) { Fail "Could not save a backup of this PC's version." $r.Text }
    $r = Invoke-Git checkout -f -B $Branch "origin/$Branch"
    if ($r.Code -ne 0) {
      Fail "Could not update the files. Close every PowerShell and VS Code window that uses the project (they can lock files), then run this again." $r.Text
    }
  }
} else {
  New-Item -ItemType Directory -Force -Path (Split-Path $Target) | Out-Null
  git clone --branch $Branch $RepoUrl $Target | Out-Host
  if ($LASTEXITCODE -ne 0) { Fail "Could not download the project from GitHub." }
  Ok "Downloaded to $Target"
}

# Prove it: this PC must now match the latest version on GitHub.
$local  = git -C $Target rev-parse HEAD
$remote = git -C $Target rev-parse "origin/$Branch"
if ($local -ne $remote) { Fail "This PC still has an older version than GitHub." }
$version = git -C $Target log -1 --format="%h %s"
Ok "Up to date: $version"

Step "Installing the project's packages (this is the slow part, 2-5 minutes)"
Push-Location $Target
try {
  npm install --no-audit --no-fund | Out-Host
  if ($LASTEXITCODE -ne 0) { Fail "Installing packages failed." }
  # npm may rewrite the lock file; restore it so the next update is clean.
  git checkout -q -- package-lock.json | Out-Host
} finally {
  Pop-Location
}
Ok "Done."

if ($Slim) {
  Step "Slim mode: clearing the npm download cache to free disk space"
  npm cache clean --force | Out-Host
  Ok "Done."
}

Step "Disk space used by the project"
$bytes = (Get-ChildItem -LiteralPath $Target -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
Ok ("{0:N0} MB in {1}" -f ($bytes / 1MB), $Target)

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " Setup complete." -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host " Versions installed:"
Write-Host "   git  " (git --version)
Write-Host "   node " (node --version)
Write-Host "   npm  " (npm --version)
Write-Host ""
Write-Host " Next steps:"
Write-Host "   1. Close this PowerShell window and open a new one."
Write-Host "   2. Run:   eas login          (use your expo.dev account)"
Write-Host "   3. Run:   cd $Target"
Write-Host "   4. Run:   npm run mobile     then scan the QR code with your iPhone camera."
Write-Host ""
