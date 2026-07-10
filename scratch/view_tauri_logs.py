import os
import tempfile
import glob

APPDATA = os.environ.get('APPDATA') or tempfile.gettempdir()
log_dir = os.path.join(APPDATA, '.hyperclip', 'logs')
print(f"Log directory: {log_dir}")

log_files = glob.glob(os.path.join(log_dir, "*.log"))
if log_files:
    latest_log = max(log_files, key=os.path.getmtime)
    print(f"Latest log: {latest_log}")
    with open(latest_log, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    # Print lines containing "Spawning FFmpeg"
    for line in lines[-200:]:
        if "Spawning FFmpeg" in line or "Error" in line or "crashed" in line:
            print(line.strip())
else:
    print("No log files found")
