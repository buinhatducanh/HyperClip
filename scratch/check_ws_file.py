import os
import tempfile
import json

APPDATA = os.environ.get('APPDATA') or tempfile.gettempdir()
ws_path = os.path.join(APPDATA, '.hyperclip', 'workspaces.json')

print(f"Path: {ws_path}")
if os.path.exists(ws_path):
    print("Exists!")
    with open(ws_path, 'r', encoding='utf-8') as f:
        print(json.load(f))
else:
    print("Does not exist!")
