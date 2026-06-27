import os
import time
import subprocess
import shutil

ffmpeg_path = r"D:\HyperClip\HyperClip-TestCustomer-20260616-224538\app\_internal\resources\ffmpeg\bin\ffmpeg.exe"
if not os.path.exists(ffmpeg_path):
    ffmpeg_path = "ffmpeg"

local_font = r"d:\LOOP_COMPANY\HyperClip\scratch\arial.ttf"
if not os.path.exists(local_font):
    shutil.copy("C:/Windows/Fonts/arial.ttf", local_font)

text = "PART 1: Konnor Griffin Highlights"
# Escape colons for FFmpeg filter parameter
escaped_text = text.replace(":", "\\:")

color_hex_ps = "#00B4FF"
color_hex_ff = "0x00B4FF"
canvas_w = 1080
bottom_bar_h = 324

# PowerShell benchmark
ps_out = r"d:\LOOP_COMPANY\HyperClip\scratch\ps_out.png"
if os.path.exists(ps_out):
    os.remove(ps_out)

ps_script = f"""
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap({canvas_w}, {bottom_bar_h})
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
$barColor = [System.Drawing.Color]::FromHtml("{color_hex_ps}")
$brush = New-Object System.Drawing.SolidBrush($barColor)
$g.FillRectangle($brush, 0, 0, {canvas_w}, {bottom_bar_h})
$brush.Dispose()
$fontSize = 48
$font = New-Object System.Drawing.Font("Arial", $fontSize, [System.Drawing.FontStyle]::Bold)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$rect = New-Object System.Drawing.RectangleF(0, 0, {canvas_w}, {bottom_bar_h})
$g.DrawString("{text}", $font, (New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)), $rect, $sf)
$g.Dispose()
$font.Dispose()
$bmp.Save("{ps_out.replace('\\\\', '/')}", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
"""

start_ps = time.perf_counter()
ps_cmd = ["powershell", "-NoProfile", "-Command", ps_script]
result_ps = subprocess.run(ps_cmd, capture_output=True)
dur_ps = time.perf_counter() - start_ps
print(f"PowerShell duration: {dur_ps:.3f} seconds (Success: {os.path.exists(ps_out)})")

# FFmpeg drawtext benchmark
ff_out = r"d:\LOOP_COMPANY\HyperClip\scratch\ff_out.png"
if os.path.exists(ff_out):
    os.remove(ff_out)

start_ff = time.perf_counter()
ff_cmd = [
    ffmpeg_path,
    "-hide_banner", "-y",
    "-f", "lavfi",
    "-i", f"color=c={color_hex_ff}:s={canvas_w}x{bottom_bar_h}:d=0.04",
    "-vf", f"drawtext=fontfile='scratch/arial.ttf':text='{escaped_text}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2",
    "-vframes", "1",
    ff_out
]
result_ff = subprocess.run(ff_cmd, capture_output=True, text=True)
dur_ff = time.perf_counter() - start_ff
print(f"FFmpeg drawtext duration: {dur_ff:.3f} seconds (Success: {os.path.exists(ff_out)})")
if not os.path.exists(ff_out):
    print("FFmpeg error:", result_ff.stderr)
