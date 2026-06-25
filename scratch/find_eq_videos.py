import os
import sys
import glob

sys.stdout.reconfigure(encoding='utf-8')

project_root = r"d:\LOOP_COMPANY\HyperClip"
data_dir = os.path.join(project_root, 'data')
pattern = os.path.join(data_dir, "**", "*EqWMOrNVnjU*")
files = glob.glob(pattern, recursive=True)

print("Found files matching 'EqWMOrNVnjU':")
for f in files:
    if os.path.isfile(f):
        print(f"  {f} (size: {os.path.getsize(f)} bytes)")
