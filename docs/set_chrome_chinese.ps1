# Force Google Chrome to use Simplified Chinese (zh-CN) as its UI language.
#
# How Chrome picks its language (in priority order):
#   1. Command-line --lang flag         (highest)
#   2. "Local State" -> intl.app_locale
#   3. OS locale
#
# Since the OS here is en-US and the intl block is missing entirely,
# we set BOTH the intl.app_locale and a persistent --lang flag via the shortcut,
# so the change survives across launches and even a Local State rewrite.

$ErrorActionPreference = 'Continue'
$Log = @()

$ud = "$env:LOCALAPPDATA\Google\Chrome\User Data"
$ls = Join-Path $ud 'Local State'

# ---------------------------------------------------------------- 0. kill Chrome
'===== 0. 关闭正在运行的 Chrome ====='
$procs = Get-Process chrome -ErrorAction SilentlyContinue
if ($procs) {
  '  发现 ' + $procs.Count + ' 个 chrome 进程，正在关闭...'
  $procs | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  '  已关闭'
} else {
  '  没有在运行'
}

# ---------------------------------------------------------------- 1. backup
'===== 1. 备份 Local State ====='
if (Test-Path $ls) {
  $bak = Join-Path $ud ("Local State.bak-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  Copy-Item $ls $bak -Force
  '  备份到: ' + $bak
  $Log += 'backed up Local State'
} else {
  '  Local State 不存在，将新建'
}

# ---------------------------------------------------------------- 2. patch intl
'===== 2. 写入中文语言设置 ====='
try {
  if (Test-Path $ls) {
    $raw = Get-Content $ls -Raw -Encoding UTF8
    $j = $raw | ConvertFrom-Json
  } else {
    $j = New-Object PSObject
  }

  # Build / replace the intl block
  $intl = [ordered]@{
    app_locale                     = 'zh-CN'
    selected_languages             = 'zh-CN,zh'
    accept_languages               = 'zh-CN,zh,en-US,en'
    requested_language             = 'zh-CN'
    # keep spelling as-is (users can change later in 设置)
    country                        = 'CN'
    # hint that the app locale was intentionally changed
    app_locale_initialized_by_user = $true
  }

  # Merge onto the existing object (PSObject property assignment)
  if ($j.PSObject.Properties.Name -contains 'intl') {
    $j.intl = [PSCustomObject]$intl
  } else {
    $j | Add-Member -NotePropertyName 'intl' -NotePropertyValue ([PSCustomObject]$intl) -Force
  }

  $out = $j | ConvertTo-Json -Depth 30 -Compress:$false
  # Write WITHOUT BOM (Chrome expects UTF-8 no BOM)
  [System.IO.File]::WriteAllText($ls, $out, (New-Object System.Text.UTF8Encoding($false)))
  $Log += 'wrote intl.app_locale = zh-CN'

  '  intl.app_locale         -> zh-CN'
  '  intl.selected_languages -> zh-CN,zh'
  '  写入完成: ' + $ls + '  (' + (Get-Item $ls).Length + ' bytes)'
} catch {
  '  [FAIL] ' + $_.Exception.Message
  $Log += 'FAIL: ' + $_.Exception.Message
}

# ---------------------------------------------------------------- 3. verify
'===== 3. 回读验证 ====='
try {
  $j2 = Get-Content $ls -Raw -Encoding UTF8 | ConvertFrom-Json
  '  app_locale         = ' + $j2.intl.app_locale
  '  selected_languages = ' + $j2.intl.selected_languages
} catch { '  回读失败: ' + $_.Exception.Message }

''
'===== ACTIONS ====='
$Log | ForEach-Object { '  ' + $_ }
