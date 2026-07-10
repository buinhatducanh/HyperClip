import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

log_path = r"C:\Users\MSI\Downloads\hyperclip.log - Sao chép.2026-06-25_16-14-44"

if os.path.exists(log_path):
    print(f"Reading log to see what happens after Spawning FFmpeg...")
    with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
        lines = f.readlines()
    
    found_spawn = False
    spawn_index = -1
    for idx, line in enumerate(lines):
        if "Spawning FFmpeg" in line:
            print(f"Found spawn at line {idx}: {line.strip()[:100]}...")
            found_spawn = True
            spawn_index = idx
    
    if found_spawn:
        print("\nLines after spawn:")
        for line in lines[spawn_index:spawn_index + 100]:
            print(line.strip())
else:
    print(f"Log path {log_path} does not exist.")
