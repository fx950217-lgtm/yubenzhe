# Clean duplicates: keep ONE version of each shortcut, remove the leftovers
# from the earlier naming scheme (e.g. "Codex CLI.cmd" vs "Codex.cmd").

$Desktop = 'C:\Users\Administrator\Desktop'
$Wsh = New-Object -ComObject WScript.Shell
$Log = @()

# These are the OLD names from the previous run -> delete them
$old = @('Codex CLI.cmd', 'Claude Code.cmd', 'WorkBuddy CLI.cmd', 'Microsoft Edge.lnk')
foreach ($f in $old) {
    $p = Join-Path $Desktop $f
    if (Test-Path $p) {
        # Edge already exists on the public desktop, so the user-desktop copy is redundant
        Remove-Item $p -Force -ErrorAction SilentlyContinue
        $Log += "removed: $f"
    }
}

# VSCode is not in the requested set (AI + browser) -> also drop it
$vsc = Join-Path $Desktop 'Visual Studio Code.lnk'
if (Test-Path $vsc) { Remove-Item $vsc -Force -ErrorAction SilentlyContinue; $Log += 'removed: Visual Studio Code.lnk' }

# Rebuild the three AI launchers with clean, consistent names
$np = Join-Path $env:APPDATA 'npm'
$cli = @(
  @{ File='Claude Code.cmd'; Bin='claude.cmd';    Title='Claude Code';      Hint='claude login' },
  @{ File='Codex.cmd';       Bin='codex.cmd';     Title='Codex (OpenAI)';   Hint='codex login' },
  @{ File='WorkBuddy.cmd';   Bin='workbuddy.cmd'; Title='WorkBuddy';        Hint='workbuddy' }
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
    [System.IO.File]::WriteAllText((Join-Path $Desktop $L.File), $body, [System.Text.Encoding]::Default)
    $Log += "wrote: $($L.File)"
}

# Refresh
$sig = @'
using System;
using System.Runtime.InteropServices;
public class S32R2 {
    [DllImport("shell32.dll")]
    public static extern void SHChangeNotify(int e, uint f, IntPtr a, IntPtr b);
}
'@
try {
    Add-Type -TypeDefinition $sig -ErrorAction Stop
    [S32R2]::SHChangeNotify(0x08000000, 0x1000, [IntPtr]::Zero, [IntPtr]::Zero)
} catch {}

''
'===== ACTIONS ====='
$Log | ForEach-Object { '  ' + $_ }

''
'===== FINAL DESKTOP (user + public merged) ====='
$all = @()
$all += Get-ChildItem $Desktop -Force | ForEach-Object { $_.Name }
$all += Get-ChildItem 'C:\Users\Public\Desktop' -Force | ForEach-Object { $_.Name }
$all | Where-Object { $_ -ne 'desktop.ini' } | Sort-Object -Unique | ForEach-Object { '  ' + $_ }

''
'===== SHORTCUT TARGET CHECK ====='
foreach ($f in Get-ChildItem $Desktop -Filter '*.lnk') {
  $s = $Wsh.CreateShortcut($f.FullName)
  '{0,-24} -> {1}  [{2}]' -f $f.Name, $s.TargetPath, $(if (Test-Path $s.TargetPath) {'OK'} else {'BROKEN'})
}
