import subprocess
import json
import os
import time
import socket

project_root = r"d:\LOOP_COMPANY\HyperClip"
TAURI = os.path.join(project_root, 'target', 'release', 'hyperclip-tauri.exe')

def run_test():
    print("[Test] Starting single render verification test...")
    assert os.path.exists(TAURI), f"Backend binary not found at {TAURI}"

    # 1. Start TCP listener for Rust connection
    server_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_sock.bind(('127.0.0.1', 0))
    server_sock.listen(1)
    port = server_sock.getsockname()[1]
    print(f"[Test] Listening for Rust connection on port {port}...")

    ws_id = "ws-verify-sync"
    ws_path = os.path.join(project_root, 'data', '.hyperclip', 'workspaces.json')
    settings_path = os.path.join(project_root, 'data', '.hyperclip', 'settings.json')
    
    # Backup and modify settings.json to disable poller
    print("[Test] Temporarily disabling background poller in settings.json...")
    with open(settings_path, 'r', encoding='utf-8') as f:
        settings_store = json.load(f)
    
    original_settings = json.loads(json.dumps(settings_store)) # Deep copy
    settings_store["settings"]["pollingEnabled"] = False
    settings_store["settings"]["autoDownloadEnabled"] = False
    
    with open(settings_path, 'w', encoding='utf-8') as f:
        json.dump(settings_store, f, indent=2, ensure_ascii=False)
        
    # Read render configs from settings
    render_res = settings_store["settings"].get("autoRenderResolution", "720p")
    render_fps = settings_store["settings"].get("autoRenderFPS", 30)
    render_speed = settings_store["settings"].get("autoRenderSpeed", 1.2)
    print(f"[Test] Using render settings: resolution={render_res}, fps={render_fps}, speed={render_speed}")

    with open(ws_path, 'r', encoding='utf-8') as f:
        store = json.load(f)
    
    # Remove existing ws-verify-sync if any
    store["workspaces"] = [w for w in store["workspaces"] if w["id"] != ws_id]
    
    # Add our test workspace as "ready" pointing to the pre-downloaded video
    new_ws = {
        "id": ws_id,
        "status": "ready",
        "video_id": "EqWMOrNVnjU",
        "channel_id": "ch1778770285853",
        "channel_name": "Nhật Đức Anh Bùi",
        "title": "Test Single Render Sync",
        "downloadedPath": "media/Nhật Đức Anh Bùi/downloads/EqWMOrNVnjU_20260625_070440.mp4",
        "createdAt": int(time.time()*1000),
        "publishedAt": int(time.time()*1000),
        "trimStart": 0.0,
        "trimEnd": 60.0,
        "videoSpeed": render_speed,
        "fpsTarget": render_fps,
        "exportResolution": render_res,
        "isShort": True,
        "autoRender": True,
        "progress": None,
        "error": None,
    }
    store["workspaces"].insert(0, new_ws)
    
    with open(ws_path, 'w', encoding='utf-8') as f:
        json.dump(store, f, indent=2, ensure_ascii=False)
    print(f"[Test] Created workspace {ws_id} in workspaces.json")

    # Spawn Rust backend
    env = os.environ.copy()
    env['HYPERCLIP_DATA_DIR'] = os.path.join(project_root, 'data')
    proc = subprocess.Popen(
        [TAURI, "--port", str(port)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=0,
        env=env,
        cwd=project_root
    )

    # Accept connection from Rust backend
    server_sock.settimeout(15.0)
    try:
        conn_sock, addr = server_sock.accept()
        print(f"[Test] Connected to backend at {addr}")
    except socket.timeout:
        print("[Error] Timeout waiting for backend connection")
        # Restore settings
        with open(settings_path, 'w', encoding='utf-8') as f:
            json.dump(original_settings, f, indent=2, ensure_ascii=False)
        proc.terminate()
        return

    # Trigger split / render for 0.0 to 30.0
    split_payload = {
        "id": 1,
        "cmd": "workspace:split",
        "params": {
            "id": ws_id,
            "autoRender": True,
            "renderResolution": render_res,
            "renderFPS": render_fps,
            "renderSpeed": render_speed,
            "parts": [
                {"start": 0.0, "end": 30.0}
            ]
        }
    }
    split_line = json.dumps(split_payload, ensure_ascii=False) + "\n"
    conn_sock.sendall(split_line.encode("utf-8"))
    print("[Test] Sent workspace:split command")

    # Read response
    start_time = time.time()
    render_completed = False
    
    conn_sock.settimeout(0.5)
    buffer = b""
    
    while time.time() - start_time < 90:
        try:
            chunk = conn_sock.recv(4096)
            if not chunk:
                break
            buffer += chunk
            while b"\n" in buffer:
                line_bytes, buffer = buffer.split(b"\n", 1)
                line = line_bytes.decode("utf-8").strip()
                if not line:
                    continue
                
                try:
                    event = json.loads(line)
                    method = event.get("method")
                    params = event.get("params", {})
                    
                    if method == "workspace:update" and params.get("id") == f"{ws_id}-part1":
                        status = params.get("status")
                        progress = params.get("progress")
                        error = params.get("error")
                        
                        if progress is not None:
                            print(f"[Render Progress] {progress:.1f}%")
                            
                        if status == "done":
                            print(f"[Test] Render completed successfully!")
                            render_completed = True
                            break
                        elif status == "error":
                            print(f"[Error] Render failed: {error}")
                            break
                except Exception as e:
                    pass
        except socket.timeout:
            pass
        except Exception as e:
            print(f"[Error] Socket error: {e}")
            break

    # Terminate backend process
    proc.terminate()
    try:
        proc.wait(timeout=2)
    except subprocess.TimeoutExpired:
        proc.kill()

    # Clean up workspace
    with open(ws_path, 'r', encoding='utf-8') as f:
        store = json.load(f)
    store["workspaces"] = [w for w in store["workspaces"] if w["id"] != ws_id and w["id"] != f"{ws_id}-part1"]
    with open(ws_path, 'w', encoding='utf-8') as f:
        json.dump(store, f, indent=2, ensure_ascii=False)

    # Restore settings.json
    print("[Test] Restoring background poller settings...")
    with open(settings_path, 'w', encoding='utf-8') as f:
        json.dump(original_settings, f, indent=2, ensure_ascii=False)

    if render_completed:
        # Probe the generated file
        rendered_fp = os.path.join(project_root, 'data', 'renders', 'Test Single Render Sync_part1.mp4')
        print(f"\n[Verification] Probing output file: {rendered_fp}")
        if os.path.exists(rendered_fp):
            ffprobe = os.path.join(project_root, 'resources', 'ffmpeg', 'bin', 'ffprobe.exe')
            try:
                # Get start times
                out_v = subprocess.check_output([
                    ffprobe, "-v", "error", "-select_streams", "v:0",
                    "-show_entries", "stream=start_time",
                    "-of", "default=noprint_wrappers=1:nokey=1",
                    rendered_fp
                ]).decode('utf-8').strip()
                out_a = subprocess.check_output([
                    ffprobe, "-v", "error", "-select_streams", "a:0",
                    "-show_entries", "stream=start_time",
                    "-of", "default=noprint_wrappers=1:nokey=1",
                    rendered_fp
                ]).decode('utf-8').strip()
                print(f"  Video stream start_time: {out_v}s")
                print(f"  Audio stream start_time: {out_a}s")
                
                # Get duration
                out_dur = subprocess.check_output([
                    ffprobe, "-v", "error", "-show_entries", "format=duration",
                    "-of", "default=noprint_wrappers=1:nokey=1",
                    rendered_fp
                ]).decode('utf-8').strip()
                print(f"  Total Duration: {out_dur}s")
                
            except Exception as e:
                print(f"Failed to probe file: {e}")
        else:
            print("[FAIL] Output file was not found!")

if __name__ == "__main__":
    run_test()
