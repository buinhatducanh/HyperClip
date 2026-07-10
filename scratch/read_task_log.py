import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

log_path = r"C:\Users\MSI\.gemini\antigravity-ide\brain\008c9d2c-730e-45b2-9f0e-3f35b9ada63d\.system_generated\tasks\task-4767.log"

if os.path.exists(log_path):
    print("Reading task log:")
    with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
        print(f.read())
else:
    print(f"Log file not found at: {log_path}")
