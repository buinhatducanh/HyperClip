import subprocess
import json
import os
import time
import sys
import threading

sys.stdout.reconfigure(encoding='utf-8')

project_root = r"D:\LOOP_COMPANY\HyperClip"
DATA_DIR = os.path.join(project_root, 'data')
TAURI = os.path.join(project_root, 'target', 'debug', 'hyperclip-tauri.exe')

input_path = r"D:\LOOP_COMPANY\HyperClip\data\media\Zilk Kay\downloads\8axw16_HPMY_20260627_123132.mp4"
thumbnail_path = r"D:\LOOP_COMPANY\HyperClip\data\media\Zilk Kay\thumbnails\8axw16_HPMY.jpg"

if not os.path.exists(input_path):
    print(f"Error: test video not found at {input_path}")
    sys.exit(1)

# Write workspace JSON
ws_id = 'e2e_test_ws_short_cuda'
ws_path = os.path.join(DATA_DIR, '.hyperclip', 'workspaces.json')
os.makedirs(os.path.dirname(ws_path), exist_ok=True)

workspaces = []
if os.path.exists(ws_path):
    try:
        with open(ws_path, 'r', encoding='utf-8') as f:
            existing = json.load(f)
            workspaces = existing.get('workspaces', [])
    except Exception as e:
        print(f"Warning: could not load existing workspaces: {e}")

workspaces = [w for w in workspaces if w.get('id') != ws_id]

test_ws = {
    'id': ws_id,
    'status': 'ready',
    'video_id': '8axw16_HPMY',
    'channel_id': 'ch-1781346484630',
    'channel_name': 'Zilk Kay',
    'title': 'Test Short Video',
    'downloadedPath': input_path,
    'thumbnailLocal': thumbnail_path,
    'downloadedAt': int(time.time()*1000),
    'createdAt': int(time.time()*1000),
    'publishedAt': int(time.time()*1000),
    'trimStart': 0.0,
    'trimEnd': 10.0,
    'videoSpeed': 1.1,
    'fpsTarget': 30,
    'exportResolution': '720p',
    'isShort': True,
    'autoRender': False,
    'width': 640,
    'height': 360,
    'durationSec': 300,
}
workspaces.append(test_ws)

with open(ws_path, 'w', encoding='utf-8') as f:
    json.dump({'workspaces': workspaces}, f, indent=2, ensure_ascii=False)

print(f'[OK] Workspace JSON written to {ws_path}')

# Launch Rust backend
env = os.environ.copy()
env['HYPERCLIP_DATA_DIR'] = DATA_DIR
proc = subprocess.Popen(
    [TAURI],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True, bufsize=1,
    env=env
)
print('[OK] Rust backend started')

# Spawn a thread to read and print stderr of Tauri process
def read_stderr(pipe):
    for line in pipe:
        print(f"[TAURI-STDERR] {line.strip()}", flush=True)

stderr_thread = threading.Thread(target=read_stderr, args=(proc.stderr,), daemon=True)
stderr_thread.start()

# Send render:start
req = json.dumps({'id': 1, 'cmd': 'render:start', 'params': {'id': ws_id}})
proc.stdin.write(req + '\n')
proc.stdin.flush()
print(f'[SEND] {req}')

start_time = time.time()
finished = False
success = False

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
        
        # Check status
        params = d.get('params', {})
        if params.get('status') == 'done':
            print('\n[SUCCESS] Render finished!', flush=True)
            print(f'Rendered Path: {params.get("renderedPath")}', flush=True)
            print(f'Total actual render duration reported: {params.get("renderDurationSec")}s', flush=True)
            print(f'Total execution time: {time.time() - start_time:.2f}s', flush=True)
            finished = True
            success = True
        elif params.get('error'):
            print(f'\n[ERROR] Render failed: {params.get("error")}', flush=True)
            finished = True
    except Exception as e:
        # ignore parse error of unrelated logs
        pass

# Cleanup process
proc.terminate()
try:
    proc.wait(5)
except:
    proc.kill()

print('[DONE] Test complete')
if not success:
    sys.exit(1)
