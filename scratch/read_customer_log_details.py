import os

log_path = r"C:\Users\MSI\Downloads\hyperclip.log - Sao chép.2026-06-27_21-54-46"
out_path = r"d:\LOOP_COMPANY\HyperClip\scratch\customer_log_details.txt"

if not os.path.exists(log_path):
    print("Log file not found at:", log_path)
    exit(1)

with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
    lines = f.readlines()

out_lines = []
for idx, line in enumerate(lines):
    if "12:55:" in line:
        time_part = line.split("T")[1][:8]
        if "12:55:20" <= time_part <= "12:55:35":
            out_lines.append(f"[Line {idx+1}] {line.strip()}")

with open(out_path, 'w', encoding='utf-8') as f:
    f.write('\n'.join(out_lines))

print(f"Extracted {len(out_lines)} lines to {out_path}")
