"""E2E render test: spawn Rust backend, send render:start, verify output."""
import subprocess, json, os, time, sys

import tempfile
project_root = os.path.dirname(os.path.abspath(__file__))
APPDATA = os.environ.get('APPDATA') or tempfile.gettempdir()

# Locate tauri backend binary dynamically
TAURI = os.path.join(project_root, 'target', 'debug', 'hyperclip-tauri.exe')
if not os.path.exists(TAURI):
    TAURI = os.path.join(project_root, 'src-tauri', 'target', 'debug', 'hyperclip-tauri.exe')
if not os.path.exists(TAURI):
    TAURI = os.path.join(project_root, 'target', 'release', 'hyperclip-tauri.exe')
if not os.path.exists(TAURI):
    TAURI = os.path.join(project_root, 'src-tauri', 'target', 'release', 'hyperclip-tauri.exe')
assert os.path.exists(TAURI), f"tauri not found at {TAURI}"

# Locate test video and thumbnail dynamically from workspace media
def find_test_video():
    media_dir = os.path.join(project_root, 'data', 'media')
    if os.path.exists(media_dir):
        for root, dirs, files in os.walk(media_dir):
            for file in files:
                if file.endswith('.mp4'):
                    video_path = os.path.join(root, file)
                    # Check for thumbnail in sibling thumbnails folder
                    parent_dir = os.path.dirname(root)
                    thumb_name = os.path.splitext(file)[0].split('_')[0] + '.jpg'
                    thumb_path = os.path.join(parent_dir, 'thumbnails', thumb_name)
                    if not os.path.exists(thumb_path):
                        thumb_dir = os.path.join(parent_dir, 'thumbnails')
                        if os.path.exists(thumb_dir):
                            jpgs = [f for f in os.listdir(thumb_dir) if f.endswith('.jpg')]
                            if jpgs:
                                thumb_path = os.path.join(thumb_dir, jpgs[0])
                    return video_path, thumb_path if os.path.exists(thumb_path) else ""
    return "", ""

input_path, thumbnail_path = find_test_video()
if not input_path:
    input_path = os.path.join(project_root, 'data', 'media', 'mock.mp4')
    thumbnail_path = os.path.join(project_root, 'data', 'media', 'mock.jpg')
    print('[WARN] No real video found, using fallback paths')
else:
    print(f'[OK] Dynamic test video selected: {input_path}')

# 2. Workspace JSON (same as what Rust reads)
ws_id = 'e2e_test_ws'
ws_path = os.path.join(APPDATA, '.hyperclip', 'workspaces.json')
os.makedirs(os.path.dirname(ws_path), exist_ok=True)
ws = {
    'workspaces': [{
        'id': ws_id, 'status': 'ready', 'video_id': 'EqWMOrNVnjU',
        'channel_id': 'ch-1781346484630', 'channel_name': 'BadyNone',
        'title': 'TÔI GHÉT CÂY , VÀ NÓ CŨNG THẾ ! ! !  Tree hate you  MB3R',
        'downloadedPath': input_path,
        'thumbnailLocal': thumbnail_path,
        'downloadedAt': int(time.time()*1000),
        'createdAt': int(time.time()*1000),
        'publishedAt': int(time.time()*1000),
        'trimStart': 0, 'trimEnd': 10,
        'videoSpeed': 1.2, 'fpsTarget': 30,
        'exportResolution': '1080x1920', 'isShort': True, 'autoRender': True,
        'width': 1920, 'height': 1080, 'durationSec': 10,
    }]
}
with open(ws_path, 'w') as f:
    json.dump(ws, f, indent=2)
print(f'[OK] Workspace JSON written to {ws_path}')

# 3. Launch Rust backend
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

# 4. Send render:start
req = json.dumps({'id': 1, 'cmd': 'render:start', 'params': {'id': ws_id}})
proc.stdin.write(req + '\n')
proc.stdin.flush()
print(f'[SEND] {req}')

# 5. Read IPC events (non-blocking) for up to 60s
import select
import msvcrt
import io

start = time.time()
last_progress = -1
finished = False

while time.time() - start < 60 and not finished:
    time.sleep(0.2)
    # Read all available lines from stdout
    while True:
        # Check if data available
        try:
            fd = proc.stdout.fileno()
            import os as _os
            # Try reading a line (will block briefly)
            line = proc.stdout.readline()
            if not line:
                break
            line = line.strip()
            if not line:
                continue
            print(f'[IPC] {line}')
            sys.stdout.flush()

            # Track progress
            try:
                d = json.loads(line)
                if d.get('method') == 'render:progress':
                    p = d.get('params', {}).get('progress', 0)
                    last_progress = p
                if d.get('id') == 1:
                    if d.get('ok'):
                        pass  # render:start acknowledged
                status = d.get('params', {}).get('status')
                if status == 'done':
                    print('[DONE] Render completed')
                    finished = True
                    break
                if d.get('params', {}).get('error'):
                    print(f'[ERROR] Render failed: {d.get("params", {}).get("error")}')
                    finished = True
                    break
            except:
                pass
        except:
            break
    if last_progress >= 0:
        pass
    # Check if proc exited
    if proc.poll() is not None:
        print(f'[EXIT] Process exited with code {proc.poll()}')
        break

# 6. Check output
print()
out_dir = os.path.join(APPDATA, 'media', 'ch-1781346484630', 'renders', 'e2e_test_ws')
if os.path.isdir(out_dir):
    found = False
    for f in sorted(os.listdir(out_dir)):
        fp = os.path.join(out_dir, f)
        if f.endswith('.mp4') and os.path.getsize(fp) > 1000:
            found = True
            sz = os.path.getsize(fp) / 1048576
            print(f'[FILE] {fp} ({sz:.1f} MB)')
            probe = json.loads(
                subprocess.run(
                    ['ffprobe', '-v', 'error',
                     '-show_entries', 'stream=width,height,codec_name,codec_type:format=duration,size',
                     '-of', 'json', fp],
                    capture_output=True, text=True
                ).stdout
            )
            for s in probe.get('streams', []):
                ct = s.get('codec_type', '')
                if ct == 'video':
                    print(f'  Video: {s["width"]}x{s["height"]} {s["codec_name"]}')
                elif ct == 'audio':
                    print(f'  Audio: {s["codec_name"]}')
            print(f'  Duration: {probe.get("format", {}).get("duration", "?")}s')
    if not found:
        print('[FAIL] No output file found')
        # Check stderr
        stderr_output = proc.stderr.read() if proc.stderr else ''
        print(f'[STDERR] {stderr_output[:1000]}')
else:
    print(f'[FAIL] Output dir {out_dir} does not exist')

# Cleanup
proc.terminate()
proc.wait(5)
print('[DONE] Test complete')
