"""E2E render test: spawn Rust backend, send render:start, verify output."""
import subprocess, json, os, time, sys

APPDATA = os.environ.get('APPDATA', 'C:/temp')
TAURI = r'd:\LOOP_COMPANY\HyperClip\target\debug\hyperclip-tauri.exe'
assert os.path.exists(TAURI), f"tauri not found at {TAURI}"

# 1. Create source video
input_path = r'C:\temp\render_e2e_source.mp4'
os.makedirs(r'C:\temp', exist_ok=True)
subprocess.run([
    'ffmpeg', '-y',
    '-f', 'lavfi', '-i', 'color=c=blue:s=1920x1080:d=15:r=30',
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-shortest',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', input_path
], check=True, capture_output=True)
print('[OK] Source video created')

# 2. Workspace JSON (same as what Rust reads)
ws_id = 'e2e_test_ws'
ws_path = os.path.join(APPDATA, 'HyperClip', 'workspaces.json')
os.makedirs(os.path.dirname(ws_path), exist_ok=True)
ws = {
    'workspaces': [{
        'id': ws_id, 'status': 'ready', 'video_id': 'test123',
        'channel_id': 'UC_test', 'channel_name': 'Test Channel',
        'title': 'E2E Render Test',
        'downloadedPath': input_path,
        'downloadedAt': int(time.time()*1000),
        'createdAt': int(time.time()*1000),
        'publishedAt': int(time.time()*1000),
        'trimStart': 0, 'trimEnd': 10,
        'videoSpeed': 1.0, 'fpsTarget': 30,
        'exportResolution': '1080x1920', 'isShort': True,
        'width': 1920, 'height': 1080, 'durationSec': 10,
    }]
}
with open(ws_path, 'w') as f:
    json.dump(ws, f, indent=2)
print(f'[OK] Workspace JSON written to {ws_path}')

# 3. Launch Rust backend
proc = subprocess.Popen(
    [TAURI],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True, bufsize=1
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

while time.time() - start < 60:
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
                if 'done' in json.dumps(d):
                    print('[DONE] Render completed')
                    break
                if 'error' in json.dumps(d).lower():
                    print('[ERROR] Render failed')
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
out_dir = os.path.join(APPDATA, 'HyperClip', 'output')
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
