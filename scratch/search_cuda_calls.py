import sys

sys.stdout.reconfigure(encoding='utf-8')

filepath = r"d:\LOOP_COMPANY\HyperClip\crates\hyperclip_ipc\src\ffmpeg.rs"

with open(filepath, "r", encoding="utf-8") as f:
    for idx, line in enumerate(f, 1):
        if "build_short_filter_cuda" in line or "build_landscape_filter_cuda" in line:
            print(f"Line {idx}: {line.strip()}")
