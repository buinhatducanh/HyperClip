# test_landscape_cuda.py
import subprocess
import json
import os
import time
import tempfile

project_root = os.path.dirname(os.path.abspath(__file__))
APPDATA = os.path.join(project_root, 'data')
TAURI = os.path.join(project_root, 'target', 'release', 'hyperclip-tauri.exe')

input_path = os.path.join(project_root, 'data', 'media', 'Zilk Kay', 'downloads', 'EThMKvMFvng_20260613_180820.mp4')
assert os.path.exists(input_path), f"Test video not found at {input_path}"

# Write workspace JSON
ws_id = 'ws-ch-1781373936114'
ws_path = os.path.join(APPDATA, '.hyperclip', 'workspaces.json')
os.makedirs(os.path.dirname(ws_path), exist_ok=True)
ws = {
    'workspaces': [{
        'id': ws_id, 'status': 'ready', 'video_id': 'EThMKvMFvng',
        'channel_id': 'ch1779678163236', 'channelName': 'Zilk Kay',
        'title': 'TÔI GHÉT CÂY , VÀ NÓ CŨNG THẾ ! ! !  Tree hate you  MB3R',
        'downloadedPath': input_path,
        'thumbnailLocal': os.path.join(project_root, 'data', 'media', 'Zilk Kay', 'thumbnails', 'EThMKvMFvng.jpg'),
        'downloadedAt': 1781374100516,
        'createdAt': 1781373936115,
        'publishedAt': 1781373932000,
        'trimStart': 0, 'trimEnd': 300.016,
        'videoSpeed': 1.2, 'fpsTarget': 30,
        'exportResolution': '720p', 'isShort': True, 'autoRender': True,
        'width': 720, 'height': 1280, 'durationSec': 300,
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
            print(f'Progress: {p:.1%}')
        elif d.get('id') == 1:
            print(f'Response: {d}')
        
        # Check if done
        params = d.get('params', {})
        if params.get('status') == 'done':
            print('\n[SUCCESS] Render finished!')
            print(f'Total actual render duration reported: {params.get("renderDurationSec")}s')
            print(f'Total execution time: {time.time() - start_time:.2f}s')
            finished = True
        elif params.get('error'):
            print(f'\n[ERROR] Render failed: {params.get("error")}')
            finished = True
    except Exception as e:
        # Avoid printing unicode errors
        pass

proc.terminate()
proc.wait(5)
print('[DONE] Test complete')
