import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8')

ffmpeg_exe = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
video_path = r"D:\LOOP_COMPANY\HyperClip\data\media\Zilk Kay\downloads\8fAExeJIbKQ_20260627_005956.mp4"
out_path = r"d:\LOOP_COMPANY\HyperClip\scratch\test_crop.mp4"

# Attempting decoder-level crop with standard h264 decoder + hwaccel cuda
cmd = [
    ffmpeg_exe, "-y",
    "-init_hw_device", "cuda=cuda",
    "-hwaccel", "cuda", "-hwaccel_output_format", "cuda",
    "-crop", "0x0x95x95",  # Top x Bottom x Left x Right
    "-i", video_path,
    "-t", "2",
    out_path
]

print("Executing FFmpeg...")
res = subprocess.run(cmd, capture_output=True, text=True)

print(f"Exit code: {res.returncode}")
print("\n--- FFmpeg Stderr Output ---")
print(res.stderr)
