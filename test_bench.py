# test_bench.py
import subprocess
import json
import os
import time
import tempfile
import sys

project_root = os.path.dirname(os.path.abspath(__file__))
APPDATA = os.environ.get('APPDATA') or tempfile.gettempdir()
TAURI = os.path.join(project_root, 'target', 'debug', 'hyperclip-tauri.exe')

input_path = r"C:\Users\MSI\AppData\Roaming\media\ch-1781346484630\downloads\zajR9O56CDc_20260613_160404.mp4"
assert os.path.exists(input_path), f"Test video not found at {input_path}"

# Use a fixed timestamp corresponding to the filename's date-time to avoid migration renames
fixed_ts = 1781366644000  # 2026-06-13 16:04:04 UTC

# Write workspace JSON
ws_id = 'e2e_test_ws_landscape'
ws_path = os.path.join(APPDATA, '.hyperclip', 'workspaces.json')
os.makedirs(os.path.dirname(ws_path), exist_ok=True)
ws = {
    'workspaces': [{
        'id': ws_id, 'status': 'ready', 'video_id': 'zajR9O56CDc',
        'channel_id': 'ch-1781346484630', 'channel_name': 'BadyNone',
        'title': 'Tree hate you',
        'downloadedPath': input_path,
        'thumbnailLocal': '',
        'downloadedAt': fixed_ts,
        'createdAt': fixed_ts,
        'publishedAt': fixed_ts,
        'trimStart': 0, 'trimEnd': 10, # trimEnd = 10
        'videoSpeed': 1.0, 'fpsTarget': 30,
        'exportResolution': '360p', 'isShort': True, 'autoRender': True,
        'width': 640, 'height': 360, 'durationSec': 10, # durationSec = 10
    }]
}
with open(ws_path, 'w', encoding='utf-8') as f:
    json.dump(ws, f, indent=2, ensure_ascii=False)

# Launch Rust backend
env = os.environ.copy()
env['HYPERCLIP_DATA_DIR'] = APPDATA
proc = subprocess.Popen(
    [TAURI],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True, bufsize=1,
    env=env
)
print('[OK] Rust backend started')

# Send render:start
req = json.dumps({'id': 1, 'cmd': 'render:start', 'params': {'id': ws_id}})
proc.stdin.write(req + '\n')
proc.stdin.flush()
print(f'[SEND] {req}')

start_time = time.time()

# Read from stdout and stderr in a loop
while True:
    line = proc.stdout.readline()
    if not line:
        print('[EOF] stdout closed')
        break
    line = line.strip()
    print(f'[OUT] {line}')
    try:
        d = json.loads(line)
        params = d.get('params', {})
        if params.get('status') == 'done':
            print(f'\n[SUCCESS] Render finished! duration: {params.get("renderDurationSec")}s')
            print(f'Total execution time: {time.time() - start_time:.2f}s')
            break
        elif params.get('error'):
            print(f'\n[ERROR] Render failed: {params.get("error")}')
            break
    except Exception as e:
        print(f'[PARSE ERROR] {e}')

# Print stderr if any
stderr_output = proc.stderr.read()
if stderr_output:
    print(f'[STDERR] {stderr_output}')

proc.terminate()
proc.wait(5)
print('[DONE] Test complete')
