# scratch/test_single_ffmpeg.py
import os
import subprocess
import time

ffmpeg_path = r"D:\HyperClip\HyperClip-TestCustomer-20260616-224538\app\_internal\resources\ffmpeg\bin\ffmpeg.exe"
if not os.path.exists(ffmpeg_path):
    ffmpeg_path = "ffmpeg"

thumbnail_path = r"d:\LOOP_COMPANY\HyperClip\data\media\BadyNone\thumbnails\6jDjzPyuWmI.jpg"

canvas_w = 1080
canvas_h = 1920
header_h = 576
bottom_bar_h = 576
bottom_bar_y = canvas_h - bottom_bar_h

# Special characters: colon, comma, single quote, percent, backslash
text = "Part 1: Konnor's % dynamic, and \\ cool title!"
font_size = 36
color_hex = "0x00B4FF"

# Let's escape text for FFmpeg drawtext:
# Inside single quotes:
# Backslashes must be escaped: \ -> \\
# Single quotes must be escaped: ' -> '\''
# Colons must be escaped: : -> \:
# Percent must be escaped: % -> \%
# Commas must be escaped: , -> \,
escaped_text = ""
for c in text:
    if c == ':':
        escaped_text += "\\:"
    elif c == "'":
        escaped_text += "'\\''"
    elif c == '\\':
        escaped_text += "\\\\"
    elif c == '%':
        escaped_text += "\\%"
    elif c == ',':
        escaped_text += "\\,"
    else:
        escaped_text += c

font_path = "C\\:/Windows/Fonts/arialbd.ttf"

out_single = r"d:\LOOP_COMPANY\HyperClip\scratch\composite_special_chars.png"
if os.path.exists(out_single):
    os.remove(out_single)

filter_complex = (
    f"color=c={color_hex}:s={canvas_w}x{bottom_bar_h}:d=1[bar_bg]; "
    f"[bar_bg]drawtext=fontfile='{font_path}':text='{escaped_text}':fontcolor=white:fontsize={font_size}:x=(w-text_w)/2:y=(h-text_h)/2[bar]; "
    f"[0:v]scale=32:18:flags=bilinear,scale={canvas_w}:{canvas_h}:flags=bilinear[blur]; "
    f"[0:v]scale={canvas_w}:{header_h}:force_original_aspect_ratio=increase,crop={canvas_w}:{header_h}:(ow-iw)/2:(oh-ih)/2,setsar=1[hd]; "
    f"[blur][hd]overlay=x=0:y=0[v1]; "
    f"[v1][bar]overlay=x=0:y={bottom_bar_y},format=nv12[final]"
)
cmd = [
    ffmpeg_path, "-hide_banner", "-y",
    "-i", thumbnail_path,
    "-filter_complex", filter_complex,
    "-map", "[final]", "-vframes", "1",
    out_single
]

result = subprocess.run(cmd, capture_output=True, text=True)
if os.path.exists(out_single):
    print("Success rendering special characters!")
else:
    print("FFmpeg error:", result.stderr)
