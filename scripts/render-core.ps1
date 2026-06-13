# UTF-8 BOM + encoding so Vietnamese text renders correctly in GDI+
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$PSDefaultParameterValues['*:Encoding'] = 'utf8'

param(
    [string]$Video,
    [string]$Blur,
    [string]$Header,
    [string]$Output,
    [string]$Text = "PART 1",
    [int]$Duration = 30,
    [int]$CanvasW = 1080,
    [int]$CanvasH = 1920,
    [string]$Preset = "ultrafast",
    [int]$CRF = 22
)

Add-Type -AssemblyName System.Drawing

$HEADER_PCT = 0.20
$BOTTOM_PCT = 0.10
$VIDEO_PCT = 1 - $HEADER_PCT - $BOTTOM_PCT

$headerH = [int]($CanvasH * $HEADER_PCT)
$bottomH  = [int]($CanvasH * $BOTTOM_PCT)
$videoH   = $CanvasH - $headerH - $bottomH
$bottomBarY = $headerH + $videoH
$fontSize = [Math]::Max(24, [int]($bottomH * 0.25))

Write-Host "Core Render SHORT: ${CanvasW}x${CanvasH} Header=$headerH Video=$videoH Bottom=$bottomH"

# Bottom bar PNG
$barPng = Join-Path $env:TEMP "bottom_bar_overlay.png"
$bmp = New-Object System.Drawing.Bitmap($CanvasW, $bottomH)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 0, 180, 255))
$g.FillRectangle($brush, 0, 0, $CanvasW, $bottomH)
$brush.Dispose()
$font = New-Object System.Drawing.Font("Arial", $fontSize, [System.Drawing.FontStyle]::Bold)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$rect = New-Object System.Drawing.RectangleF(0, 0, $CanvasW, $bottomH)
$g.DrawString($Text, $font, (New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)), $rect, $sf)
$g.Dispose()
$font.Dispose()
$sf.Dispose()
$r = New-Object System.Drawing.Rectangle(0, 0, $CanvasW, $bottomH)
$bd = $bmp.LockBits($r, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$bytes = [byte[]]::new($bd.Stride * $bottomH)
[System.Runtime.InteropServices.Marshal]::Copy($bd.Scan0, $bytes, 0, $bytes.Length)
for ($i = 3; $i -lt $bytes.Length; $i += 4) { $bytes[$i] = 255 }
[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $bd.Scan0, $bytes.Length)
$bmp.UnlockBits($bd)
$bmp.Save($barPng, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "PNG: $barPng"

$cropX = [Math]::Round(([Math]::Round($videoH * 16 / 9) - $CanvasW) / 2)

$filter = "[0:v]fps=30,setpts=PTS-STARTPTS,scale=-2:$videoH,crop=$CanvasW`:$videoH`:$cropX`:0[vid];" +
          "[1:v]scale=$CanvasW`:$CanvasH`:force_original_aspect_ratio=increase,crop=$CanvasW`:$CanvasH`:(ow-iw)/2:(oh-ih)/2,setsar=1[bg];" +
          "[2:v]scale=$CanvasW`:$headerH`:force_original_aspect_ratio=increase,crop=$CanvasW`:$headerH`:(ow-iw)/2:(oh-ih)/2,setsar=1[hd];" +
          "[bg][vid]overlay=0`:$headerH[vz];" +
          "[vz][hd]overlay=0`:0[fh];" +
          "[3:v]null[bb];" +
          "[fh][bb]overlay=0`:$bottomBarY[final]"

$ffmpeg = if (Test-Path (Join-Path $PSScriptRoot "..\resources\ffmpeg\bin\ffmpeg.exe")) {
    Join-Path $PSScriptRoot "..\resources\ffmpeg\bin\ffmpeg.exe"
} elseif (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
    (Get-Command ffmpeg).Source
} else {
    "C:\Program Files\Agent\dlls\x64\ffmpeg.exe"
}
$args = @("-threads","8","-avoid_negative_ts","make_zero",
    "-i",$Video,"-loop","1","-i",$Blur,"-i",$Header,"-i",$barPng,
    "-filter_complex",$filter,
    "-map","[final]","-map","0:a",
    "-c:v","libx264","-preset",$Preset,"-crf","$CRF",
    "-c:a","aac","-b:a","192k","-r","30","-t","$Duration","-y",$Output)

Write-Host "Rendering..."
$proc = Start-Process -FilePath $ffmpeg -ArgumentList $args -NoNewWindow -Wait -PassThru

if ($proc.ExitCode -eq 0 -and (Test-Path $Output)) {
    $mb = [math]::Round((Get-Item $Output).Length / 1MB, 1)
    Write-Host "SUCCESS: $Output ($mb MB)"
} else {
    Write-Host "FAILED (exit $($proc.ExitCode))"
}
