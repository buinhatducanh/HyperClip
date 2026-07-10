import sys

sys.stdout.reconfigure(encoding='utf-8')

log_path = r"C:\Users\MSI\Downloads\hyperclip.log - Sao chép.2026-06-27_08-38-44"

with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        if "render" in line.lower() and ("done" in line.lower() or "error" in line.lower() or "fail" in line.lower() or "finish" in line.lower() or "exit" in line.lower()):
            print(line.strip()[:1000])
