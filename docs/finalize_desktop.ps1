# Finalize the desktop: put exactly the tools the user asked for, nothing extra.
# Target set: ChatGPT / Claude Code / Codex / WorkBuddy  (+ browsers they already had)
# Also: remove the "dev clutter" shortcuts I added earlier that the user found noisy.

$ErrorActionPreference = 'Continue'
$Desktop = 'C:\Users\Administrator\Desktop'
$Wsh     = New-Object -ComObject WScript.Shell
$Log     = @()

function New-Lnk {
    param($Path, $Target, $Args, $Icon, $Desc, [switch]$Force)
    if ((Test-Path $Path) -and -not $Force) { $script:Log += "skip (exists): $(Split-Path $Path -Leaf)"; return }
    $s = $Wsh.CreateShortcut($Path)
    $s.TargetPath = $Target
    if ($Args) { $s.Arguments = $Args }
    if ($Icon) { $s.IconLocation = $Icon }
    if ($Desc) { $s.Description = $Desc }
    $s.WorkingDirectory = Split-Path $Target -Parent
    $s.Save()
    $script:Log += "created: $(Split-Path $Path -Leaf)"
}

# ---------------------------------------------------------------- 1. ChatGPT
$cg = 'C:\Program Files\ChatGPT\ChatGPT.exe'
if (Test-Path $cg) {
    New-Lnk (Join-Path $Desktop 'ChatGPT.lnk') $cg '' $cg 'ChatGPT Desktop' -Force
} else { $Log += 'FAIL: ChatGPT.exe not found' }

# ---------------------------------------------------------------- 2. AI CLIs
$np = Join-Path $env:APPDATA 'npm'

$cli = @(
  @{ File='Claude Code.cmd'; Bin='claude.cmd'; Title='Claude Code';
     Hint='claude login' },
  @{ File='Codex.cmd';       Bin='codex.cmd';  Title='Codex (OpenAI)';
     Hint='codex login' },
  @{ File='WorkBuddy.cmd';   Bin='workbuddy.cmd'; Title='WorkBuddy';
     Hint='workbuddy' }
)

foreach ($L in $cli) {
    $body = "@echo off`r`n" +
            "chcp 936 >nul`r`n" +
            "title $($L.Title)`r`n" +
            "cls`r`n" +
            "echo ==========================================`r`n" +
            "echo    $($L.Title)`r`n" +
            "echo ==========================================`r`n" +
            "echo.`r`n" +
            "echo    First time login:  $($L.Hint)`r`n" +
            "echo    Type exit to quit.`r`n" +
            "echo.`r`n" +
            "echo ==========================================`r`n" +
            "echo.`r`n" +
            "cd /d `"%USERPROFILE%`"`r`n" +
            "`"$np\$($L.Bin)`"`r`n" +
            "echo.`r`n" +
            "echo [exited] press any key to close`r`n" +
            "pause >nul`r`n"
    $p = Join-Path $Desktop $L.File
    [System.IO.File]::WriteAllText($p, $body, [System.Text.Encoding]::Default)
    $Log += "created: $($L.File)"
}

# ---------------------------------------------------------------- 3. Remove dev clutter
# The user said the desktop looked messy. Drop the shortcuts added for dev tools
# that are not part of the requested "AI + browser" set.
$remove = @(
  'Git Bash.lnk',
  'Node.js.lnk',
  'Python 3.15.lnk',
  'Visual Studio Code.lnk'
)
foreach ($f in $remove) {
    $p = Join-Path $Desktop $f
    if (Test-Path $p) {
        Remove-Item $p -Force -ErrorAction SilentlyContinue
        $Log += "removed (clutter): $f"
    }
}

# Public desktop duplicates -> move real content to user desktop, then hide public
# (Chrome/Firefox/Edge/ChatGPT live in Public; Explorer merges them, that's fine)
$Log += '--- note: Chrome/Firefox/Edge come from the Public desktop (merged automatically) ---'

# ---------------------------------------------------------------- 4. Refresh
$sig = @'
using System;
using System.Runtime.InteropServices;
public class S32R {
    [DllImport("shell32.dll")]
    public static extern void SHChangeNotify(int e, uint f, IntPtr a, IntPtr b);
}
'@
try {
    Add-Type -TypeDefinition $sig -ErrorAction Stop
    [S32R]::SHChangeNotify(0x08000000, 0x1000, [IntPtr]::Zero, [IntPtr]::Zero)
    $Log += 'shell refreshed'
} catch { $Log += "refresh skipped: $($_.Exception.Message)" }

''
'===== ACTIONS ====='
$Log | ForEach-Object { '  ' + $_ }

''
'===== DESKTOP NOW ====='
$all = @()
$all += Get-ChildItem $Desktop -Force | ForEach-Object { $_.Name }
$all += Get-ChildItem 'C:\Users\Public\Desktop' -Force | ForEach-Object { $_.Name }
$all | Where-Object { $_ -ne 'desktop.ini' } | Sort-Object -Unique | ForEach-Object { '  ' + $_ }
