# =====================================================================
#  ybz Essential Tools - One-Click Installer (Windows)
#  ---------------------------------------------------------------------
#  For ybz users: download -> double-click -> AI CLI tools installed.
#
#  Installs:
#    1. Node.js LTS          (runtime required by the three tools below)
#    2. OpenAI Codex CLI     (ChatGPT's coding tool)
#    3. Claude Code          (Anthropic's coding tool)
#    4. WorkBuddy CLI        (ybz's own)
#
#  Design rules:
#    - Zero dependencies: only built-in PowerShell / curl / winget
#    - Idempotent: safe to re-run, already-installed items are skipped
#    - Readable: prints [OK] / [SKIP] / [FAIL] for every step
#    - No admin rights: installs into the user profile, no UAC prompt
#    - ASCII-ONLY source: PowerShell 5.1 mis-parses UTF-8 without BOM
#      as GBK, which breaks string literals. Keep every char ASCII.
#
#  Usage (normal user, no admin shell needed):
#     powershell -ExecutionPolicy Bypass -File install-ybz-tools.ps1
# =====================================================================

[CmdletBinding()]
param(
    [string]$NodeVersion = '22.14.0',
    [switch]$SkipNode,
    [switch]$DryRun
)

$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'

# ---------------------------------------------------------------- helpers
$script:Failures = @()

function Say {
    param([string]$Msg, [string]$Level = 'INFO')
    $tag = switch ($Level) {
        'OK'   { '[OK]  ' }
        'SKIP' { '[SKIP]' }
        'FAIL' { '[FAIL]' }
        'STEP' { '==>   ' }
        default { '      ' }
    }
    Write-Host "$tag $Msg"
}

function Step {
    param([string]$Title, [scriptblock]$Body)
    Write-Host ''
    Write-Host ('-' * 62) -ForegroundColor DarkGray
    Write-Host "  $Title" -ForegroundColor Cyan
    Write-Host ('-' * 62) -ForegroundColor DarkGray
    try {
        & $Body
    } catch {
        Say "$Title failed: $($_.Exception.Message)" 'FAIL'
        $script:Failures += "$Title : $($_.Exception.Message)"
    }
}

function Refresh-Path {
    # Make newly installed binaries visible in this session (no window restart)
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user"
}

function Test-Cmd {
    param([string]$Name)
    $c = Get-Command $Name -ErrorAction SilentlyContinue
    if ($c) { return $c.Source } else { return $null }
}

# ---------------------------------------------------------------- banner
Write-Host ''
Write-Host '======================================================' -ForegroundColor Green
Write-Host '        ybz  Essential Tools  -  One-Click Setup' -ForegroundColor Green
Write-Host '======================================================' -ForegroundColor Green
Write-Host '  Will install: Node.js / Codex / Claude Code / WorkBuddy'
Write-Host '  No admin rights needed. Nothing else on your PC is changed.'
Write-Host '======================================================'
if ($DryRun) { Write-Host '  [DRY-RUN] environment check only, nothing will be installed' -ForegroundColor Yellow }
Write-Host ''
Write-Host '  Press Enter to start, or Ctrl+C to cancel...' -NoNewline
[void](Read-Host)

# ---------------------------------------------------------------- 0. env
Step 'Step 0 / 4  Check system environment' {
    Say "OS    : $([Environment]::OSVersion.VersionString)"
    Say "User  : $env:USERNAME"
    Say "Arch  : $(if ([Environment]::Is64BitOperatingSystem) {'64-bit'} else {'32-bit'})"

    $tls = [Net.ServicePointManager]::SecurityProtocol
    [Net.ServicePointManager]::SecurityProtocol = $tls -bor [Net.SecurityProtocolType]::Tls12
    Say 'TLS 1.2 enabled (required for downloads)' 'OK'

    Refresh-Path
    if (Test-Cmd 'node')  { Say "Node found: $(node --version)" 'OK' } else { Say 'Node not found, will install' }
    if (Test-Cmd 'npm')   { Say "npm  found: $(npm --version)"  'OK' } else { Say 'npm not found' }
}

