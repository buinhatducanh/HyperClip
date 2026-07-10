import os
import subprocess

ffmpeg_path = r"D:\HyperClip\HyperClip-TestCustomer-20260616-224538\app\_internal\resources\ffmpeg\bin\ffmpeg.exe"
if not os.path.exists(ffmpeg_path):
    ffmpeg_path = "ffmpeg"

output_path = r"d:\LOOP_COMPANY\HyperClip\scratch\test_drawtext_out.png"
if os.path.exists(output_path):
    os.remove(output_path)

# Direct path to system font with escaped colon for ffmpeg
escaped_font_path = "C\\:/Windows/Fonts/arial.ttf"

cmd = [
    ffmpeg_path,
    "-hide_banner", "-y",
    "-f", "lavfi",
    "-i", "color=c=blue:s=1080x324:d=0.04",
    "-vf", f"drawtext=fontfile='{escaped_font_path}':text='TEST BOTTOM BAR TITLE':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2",
    "-vframes", "1",
    output_path
]

print("Running command:", " ".join(cmd))
result = subprocess.run(cmd, capture_output=True, text=True)
print("Exit code:", result.returncode)
if os.path.exists(output_path):
    print("Success! Created output file at:", output_path)
else:
    print("Failed to create output file.")
    print("Stderr:", result.stderr)
