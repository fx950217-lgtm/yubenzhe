
param([string]$StopFile)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class YbzDpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }
'@
[void][YbzDpi]::SetProcessDPIAware()

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class YbzInput {
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint data,UIntPtr extra);
 [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint f,UIntPtr extra);
 [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION u; }
 [StructLayout(LayoutKind.Explicit)] public struct UNION {
  [FieldOffset(0)] public MOUSE mi;
  [FieldOffset(0)] public KEY ki;
 }
 [StructLayout(LayoutKind.Sequential)] public struct MOUSE {public int x,y;public uint data,flags,time;public UIntPtr extra;}
 [StructLayout(LayoutKind.Sequential)] public struct KEY {public ushort vk,scan;public uint flags,time;public UIntPtr extra;}
 [DllImport("user32.dll")] public static extern uint SendInput(uint n,INPUT[] data,int size);
 public static void TypeText(string text) {
  foreach(char c in text) {
   INPUT a=new INPUT(); a.type=1; a.u.ki.scan=c; a.u.ki.flags=4;
   INPUT b=a; b.u.ki.flags=6;
   INPUT[] items=new INPUT[]{a,b};
   if(SendInput(2,items,Marshal.SizeOf(typeof(INPUT)))!=2)throw new Exception("Input blocked");
  }
 }
 public static void Key(byte key, bool ctrl) {
  if(ctrl)keybd_event(17,0,0,UIntPtr.Zero);
  keybd_event(key,0,0,UIntPtr.Zero);keybd_event(key,0,2,UIntPtr.Zero);
  if(ctrl)keybd_event(17,0,2,UIntPtr.Zero);
 }
}
'@
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$script:stopping=$false
$tray=New-Object System.Windows.Forms.NotifyIcon
$tray.Icon=[System.Drawing.SystemIcons]::Application
$tray.Text='YBZ - connected, screen idle'
$menu=New-Object System.Windows.Forms.ContextMenuStrip
$item=$menu.Items.Add('Stop and exit YBZ connector')
$item.add_Click({$script:stopping=$true})
$tray.ContextMenuStrip=$menu
$tray.Visible=$true
$sharing=$false
try {
 while(-not $script:stopping) {
  $reading=[Console]::In.ReadLineAsync()
  while(-not $reading.IsCompleted -and -not $script:stopping) {
   [System.Windows.Forms.Application]::DoEvents()
   if($StopFile -and (Test-Path -LiteralPath $StopFile)){$script:stopping=$true}
   Start-Sleep -Milliseconds 25
  }
  if($script:stopping){[Console]::Out.WriteLine('{"stopped":true}');break}
  $line=$reading.Result
  if($null -eq $line){break}
  try{
   $cmd=$line | ConvertFrom-Json
   if($cmd.kind -eq 'idle'){
    $sharing=$false;$tray.Text='YBZ - connected, screen idle'
    [Console]::Out.WriteLine('{"ok":true}');continue
   }
   if(-not $sharing){$sharing=$true;$tray.Text='YBZ - REMOTE CONTROL ACTIVE';$tray.ShowBalloonTip(4000,'YBZ remote control','Your screen is being shared. Use the tray menu to stop.',[System.Windows.Forms.ToolTipIcon]::Info)}
   $bounds=[System.Windows.Forms.SystemInformation]::VirtualScreen
   if($cmd.kind -eq 'screen'){
    $source=New-Object System.Drawing.Bitmap($bounds.Width,$bounds.Height)
    $g=[System.Drawing.Graphics]::FromImage($source)
    $g.CopyFromScreen($bounds.Left,$bounds.Top,0,0,$bounds.Size)
    $scale=[Math]::Min(1.0,1280.0/[Math]::Max($bounds.Width,$bounds.Height))
    $width=[Math]::Max(1,[int]($bounds.Width*$scale));$height=[Math]::Max(1,[int]($bounds.Height*$scale))
    $small=New-Object System.Drawing.Bitmap($width,$height)
    $sg=[System.Drawing.Graphics]::FromImage($small)
    $sg.DrawImage($source,0,0,$width,$height)
    $stream=New-Object System.IO.MemoryStream
    $encoder=[System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object {$_.MimeType -eq 'image/jpeg'}
    $parameters=New-Object System.Drawing.Imaging.EncoderParameters(1)
    $parameters.Param[0]=New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality,([long]45))
    $small.Save($stream,$encoder,$parameters)
    $result=@{ok=$true;image='data:image/jpeg;base64,'+[Convert]::ToBase64String($stream.ToArray())}
    $g.Dispose();$sg.Dispose();$source.Dispose();$small.Dispose();$stream.Dispose();$parameters.Dispose()
    [Console]::Out.WriteLine(($result|ConvertTo-Json -Compress));continue
   }
   if($cmd.kind -in @('click','doubleclick','rightclick')){
    $x=$bounds.Left+[int]([Math]::Min(1.0,[Math]::Max(0.0,[double]$cmd.x))*($bounds.Width-1))
    $y=$bounds.Top+[int]([Math]::Min(1.0,[Math]::Max(0.0,[double]$cmd.y))*($bounds.Height-1))
    [void][YbzInput]::SetCursorPos($x,$y)
    $down=2;$up=4;if($cmd.kind -eq 'rightclick'){$down=8;$up=16}
    [YbzInput]::mouse_event($down,0,0,0,[UIntPtr]::Zero);[YbzInput]::mouse_event($up,0,0,0,[UIntPtr]::Zero)
    if($cmd.kind -eq 'doubleclick'){Start-Sleep -Milliseconds 80;[YbzInput]::mouse_event($down,0,0,0,[UIntPtr]::Zero);[YbzInput]::mouse_event($up,0,0,0,[UIntPtr]::Zero)}
   } elseif($cmd.kind -eq 'text'){
    if([string]$cmd.text -and $cmd.text.Length -le 500){[System.Windows.Forms.Clipboard]::SetText([string]$cmd.text,[System.Windows.Forms.TextDataFormat]::UnicodeText);[YbzInput]::Key(86,$true)}
   } elseif($cmd.kind -eq 'key'){
    $keymap=@{Enter=13;Backspace=8;Tab=9;Escape=27;ArrowUp=38;ArrowDown=40;ArrowLeft=37;ArrowRight=39;Space=32;Delete=46;Home=36;End=35;PageUp=33;PageDown=34;'Ctrl+C'=67;'Ctrl+V'=86;'Ctrl+A'=65;'Ctrl+Z'=90}
    if(-not $keymap.ContainsKey([string]$cmd.key)){throw 'Unsupported key'}
    [YbzInput]::Key([byte]$keymap[[string]$cmd.key],([string]$cmd.key).StartsWith('Ctrl+'))
   } elseif($cmd.kind -eq 'scroll'){
    if([int]$cmd.delta -notin @(-3,-1,1,3)){throw 'Unsupported scroll'}
    $wheel=[BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$cmd.delta*120),0)
    [YbzInput]::mouse_event(2048,0,0,$wheel,[UIntPtr]::Zero)
   } else {throw 'Unsupported command'}
   [Console]::Out.WriteLine('{"ok":true}')
  }catch{[Console]::Out.WriteLine('{"ok":false,"code":"DESKTOP_UNAVAILABLE"}')}
 }
}finally{$tray.Visible=$false;$tray.Dispose()}
