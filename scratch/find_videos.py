import os
import sys
import glob

sys.stdout.reconfigure(encoding='utf-8')

project_root = r"d:\LOOP_COMPANY\HyperClip"
data_dir = os.path.join(project_root, 'data')
pattern = os.path.join(data_dir, "**", "*.mp4")
files = glob.glob(pattern, recursive=True)
print("MP4 files in data directory:")
for f in files:
    try:
        print(f"  {f} (size: {os.path.getsize(f)} bytes)")
    except Exception as e:
        print(f"  Error reading {f}: {e}")
