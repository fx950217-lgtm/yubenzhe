$ErrorActionPreference = "Continue"
$log = "C:\install-log.txt"
"===== Yubenzhe AI Tools Install =====" | Out-File $log -Encoding UTF8
"Start: $(Get-Date)" | Out-File -Append $log -Encoding UTF8
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

function Log($m) { "$(Get-Date -Format 'HH:mm:ss')  $m" | Out-File -Append $log -Encoding UTF8 }

Log "--- [1/9] Chrome ---"
choco install googlechrome -y --no-progress *>&1 | Out-File -Append $log -Encoding UTF8
Log "Chrome done exit=$LASTEXITCODE"

Log "--- [2/9] Firefox ---"
choco install firefox -y --no-progress *>&1 | Out-File -Append $log -Encoding UTF8
Log "Firefox done exit=$LASTEXITCODE"

Log "--- [3/9] ChatGPT Desktop ---"
choco install chatgpt -y --no-progress *>&1 | Out-File -Append $log -Encoding UTF8
Log "ChatGPT done exit=$LASTEXITCODE"

Log "--- [4/9] Node.js LTS ---"
choco install nodejs-lts -y --no-progress *>&1 | Out-File -Append $log -Encoding UTF8
Log "Node done exit=$LASTEXITCODE"

Log "--- [5/9] Git ---"
choco install git -y --no-progress *>&1 | Out-File -Append $log -Encoding UTF8
Log "Git done exit=$LASTEXITCODE"

Log "--- [6/9] Python ---"
choco install python -y --no-progress *>&1 | Out-File -Append $log -Encoding UTF8
Log "Python done exit=$LASTEXITCODE"

Log "--- [7/9] 7zip ---"
choco install 7zip -y --no-progress *>&1 | Out-File -Append $log -Encoding UTF8
Log "7zip done exit=$LASTEXITCODE"

Log "--- [8/9] VSCode ---"
choco install vscode -y --no-progress *>&1 | Out-File -Append $log -Encoding UTF8
Log "VSCode done exit=$LASTEXITCODE"

Log "--- [9/9] Notepad++ ---"
choco install notepadplusplus -y --no-progress *>&1 | Out-File -Append $log -Encoding UTF8
Log "Notepad done exit=$LASTEXITCODE"

Log ""
Log "===== RESULT SUMMARY ====="
$checks = @(
  @{n="Chrome";   p="C:\Program Files\Google\Chrome\Application\chrome.exe"},
  @{n="Firefox";  p="C:\Program Files\Mozilla Firefox\firefox.exe"},
  @{n="Node.js";  p="C:\Program Files\nodejs\node.exe"},
  @{n="Git";      p="C:\Program Files\Git\cmd\git.exe"},
  @{n="Python";   p="C:\Python313\python.exe"},
  @{n="7zip";     p="C:\Program Files\7-Zip\7z.exe"},
  @{n="VSCode";   p="C:\Program Files\Microsoft VS Code\Code.exe"},
  @{n="Notepad++";p="C:\Program Files\Notepad++\notepad++.exe"}
)
foreach ($c in $checks) {
  if (Test-Path $c.p) { Log "OK   $($c.n)" } else { Log "MISS $($c.n)" }
}

$paths = @(
  "C:\Users\Administrator\AppData\Local\ChatGPT",
  "C:\Users\Administrator\AppData\Local\Programs\ChatGPT",
  "C:\Program Files\ChatGPT"
)
$found = $false
foreach ($p in $paths) { if (Test-Path $p) { Log "OK   ChatGPT Desktop  ($p)"; $found = $true } }
if (-not $found) { Log "MISS ChatGPT Desktop" }

Log "===== Finish: $(Get-Date) ====="
"INSTALL_COMPLETE" | Out-File -Append $log -Encoding UTF8
