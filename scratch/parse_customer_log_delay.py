import sys

sys.stdout.reconfigure(encoding='utf-8')

log_path = r"C:\Users\MSI\Downloads\hyperclip.log.2026-06-27_07-50-04"

search_terms = ["MLB Highlights", "Konnor Griffin", "ch-"]
matches = []

with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
    for idx, line in enumerate(f):
        if any(term in line for term in search_terms[:2]):
            matches.append((idx + 1, line.strip()))

print(f"Found {len(matches)} occurrences:")
for line_num, line in matches:
    print(f"[Line {line_num}] {line}")
