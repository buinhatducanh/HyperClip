# Bottom bar overlay generator — SHORT mode 9:16
# Creates: 1080x64 opaque bar PNG (fully solid, no transparency artifacts)
#
# Layout: 1080x1920 canvas
#   y=0..383:    header overlay (from header.jpg)
#   y=384..1855: video zone
#   y=1856..1919: bottom bar  ← this PNG overlaid at y=1856

Add-Type -AssemblyName System.Drawing

$barW = 1080
$barH = 64
$text = "PART 1"

Write-Host "Bottom bar: ${barW}x${barH} PNG"

$bmp = New-Object System.Drawing.Bitmap($barW, $barH)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

# Fill with solid cyan using a brush (not the default graphics fill)
$bgColor = [System.Drawing.Color]::FromArgb(255, 0, 180, 255)
$brush = New-Object System.Drawing.SolidBrush($bgColor)
$g.FillRectangle($brush, 0, 0, $barW, $barH)
$brush.Dispose()

# Force-set ALL pixels to fully opaque (fix anti-aliasing artifacts)
$rect = New-Object System.Drawing.Rectangle(0, 0, $barW, $barH)
$bd = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$bytes = [byte[]]::new($bd.Stride * $barH)
[System.Runtime.InteropServices.Marshal]::Copy($bd.Scan0, $bytes, 0, $bytes.Length)
for ($i = 3; $i -lt $bytes.Length; $i += 4) {
    $bytes[$i] = 255  # Set alpha to 255 (fully opaque)
}
[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $bd.Scan0, $bytes.Length)
$bmp.UnlockBits($bd)

# Draw text on bar (now fully opaque background)
$fontSize = [int]($barH * 0.45)
$font = New-Object System.Drawing.Font("Arial", $fontSize, [System.Drawing.FontStyle]::Bold)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$textRect = New-Object System.Drawing.RectangleF(0, 0, $barW, $barH)
$g.DrawString($text, $font, (New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)), $textRect, $sf)

# Verify alpha
$pixel = $bmp.GetPixel(540, 0)
Write-Host "Top pixel y=0 x=540: R=$($pixel.R) G=$($pixel.G) B=$($pixel.B) A=$($pixel.A)"
$pixel2 = $bmp.GetPixel(0, 0)
Write-Host "Corner pixel y=0 x=0: R=$($pixel2.R) G=$($pixel2.G) B=$($pixel2.B) A=$($pixel2.A)"

$outPng = "D:\LOOP_COMPANY\HyperClip\_bottom_bar.png"
$bmp.Save($outPng, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
$font.Dispose()
$sf.Dispose()
Write-Host "Done: $outPng"
