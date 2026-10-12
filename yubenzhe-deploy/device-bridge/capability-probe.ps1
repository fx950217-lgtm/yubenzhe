$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class YbzDesktopProbe {
 [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
 [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr desktop);
}
'@
$handle=[YbzDesktopProbe]::OpenInputDesktop(0,$false,0x0001)
$interactive=$handle -ne [IntPtr]::Zero
$capture=$false
if($interactive){
 [void][YbzDesktopProbe]::CloseDesktop($handle)
 $bitmap=$null;$graphics=$null
 try{
  $bounds=[System.Windows.Forms.SystemInformation]::VirtualScreen
  if($bounds.Width -gt 0 -and $bounds.Height -gt 0){
   $bitmap=New-Object System.Drawing.Bitmap(1,1)
   $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
   $graphics.CopyFromScreen($bounds.Left,$bounds.Top,0,0,$bitmap.Size)
   $capture=$true
  }
 }catch{}finally{if($graphics){$graphics.Dispose()};if($bitmap){$bitmap.Dispose()}}
}
@{interactive=$interactive;capture=$capture}|ConvertTo-Json -Compress
