import subprocess
import json
import os
import time
import sys
import socket

project_root = r"d:\LOOP_COMPANY\HyperClip"
TAURI = os.path.join(project_root, 'target', 'release', 'hyperclip-tauri.exe')

def run_test():
    print("[Test] Starting real download + split + render test...")
    assert os.path.exists(TAURI), f"Backend binary not found at {TAURI}"

    # 1. Start TCP listener for Rust connection
    server_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_sock.bind(('127.0.0.1', 0))
    server_sock.listen(1)
    port = server_sock.getsockname()[1]
    print(f"[Test] Listening for Rust connection on port {port}...")

    # Create a new test workspace in workspaces.json
    ws_id = f"ws-test-dl-{int(time.time())}"
    ws_path = os.path.join(project_root, 'data', '.hyperclip', 'workspaces.json')
    
    with open(ws_path, 'r', encoding='utf-8') as f:
        store = json.load(f)
    
    # Add our test workspace
    new_ws = {
        "id": ws_id,
        "status": "waiting",
        "video_id": "EqWMOrNVnjU", # Short test video
        "channel_id": "ch1778770285853",
        "channel_name": "Nhật Đức Anh Bùi",
        "title": "Test Split 60s Video",
        "createdAt": int(time.time()*1000),
        "publishedAt": int(time.time()*1000),
        "trimStart": 0.0,
        "trimEnd": 60.0,
        "videoSpeed": 1.2,
        "fpsTarget": 30,
        "exportResolution": "1080p",
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
        proc.terminate()
        return

    # Trigger autoDownload
    payload = {
        "id": 1,
        "cmd": "workspace:autoDownload",
        "params": {
            "id": ws_id,
            "url": "https://www.youtube.com/watch?v=EqWMOrNVnjU",
            "trimMinutes": 1
        }
    }
    req_line = json.dumps(payload, ensure_ascii=False) + "\n"
    conn_sock.sendall(req_line.encode("utf-8"))
    print(f"[Test] Sent autoDownload command")

    # Read TCP connection responses / events
    start_time = time.time()
    download_completed = False
    renders_completed = 0
    expected_renders = 2 # splitting into 2 parts
    
    conn_sock.settimeout(0.5)
    buffer = b""
    
    while time.time() - start_time < 120:
        try:
            chunk = conn_sock.recv(4096)
            if not chunk:
                print("[Test] Connection closed by backend")
                break
            buffer += chunk
            while b"\n" in buffer:
                line_bytes, buffer = buffer.split(b"\n", 1)
                line = line_bytes.decode("utf-8").strip()
                if not line:
                    continue
                
                # Print IPC events for tracing
                safe_line = line.encode('ascii', 'replace').decode('ascii')
                print(f"[IPC Event] {safe_line}")
                
                try:
                    event = json.loads(line)
                    method = event.get("method")
                    params = event.get("params", {})
                    
                    # Check for download completion
                    if method == "workspace:update" and params.get("id") == ws_id and params.get("status") == "ready":
                        if not download_completed:
                            download_completed = True
                            print("[Test] Download completed! Triggering workspace split...")
                            
                            # Trigger split into 2 parts: 0s to 30s, and 30s to 60s
                            parts = [
                                {"start": 0.0, "end": 30.0},
                                {"start": 30.0, "end": 60.0}
                            ]
                            split_payload = {
                                "id": 2,
                                "cmd": "workspace:split",
                                "params": {
                                    "id": ws_id,
                                    "autoRender": True,
                                    "renderResolution": "1080p",
                                    "renderFPS": 30,
                                    "renderSpeed": 1.2,
                                    "parts": parts
                                }
                            }
                            split_line = json.dumps(split_payload, ensure_ascii=False) + "\n"
                            conn_sock.sendall(split_line.encode("utf-8"))
                            print("[Test] Sent workspace:split command")
                    
                    # Check for rendering updates
                    if method == "workspace:update" and "-part" in params.get("id", ""):
                        pid = params.get("id")
                        status = params.get("status")
                        if status == "done":
                            renders_completed += 1
                            print(f"[Test] Part render completed: {pid} ({renders_completed}/{expected_renders})")
                            if renders_completed >= expected_renders:
                                print("[Test] All parts rendered successfully!")
                                break
                        elif status == "error":
                            print(f"[Error] Part render failed for {pid}: {params.get('error')}")
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

    # Validate output files
    print("\n[Test] Verifying output files in renders directory...")
    renders_dir = os.path.join(project_root, 'data', 'renders')
    expected_files = [
        "Test Split 60s Video_part1.mp4",
        "Test Split 60s Video_part2.mp4"
    ]
    
    success = True
    for fn in expected_files:
        fp = os.path.join(renders_dir, fn)
        if os.path.exists(fp):
            sz = os.path.getsize(fp)
            print(f"[OK] Rendered file exists: {fp} ({sz} bytes)")
            
            # Use ffprobe to check if it's a valid video (not frozen, has correct duration)
            try:
                probe_cmd = [
                    'ffprobe', '-v', 'error',
                    '-show_entries', 'format=duration:stream=width,height,codec_name',
                    '-of', 'json', fp
                ]
                probe_res = subprocess.run(probe_cmd, capture_output=True, text=True)
                probe_data = json.loads(probe_res.stdout)
                duration = float(probe_data.get("format", {}).get("duration", 0))
                print(f"     - Duration: {duration:.2f}s")
                for s in probe_data.get("streams", []):
                    print(f"     - Stream: {s.get('codec_name')} ({s.get('width')}x{s.get('height')})")
                if duration == 0:
                    print("[FAIL] Duration is 0, video might be corrupt")
                    success = False
            except Exception as e:
                print(f"[WARN] Failed to probe video with ffprobe: {e}")
        else:
            print(f"[FAIL] Rendered file missing: {fp}")
            success = False

    if success:
        print("[Test] SUCCESS! Real download, split and rendering verified completely.")
    else:
        print("[Test] FAILED! Some files were missing or invalid.")

if __name__ == "__main__":
    run_test()