# ---------------------------------------------------------------- 1. Node
Step 'Step 1 / 4  Install Node.js' {
    if ($SkipNode) { Say 'skipped on request' 'SKIP'; return }

    $nodeExe = Test-Cmd 'node'
    if ($nodeExe) {
        $v = (& node --version) -replace '^v',''
        $major = [int]($v.Split('.')[0])
        if ($major -ge 18) {
            Say "Node $v is new enough (>=18), skipping" 'SKIP'
            return
        }
        Say "Node $v is too old, need >=18, upgrading"
    }

    if ($DryRun) { Say "[DryRun] would install Node.js v$NodeVersion"; return }

    # Point npm's global dir at the user profile (avoids admin requirement)
    $npmPrefix = Join-Path $env:APPDATA 'npm'
    if (-not (Test-Path $npmPrefix)) { New-Item -ItemType Directory -Path $npmPrefix -Force | Out-Null }

    # Prefer winget, fall back to the official zip archive
    $winget = Test-Cmd 'winget'
    $installed = $false

    if ($winget) {
        Say 'Trying winget for Node.js LTS ...'
        & winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements --silent 2>&1 |
            ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
        Refresh-Path
        if (Test-Cmd 'node') { Say 'winget install succeeded' 'OK'; $installed = $true }
        else { Say 'winget did not take effect, falling back to zip' 'FAIL' }
    }

    if (-not $installed) {
        $arch = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
        $nodeName = "node-v$NodeVersion-win-$arch"
        $zipUrl   = "https://npmmirror.com/mirrors/node/v$NodeVersion/$nodeName.zip"
        $tmpZip   = Join-Path $env:TEMP "$nodeName.zip"
        $target   = Join-Path $env:LOCALAPPDATA 'Programs\nodejs'

        Say "Downloading Node v$NodeVersion ($arch) from npmmirror ..."
        Write-Host "      $zipUrl" -ForegroundColor DarkGray
        try {
            Invoke-WebRequest -Uri $zipUrl -OutFile $tmpZip -UseBasicParsing -TimeoutSec 300
        } catch {
            Say "Download failed: $($_.Exception.Message)" 'FAIL'
            Say 'You can manually install Node LTS from https://nodejs.org and re-run this script' 'FAIL'
            throw
        }

        Say 'Extracting ...'
        $extract = Join-Path $env:TEMP "node-extract-$([guid]::NewGuid().ToString('N').Substring(0,8))"
        Expand-Archive -Path $tmpZip -DestinationPath $extract -Force
        $inner = Get-ChildItem $extract -Directory | Select-Object -First 1

        if (Test-Path $target) { Remove-Item $target -Recurse -Force -ErrorAction SilentlyContinue }
        New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
        Move-Item $inner.FullName $target -Force
        Remove-Item $extract, $tmpZip -Recurse -Force -ErrorAction SilentlyContinue

        # Write the user-level PATH entry (no admin needed)
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        if ($userPath -notlike "*$target*") {
            $newPath = if ([string]::IsNullOrWhiteSpace($userPath)) { $target } else { "$userPath;$target" }
            [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
            Say "Added $target to user PATH" 'OK'
        }
        Refresh-Path
        Say "Node installed: $(& "$target\node.exe" --version)" 'OK'
    }
}

# ---------------------------------------------------------------- 2. npm prefix
Step 'Step 2 / 4  Configure npm global dir (no admin)' {
    Refresh-Path
    if (-not (Test-Cmd 'npm')) { Say 'npm unavailable, skipping (re-run after Node installs)' 'FAIL'; throw 'npm unavailable' }

    $npmPrefix = Join-Path $env:APPDATA 'npm'
    if ($DryRun) { Say "[DryRun] would set npm prefix = $npmPrefix"; return }

    & npm config set prefix "$npmPrefix" --global 2>&1 | Out-Null
    $got = (& npm config get prefix) 2>&1
    if ("$got".Trim() -ne $npmPrefix) {
        Say "npm prefix looks wrong, currently: $got" 'FAIL'
    } else {
        Say "npm global dir -> $npmPrefix" 'OK'
    }

    # The global bin dir must be on PATH or the commands won't resolve
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($userPath -notlike "*$npmPrefix*") {
        $newPath = if ([string]::IsNullOrWhiteSpace($userPath)) { $npmPrefix } else { "$userPath;$npmPrefix" }
        [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
        Say "Added $npmPrefix to user PATH" 'OK'
    } else {
        Say "$npmPrefix is already on PATH" 'SKIP'
    }
    Refresh-Path
}

# ---------------------------------------------------------------- 3. AI tools
Step 'Step 3 / 4  Install AI tools' {
    Refresh-Path
    if (-not (Test-Cmd 'npm')) { Say 'npm unavailable, skipping' 'FAIL'; throw 'npm unavailable' }

    # package name -> display name + command it provides
    $tools = [ordered]@{
        '@openai/codex'             = @{ Name = 'OpenAI Codex';  Cmd = 'codex' }
        '@anthropic-ai/claude-code' = @{ Name = 'Claude Code';   Cmd = 'claude' }
        '@workbuddy/cli'            = @{ Name = 'WorkBuddy CLI'; Cmd = 'workbuddy' }
    }

    foreach ($pkg in $tools.Keys) {
        $info = $tools[$pkg]
        $display = $info.Name

        if ($DryRun) { Say "[DryRun] would install $display ($pkg)"; continue }

        Say "Installing $display ($pkg) ..."
        $log = & npm install -g $pkg --no-fund --no-audit --loglevel=error 2>&1
        $code = $LASTEXITCODE
        if ($code -eq 0) {
            Say "$display installed" 'OK'
        } else {
            Say "$display install failed (exit $code)" 'FAIL'
            $log | Select-Object -Last 5 | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
            $script:Failures += "npm install $pkg"
        }
    }
}

# ---------------------------------------------------------------- 4. verify
Step 'Step 4 / 4  Verify installation' {
    Refresh-Path
    $npmPrefix = Join-Path $env:APPDATA 'npm'

    $checks = [ordered]@{
        'Node.js'     = @{ Alt = 'node' }
        'npm'         = @{ Alt = 'npm' }
        'Codex'       = @{ Path = (Join-Path $npmPrefix 'codex.cmd') }
        'Claude Code' = @{ Path = (Join-Path $npmPrefix 'claude.cmd') }
        'WorkBuddy'   = @{ Path = (Join-Path $npmPrefix 'workbuddy.cmd') }
    }

    Write-Host ''
    foreach ($name in $checks.Keys) {
        $c = $checks[$name]
        $found = $null
        if ($c.Path -and (Test-Path $c.Path)) { $found = $c.Path }
        elseif ($c.Alt) { $found = Test-Cmd $c.Alt }

        if ($found) {
            Say ("{0,-14} {1}" -f $name, $found) 'OK'
        } else {
            Say ("{0,-14} NOT FOUND" -f $name) 'FAIL'
            $script:Failures += "verify $name"
        }
    }
}

# ---------------------------------------------------------------- summary
Write-Host ''
Write-Host '======================================================' -ForegroundColor Green
if ($script:Failures.Count -eq 0) {
    Write-Host '  All done!' -ForegroundColor Green
    Write-Host '======================================================' -ForegroundColor Green
    Write-Host ''
    Write-Host '  Next: sign in to your accounts (run each once)' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '    codex login      <- ChatGPT / OpenAI account'
    Write-Host '    claude login     <- Anthropic account'
    Write-Host '    workbuddy        <- ybz account'
    Write-Host ''
    Write-Host '  Tip: if a command is not found, close this window and open a new one.'
} else {
    Write-Host '  Finished with failures:' -ForegroundColor Yellow
    Write-Host '======================================================' -ForegroundColor Green
    $script:Failures | ForEach-Object { Write-Host "    - $_" -ForegroundColor Red }
    Write-Host ''
    Write-Host '  Common causes: no network, or a firewall blocking npm.'
    Write-Host '  You can re-run this script; finished steps are skipped.'
}
Write-Host ''
Write-Host '  Press Enter to close...' -NoNewline
[void](Read-Host)
