import sys

sys.stdout.reconfigure(encoding='utf-8')

log_path = r"C:\Users\MSI\Downloads\hyperclip.log - Sao chép.2026-06-27_08-38-44"

lines_count = 0
with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        lines_count += 1
        if "done" in line.lower() or "error" in line.lower() or "crashed" in line.lower() or "status" in line.lower() or "progress" in line.lower():
            if lines_count < 100 or "render" in line.lower() or "ffmpeg" in line.lower():
                print(f"Line {lines_count}: {line.strip()[:1000]}")

print(f"Total lines: {lines_count}")
