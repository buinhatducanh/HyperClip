import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

log_path = r"C:\Users\MSI\Downloads\hyperclip.log.2026-06-27_20-44-20"

print("Searching for warnings, errors, or lag indications in log...")

with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
    for line in f:
        clean_line = re.sub(r'\x1b\[[0-9;]*m', '', line).strip()
        
        # Look for warnings, errors, or lag/drop stats
        lower_line = clean_line.lower()
        if any(w in lower_line for w in ["warn", "error", "lag", "drop", "dup", "stutter", "sync"]):
            # Filter out poller lease client warnings as they are very noisy and unrelated
            if "failed to acquire session or lease client" not in clean_line:
                print(clean_line)
