import os
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

project_root = r"D:\LOOP_COMPANY\HyperClip"
ws_path = os.path.join(project_root, 'data', '.hyperclip', 'workspaces.json')

print(f"Path: {ws_path}")
if os.path.exists(ws_path):
    print("Exists!")
    with open(ws_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    print("Workspaces count:", len(data.get('workspaces', [])))
    for ws in data.get('workspaces', []):
        print(f"ID: {ws.get('id')}, Status: {ws.get('status')}, Title: {ws.get('title')[:30]}")
else:
    print("Does not exist!")
