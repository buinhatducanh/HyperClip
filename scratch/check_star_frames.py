import os
import subprocess

ffmpeg = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
star_video = r"d:\LOOP_COMPANY\HyperClip\scratch\test_section_star.mp4"

# Extract frame at 0.0 of star video
subprocess.run([
    ffmpeg, "-hide_banner", "-y",
    "-ss", "0.0",
    "-i", star_video,
    "-vframes", "1",
    r"d:\LOOP_COMPANY\HyperClip\scratch\star_frame_0.jpg"
])

print("star_frame_0.jpg size:", os.path.getsize(r"d:\LOOP_COMPANY\HyperClip\scratch\star_frame_0.jpg"))
print("full_frame_0.jpg size:", os.path.getsize(r"d:\LOOP_COMPANY\HyperClip\scratch\full_frame_0.jpg"))
