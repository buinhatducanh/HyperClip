import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open(r"d:\LOOP_COMPANY\HyperClip\data\.hyperclip\workspaces.json", 'r', encoding='utf-8') as f:
    store = json.load(f)

print("Workspaces:")
for ws in store.get("workspaces", []):
    print(f"ID: {ws.get('id')}")
    print(f"  Title: {ws.get('title')}")
    print(f"  Status: {ws.get('status')}")
    print(f"  Downloaded Path: {ws.get('downloadedPath')}")
    print(f"  Rendered Path: {ws.get('renderedPath')}")
    print(f"  Trim: {ws.get('trimStart')} - {ws.get('trimEnd')}")
    print(f"  Speed: {ws.get('videoSpeed')}")
    print(f"  IsShort: {ws.get('isShort')}")
    print(f"  Error: {ws.get('error')}")
    print("-" * 40)
