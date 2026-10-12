# End-to-end verification: every desktop item the user asked for must actually work.

'===== 1. ChatGPT 桌面版 ====='
$cg = 'C:\Program Files\ChatGPT\ChatGPT.exe'
if (Test-Path $cg) {
  $v = (Get-Item $cg).VersionInfo
  '  path    : ' + $cg
  '  version : ' + $v.ProductVersion
  '  size    : ' + [math]::Round((Get-Item $cg).Length/1MB,1) + ' MB'
} else { '  NOT FOUND' }

''
'===== 2. 三个 AI 命令行工具（实测版本） ====='
$np = $env:APPDATA + '\npm'
$env:Path += ';' + $np
$tests = @(
  @{ Name='Codex';       Cmd="$np\codex.cmd" },
  @{ Name='Claude Code'; Cmd="$np\claude.cmd" },
  @{ Name='WorkBuddy';   Cmd="$np\workbuddy.cmd" }
)
foreach ($t in $tests) {
  if (Test-Path $t.Cmd) {
    $out = (& $t.Cmd --version 2>&1 | Select-Object -First 1)
    '{0,-12} {1}' -f $t.Name, $out
  } else {
    '{0,-12} MISSING' -f $t.Name
  }
}

''
'===== 3. 桌面启动器文件检查 ====='
foreach ($f in @('Claude Code.cmd','Codex.cmd','WorkBuddy.cmd')) {
  $p = Join-Path 'C:\Users\Administrator\Desktop' $f
  if (Test-Path $p) {
    $raw = [System.IO.File]::ReadAllBytes($p)
    $head = [System.Text.Encoding]::ASCII.GetString($raw[0..20])
    '{0,-20} {1,5} bytes  head={2}' -f $f, $raw.Length, ($head -replace "`r?`n",' ')
  } else { "$f MISSING" }
}

''
'===== 4. 登录状态探测 ====='
'  codex auth 目录 : ' + (Test-Path "$env:USERPROFILE\.codex")
'  claude 配置目录 : ' + (Test-Path "$env:USERPROFILE\.claude")
'  workbuddy 配置  : ' + (Test-Path "$env:USERPROFILE\.workbuddy")
