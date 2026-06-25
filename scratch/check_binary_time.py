import os
import datetime

binary_path = r"d:\LOOP_COMPANY\HyperClip\target\release\hyperclip-tauri.exe"
if os.path.exists(binary_path):
    mtime = os.path.getmtime(binary_path)
    dt = datetime.datetime.fromtimestamp(mtime)
    print(f"Binary: {binary_path} modified at {dt}")
else:
    print(f"Binary {binary_path} does not exist.")
