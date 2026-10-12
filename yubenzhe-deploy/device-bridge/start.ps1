
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
$base=Split-Path -Parent $MyInvocation.MyCommand.Path
$state=Join-Path $base 'device-state.json'
$pidPath=Join-Path $base 'connector.pid'
if(Test-Path -LiteralPath $pidPath){
 $running=Get-Process -Id ([int](Get-Content -LiteralPath $pidPath)) -ErrorAction SilentlyContinue
 if($running -and $running.Path -eq (Join-Path $base 'node.exe')){[System.Windows.Forms.MessageBox]::Show('YBZ connector is already running. Use the tray icon to stop.');exit}
}
if(-not (Test-Path -LiteralPath $state)){
 $dialog=New-Object System.Windows.Forms.OpenFileDialog
 $dialog.Title='Select the YBZ device pairing JSON downloaded from your account'
 $dialog.Filter='JSON files (*.json)|*.json'
 if($dialog.ShowDialog() -ne 'OK'){exit}
 Copy-Item -LiteralPath $dialog.FileName -Destination $state
}
$log=Join-Path $base 'connector.log'
$err=Join-Path $base 'connector-error.log'
$argsList=@(('"'+(Join-Path $base 'agent.mjs')+'"'),('"'+$state+'"'))
$p=Start-Process -FilePath (Join-Path $base 'node.exe') -ArgumentList $argsList -WorkingDirectory $base -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $err -PassThru
Set-Content -LiteralPath $pidPath -Value $p.Id
[System.Windows.Forms.MessageBox]::Show('YBZ connector started. Keep your computer awake. Use the tray menu or Stop connector to disconnect.')
