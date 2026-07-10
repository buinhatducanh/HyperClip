import sys

sys.stdout.reconfigure(encoding='utf-8')

log_path = r"C:\Users\MSI\Downloads\hyperclip.log - Sao chép.2026-06-27_08-38-44"

with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        if "hardware" in line.lower() or "vram" in line.lower() or "gpu" in line.lower() or "preset" in line.lower():
            if "spawning ffmpeg" not in line.lower() and "ffmpeg progress" not in line.lower():
                print(line.strip()[:1000])
