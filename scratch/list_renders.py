import os
import sys
import glob
import datetime

sys.stdout.reconfigure(encoding='utf-8')

project_root = r"d:\LOOP_COMPANY\HyperClip"
renders_dir = os.path.join(project_root, 'data', 'renders')

print("Files in data/renders/:")
if os.path.exists(renders_dir):
    files = glob.glob(os.path.join(renders_dir, "**", "*"), recursive=True)
    for f in files:
        if os.path.isfile(f):
            mtime = os.path.getmtime(f)
            dt = datetime.datetime.fromtimestamp(mtime)
            print(f"  {f} (modified: {dt}, size: {os.path.getsize(f)} bytes)")
else:
    print("data/renders/ does not exist.")

print("\nFiles directly in data/:")
files = glob.glob(os.path.join(project_root, 'data', "*.mp4"))
for f in files:
    mtime = os.path.getmtime(f)
    dt = datetime.datetime.fromtimestamp(mtime)
    print(f"  {f} (modified: {dt}, size: {os.path.getsize(f)} bytes)")
