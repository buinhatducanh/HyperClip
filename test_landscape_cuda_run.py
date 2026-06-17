# test_landscape_cuda_run.py
import subprocess
import json
import os
import time
import tempfile

project_root = os.path.dirname(os.path.abspath(__file__))
APPDATA = os.environ.get('APPDATA') or tempfile.gettempdir()
TAURI = os.path.join(project_root, 'target', 'debug', 'hyperclip-tauri.exe')

input_path = r"C:\Users\MSI\AppData\Roaming\media\ch-1781346484630\downloads\zajR9O56CDc_20260613_160140.mp4"
assert os.path.exists(input_path), f"Test video not found at {input_path}"

# Write workspace JSON
ws_id = 'e2e_test_ws_landscape'
ws_path = os.path.join(APPDATA, '.hyperclip', 'workspaces.json')
os.makedirs(os.path.dirname(ws_path), exist_ok=True)
ws = {
    'workspaces': [{
        'id': ws_id, 'status': 'ready', 'video_id': 'zajR9O56CDc',
        'channel_id': 'ch-1781346484630', 'channel_name': 'BadyNone',
        'title': 'TÔI GHÉT CÂY , VÀ NÓ CŨNG THẾ ! ! !  Tree hate you  MB3R',
        'downloadedPath': input_path,
        'thumbnailLocal': '',
        'downloadedAt': int(time.time()*1000),
        'createdAt': int(time.time()*1000),
        'publishedAt': int(time.time()*1000),
        'trimStart': 0, 'trimEnd': 300,
        'videoSpeed': 1.0, 'fpsTarget': 30,
        'exportResolution': '360p', 'isShort': False, 'autoRender': True,
        'width': 640, 'height': 360, 'durationSec': 300,
    }]
}
with open(ws_path, 'w', encoding='utf-8') as f:
    json.dump(ws, f, indent=2, ensure_ascii=False)

print(f'[OK] Workspace JSON written to {ws_path}')

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
finished = False

while not finished:
    line = proc.stdout.readline()
    if not line:
        break
    line = line.strip()
    try:
        d = json.loads(line)
        if d.get('method') == 'render:progress':
            p = d.get('params', {}).get('progress', 0)
            print(f'Progress: {p:.1%}', flush=True)
        elif d.get('id') == 1:
            print(f'Response: {d}', flush=True)
        
        # Check if done
        params = d.get('params', {})
        if params.get('status') == 'done':
            print('\n[SUCCESS] Render finished!', flush=True)
            print(f'Total actual render duration reported: {params.get("renderDurationSec")}s', flush=True)
            print(f'Total execution time: {time.time() - start_time:.2f}s', flush=True)
            finished = True
        elif params.get('error'):
            print(f'\n[ERROR] Render failed: {params.get("error")}', flush=True)
            finished = True
    except Exception as e:
        # Avoid printing unicode errors
        pass

proc.terminate()
proc.wait(5)
print('[DONE] Test complete')
