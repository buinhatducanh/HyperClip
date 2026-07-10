import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

logs_dir = r"d:\LOOP_COMPANY\HyperClip\data\logs"
print("Searching all tauri logs...")
for fn in os.listdir(logs_dir):
    fp = os.path.join(logs_dir, fn)
    if os.path.isfile(fp):
        with open(fp, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                if "EqWMOrNVnjU" in line and "yt-dlp" in line:
                    print(f"{fn}: {line.strip()}")
