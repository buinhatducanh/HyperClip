import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

log_path = r"C:\Users\MSI\Downloads\hyperclip.log - Sao chép.2026-06-27_08-38-44"

# Let's search for rendering start or FFmpeg spawning lines
print(f"Analyzing {log_path}...")
with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        if "Spawning FFmpeg" in line or "ffmpeg" in line.lower() and ("error" in line.lower() or "fail" in line.lower() or "warn" in line.lower()):
            # Print matching lines, truncated if too long
            print(line.strip()[:1000])
