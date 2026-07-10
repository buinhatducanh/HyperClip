import sys
import io

# Reconfigure stdout to use utf-8 to prevent encoding errors on Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

log_path = r"C:\Users\MSI\Downloads\hyperclip.log.2026-06-27_07-50-04"

search_terms = ["settings", "gpu", "tier", "profile", "hardware", "cpu", "detect_gpu", "nvidia"]

with open(log_path, 'r', encoding='utf-8', errors='replace') as f:
    for line_num, line in enumerate(f, 1):
        line_lower = line.lower()
        if any(term in line_lower for term in search_terms):
            print(f"{line_num}: {line.strip()[:300]}")
