from PIL import Image
import subprocess
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

ffmpeg_exe = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
video_path = r"d:\LOOP_COMPANY\HyperClip\scratch\test_stutter.mp4"
out_dir = r"d:\LOOP_COMPANY\HyperClip\scratch\extracted_frames"
os.makedirs(out_dir, exist_ok=True)

# Extract 5 frames from the middle of the video (around 2s-3s)
cmd = [
    ffmpeg_exe, "-y",
    "-ss", "2.0",
    "-i", video_path,
    "-vframes", "5",
    os.path.join(out_dir, "frame_%d.png")
]
subprocess.run(cmd, capture_output=True)

# Let's inspect the files
for f in os.listdir(out_dir):
    if f.endswith(".png"):
        img_path = os.path.join(out_dir, f)
        img = Image.open(img_path)
        # Check standard statistics
        print(f"File: {f}, Size: {img.size}, Mode: {img.mode}")
        # Check if the video area is solid black or static
        # Let's save a crop of the video area
        crop_area = img.crop((100, 400, 600, 800))
        crop_area.save(os.path.join(out_dir, "crop_" + f))
        print(f"Saved crop for {f}")
