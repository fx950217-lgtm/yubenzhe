# Chrome UI language: the real switch is Preferences -> intl.app_locale
# (NOT Local State -> intl.app_locale, which only seeds the first run).
# Our earlier test proved it: with --lang=zh-CN, Preferences got
# selected_languages=zh-CN,zh but app_locale stayed EMPTY -> UI stayed English.
#
# So: patch BOTH files, and set app_locale explicitly.

$ErrorActionPreference = 'Continue'
$Log = @()

$ud   = "$env:LOCALAPPDATA\Google\Chrome\User Data"
$ls   = Join-Path $ud 'Local State'
$pref = Join-Path $ud 'Default\Preferences'

# ---------------------------------------------------------------- 0. stop chrome
$procs = Get-Process chrome -ErrorAction SilentlyContinue
if ($procs) {
  $procs | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
  $Log += "stopped $($procs.Count) chrome processes"
}

# ---------------------------------------------------------------- 1. backup both
foreach ($f in @($ls, $pref)) {
  if (Test-Path $f) {
    $bak = "$f.bak-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
    Copy-Item $f $bak -Force
    $Log += 'backed up: ' + (Split-Path $f -Leaf)
  }
}

# ---------------------------------------------------------------- 2. helper
function Set-ChromeIntl {
    param([string]$Path, [switch]$Create)
    if (-not (Test-Path $Path)) {
        if (-not $Create) { return 'file not found' }
    }
    try {
        if (Test-Path $Path) {
            $j = Get-Content $Path -Raw -Encoding UTF8 | ConvertFrom-Json
        } else {
            $j = New-Object PSObject
        }

        $intl = [PSCustomObject][ordered]@{
            app_locale         = 'zh-CN'
            selected_languages = 'zh-CN,zh,en-US,en'
            accept_languages   = 'zh-CN,zh,en-US,en'
            requested_language = 'zh-CN'
            country            = 'CN'
            spellcheck_dictionaries = @('zh-CN')
        }

        if ($j.PSObject.Properties.Name -contains 'intl') {
            $j.intl = $intl
        } else {
            $j | Add-Member -NotePropertyName 'intl' -NotePropertyValue $intl -Force
        }

        $out = $j | ConvertTo-Json -Depth 40
        # UTF-8 without BOM: Chrome chokes on a BOM
        [System.IO.File]::WriteAllText($Path, $out, (New-Object System.Text.UTF8Encoding($false)))
        return 'ok'
    } catch {
        return 'FAIL: ' + $_.Exception.Message
    }
}

# ---------------------------------------------------------------- 3. patch
'===== 写入 Local State ====='
$r1 = Set-ChromeIntl -Path $ls -Create
'  ' + $r1
$Log += 'Local State: ' + $r1

'===== 写入 Preferences ====='
$r2 = Set-ChromeIntl -Path $pref -Create
'  ' + $r2
$Log += 'Preferences: ' + $r2

# ---------------------------------------------------------------- 4. rebrand shortcut with --lang
'===== 给桌面快捷方式加 --lang=zh-CN ====='
$w = New-Object -ComObject WScript.Shell
$targets = @(
  "$env:USERPROFILE\Desktop\Google Chrome.lnk",
  'C:\Users\Public\Desktop\Google Chrome.lnk',
  "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Google Chrome.lnk"
)
foreach ($t in $targets) {
  if (Test-Path $t) {
    try {
      $s = $w.CreateShortcut($t)
      if ($s.Arguments -notlike '*--lang=zh-CN*') {
        # keep existing args (usually --profile-directory="Default")
        $s.Arguments = ($s.Arguments + ' --lang=zh-CN').Trim()
        $s.Save()
        $Log += 'shortcut patched: ' + (Split-Path $t -Leaf) + '  args=[' + $s.Arguments + ']'
      } else {
        $Log += 'shortcut already had --lang: ' + (Split-Path $t -Leaf)
      }
    } catch { $Log += 'shortcut FAIL ' + (Split-Path $t -Leaf) + ': ' + $_.Exception.Message }
  }
}

''
'===== ACTIONS ====='
$Log | ForEach-Object { '  ' + $_ }

''
'===== 回读验证 ====='
foreach ($f in @($ls, $pref)) {
  if (Test-Path $f) {
    $j = Get-Content $f -Raw -Encoding UTF8 | ConvertFrom-Json
    '  ' + (Split-Path $f -Leaf)
    '     app_locale         = [' + $j.intl.app_locale + ']'
    '     selected_languages = [' + ($j.intl.selected_languages -join ', ') + ']'
  }
}
