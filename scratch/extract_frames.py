import os
import subprocess

ffmpeg = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
input_video = r"d:\LOOP_COMPANY\HyperClip\data\media\ch1778770285853\downloads\EqWMOrNVnjU_20260625_103852.mp4"

# Extract frame at 0.0
cmd1 = [
    ffmpeg, "-hide_banner", "-y",
    "-ss", "0.0",
    "-i", input_video,
    "-vframes", "1",
    r"d:\LOOP_COMPANY\HyperClip\scratch\frame_0.jpg"
]
subprocess.run(cmd1)

# Extract frame at 5.0
cmd2 = [
    ffmpeg, "-hide_banner", "-y",
    "-ss", "5.0",
    "-i", input_video,
    "-vframes", "1",
    r"d:\LOOP_COMPANY\HyperClip\scratch\frame_5.jpg"
]
subprocess.run(cmd2)

# Extract frame at 10.0
cmd3 = [
    ffmpeg, "-hide_banner", "-y",
    "-ss", "10.0",
    "-i", input_video,
    "-vframes", "1",
    r"d:\LOOP_COMPANY\HyperClip\scratch\frame_10.jpg"
]
subprocess.run(cmd3)

print("Frames extracted:")
print("frame_0.jpg exists:", os.path.exists(r"d:\LOOP_COMPANY\HyperClip\scratch\frame_0.jpg"))
print("frame_5.jpg exists:", os.path.exists(r"d:\LOOP_COMPANY\HyperClip\scratch\frame_5.jpg"))
print("frame_10.jpg exists:", os.path.exists(r"d:\LOOP_COMPANY\HyperClip\scratch\frame_10.jpg"))
