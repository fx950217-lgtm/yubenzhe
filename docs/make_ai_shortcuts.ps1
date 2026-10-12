# Add AI / dev shortcuts to the desktop of the remote Windows cloud PC.
# All ASCII on purpose: PowerShell 5.1 mis-parses UTF-8-without-BOM Chinese text.

$ErrorActionPreference = 'Continue'
$Desktop    = 'C:\Users\Administrator\Desktop'
$PublicDesk = 'C:\Users\Public\Desktop'
$Wsh        = New-Object -ComObject WScript.Shell
$Made       = @()

function New-Lnk {
    param($Path, $Target, $Args, $Icon, $Desc)
    $s = $Wsh.CreateShortcut($Path)
    $s.TargetPath       = $Target
    if ($Args) { $s.Arguments = $Args }
    if ($Icon) { $s.IconLocation = $Icon }
    if ($Desc) { $s.Description = $Desc }
    $s.WorkingDirectory = Split-Path $Target -Parent
    $s.Save()
}

# ---------- 1. Force the public shortcuts visible in EVERY view ----------
# Windows Server 2022 ships with "Show common icons on desktop" off.
# Clearing HideDesktopIcons\NewStartPanel {20D04FE0...} unhides This PC etc.
$k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\HideDesktopIcons\NewStartPanel'
if (-not (Test-Path $k)) { New-Item -Path $k -Force | Out-Null }
foreach ($clsid in @('{20D04FE0-3AEA-1069-A2D8-08002B30309D}',   # This PC
                     '{645FF040-5081-101B-9F08-00AA002F954E}',   # Recycle Bin
                     '{871C5380-42A0-1069-A2EA-08002B30309D}',   # IE / browser
                     '{59031A47-3F72-44A7-89C5-5595FE6B30EE}')) { # User folder
    New-ItemProperty -Path $k -Name $clsid -Value 0 -PropertyType DWord -Force | Out-Null
}
$Made += 'Registry: unhid This PC / Recycle Bin icons'

# ---------- 2. Personal desktop: common browser shortcut ----------
$edgeLnk = Join-Path $PublicDesk 'Microsoft Edge.lnk'
if (Test-Path $edgeLnk) {
    Copy-Item $edgeLnk (Join-Path $Desktop 'Microsoft Edge.lnk') -Force
    $Made += 'Desk: Microsoft Edge'
}

# ---------- 3. AI command-line tools -> launcher .cmd wrappers ----------
# These three are CLI-only (installed via npm). We give each a double-clickable
# launcher that opens cmd, prints a banner, and starts the tool logged in-place.
$np = Join-Path $env:APPDATA 'npm'

$launchers = @(
  @{ File='Claude Code.cmd';  Bin='claude.cmd'; Title='Claude Code';
     Hint='Run:  claude login      (then paste the code it shows you)' },
  @{ File='Codex CLI.cmd';    Bin='codex.cmd';  Title='Codex CLI (OpenAI)';
     Hint='Run:  codex login' },
  @{ File='WorkBuddy CLI.cmd';Bin='workbuddy.cmd'; Title='WorkBuddy';
     Hint='Run:  workbuddy' }
)

foreach ($L in $launchers) {
    $line = "@echo off`r`n" +
            "title $($L.Title)`r`n" +
            "chcp 65001 >nul`r`n" +
            "echo ================================================`r`n" +
            "echo   $($L.Title)`r`n" +
            "echo ================================================`r`n" +
            "echo   Login first:  $($L.Hint)`r`n" +
            "echo   Type exit to leave.`r`n" +
            "echo ================================================`r`n" +
            "echo.`r`n" +
            "pushd `"%USERPROFILE%`"`r`n" +
            "`"$np\$($L.Bin)`"`r`n" +
            "popd`r`n" +
            "echo.`r`n" +
            "pause`r`n"
    $cmdPath = Join-Path $Desktop $L.File
    [System.IO.File]::WriteAllText($cmdPath, $line, [System.Text.Encoding]::Default)
    $Made += "Desk: $($L.File)"
}

# ---------- 4. Missing dev tools -> desktop shortcuts ----------
$vscode = 'C:\Program Files\Microsoft VS Code\Code.exe'
if (Test-Path $vscode) {
    New-Lnk (Join-Path $Desktop 'Visual Studio Code.lnk') $vscode '' $vscode 'Visual Studio Code'
    $Made += 'Desk: Visual Studio Code'
}

$py = 'C:\Python315\python.exe'
if (Test-Path $py) {
    New-Lnk (Join-Path $Desktop 'Python 3.15.lnk') `
        "$env:SystemRoot\System32\cmd.exe" `
        "/k `"$py`"" `
        "$env:SystemRoot\System32\shell32.dll,13" `
        'Python 3.15 interactive shell (ASCII only)'
    $Made += 'Desk: Python 3.15'
}

$nodeDir = 'C:\Program Files\nodejs'
$nodeExe = Join-Path $nodeDir 'node.exe'
if (-not (Test-Path $nodeExe)) {
    $nodeExe = (Get-ChildItem 'C:\Program Files\nodejs' -Filter 'node.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
}
if ($nodeExe -and (Test-Path $nodeExe)) {
    New-Lnk (Join-Path $Desktop 'Node.js.lnk') `
        "$env:SystemRoot\System32\cmd.exe" `
        "/k `"`"$nodeExe`"`"" `
        "$env:SystemRoot\System32\shell32.dll,13" `
        'Node.js interactive shell'
    $Made += 'Desk: Node.js'
}

$gitDir = 'C:\Program Files\Git'
if (Test-Path $gitDir) {
    New-Lnk (Join-Path $Desktop 'Git Bash.lnk') `
        "$gitDir\bin\bash.exe" `
        '--login -i' `
        "$gitDir\mingw64\share\git\git-for-windows.ico" `
        'Git Bash'
    $Made += 'Desk: Git Bash'
}

# ---------- 5. Refresh desktop so icons appear without re-login ----------
$sig = @'
using System;
using System.Runtime.InteropServices;
public class Shell32Refresh {
    [DllImport("shell32.dll")]
    public static extern void SHChangeNotify(int eventId, uint flags, IntPtr item1, IntPtr item2);
}
'@
try {
    Add-Type -TypeDefinition $sig -ErrorAction Stop
    [Shell32Refresh]::SHChangeNotify(0x08000000, 0x1000, [IntPtr]::Zero, [IntPtr]::Zero)
    $Made += 'Shell refresh signal sent'
} catch {
    $Made += "Shell refresh skipped: $($_.Exception.Message)"
}

''
'===== RESULT ====='
$Made | ForEach-Object { '  OK  ' + $_ }
''
'===== DESKTOP NOW ====='
Get-ChildItem $Desktop -Force | Sort-Object Name | ForEach-Object { '  ' + $_.Name }
