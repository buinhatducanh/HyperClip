import re
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

log_path = r"C:\Users\MSI\Downloads\hyperclip.log - Sao chép.2026-06-27_10-48-43"
target_id = "ws-ch-1782558828285"

print(f"Searching logs for video ID: q5X4zQJUlGA")

with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
    for line in f:
        clean_line = re.sub(r'\x1b\[[0-9;]*m', '', line).strip()
        if "q5X4zQJUlGA" in clean_line:
            print(clean_line)
