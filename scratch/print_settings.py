import json
import os
import tempfile

APPDATA = os.environ.get('APPDATA') or tempfile.gettempdir()
settings_path = os.path.join(APPDATA, '.hyperclip', 'settings.json')

if os.path.exists(settings_path):
    with open(settings_path, 'r', encoding='utf-8') as f:
        print(json.load(f))
else:
    print("settings.json does not exist")
