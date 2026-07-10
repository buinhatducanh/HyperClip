import subprocess
import json

ps_script = """
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(2000, 100)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$font = New-Object System.Drawing.Font("Arial", 100, [System.Drawing.FontStyle]::Bold)

$chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_+=[]{}|;:',./<>?"
$widths = New-Object 'System.Collections.Generic.Dictionary[string,double]'
foreach ($c in $chars.ToCharArray()) {
    $size1 = $g.MeasureString("$c", $font)
    $size2 = $g.MeasureString("$c$c", $font)
    $w = $size2.Width - $size1.Width
    $widths["$c"] = $w / 100.0
}
$sizePad = $g.MeasureString("A", $font)
$pad = $sizePad.Width - ($widths["A"] * 100.0)
Write-Output (ConvertTo-Json $widths)
Write-Output "PADDING: $($pad / 100.0)"

$font.Dispose()
$g.Dispose()
$bmp.Dispose()
"""

cmd = ["powershell", "-NoProfile", "-Command", ps_script]
result = subprocess.run(cmd, capture_output=True, text=True)
print(result.stdout)
