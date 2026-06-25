import os
import sys
import glob

sys.stdout.reconfigure(encoding='utf-8')

project_root = r"d:\LOOP_COMPANY\HyperClip"
logs_dir = os.path.join(project_root, 'data', 'logs')

if os.path.exists(logs_dir):
    log_files = glob.glob(os.path.join(logs_dir, "*.log*"))
    if log_files:
        log_files.sort(key=os.path.getmtime)
        latest_log = log_files[-1]
        print(f"Latest log file: {latest_log}")
        with open(latest_log, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()
        print(f"Total lines: {len(lines)}")
        print("\n--- FFmpeg Spawns in Latest Log ---")
        for line in lines:
            if "Spawning FFmpeg" in line:
                print(line.strip())
    else:
        print("No log files found in data/logs/.")
else:
    print("data/logs/ does not exist.")
