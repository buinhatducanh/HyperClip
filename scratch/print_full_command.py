import sys

sys.stdout.reconfigure(encoding='utf-8')

log_path = r"C:\Users\MSI\Downloads\hyperclip.log - Sao chép.2026-06-27_08-38-44"

with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        if "Spawning FFmpeg" in line:
            print("FULL COMMAND:")
            print(line.strip())
            print("-" * 80)
