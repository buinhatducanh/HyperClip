import subprocess
import json
import os
import time
import socket

project_root = r"d:\LOOP_COMPANY\HyperClip"
TAURI = os.path.join(project_root, 'target', 'release', 'hyperclip-tauri.exe')

def run_test():
    print("[Test] Starting download and render test for user video MPH4jIzi0hU...")
    assert os.path.exists(TAURI), f"Backend binary not found at {TAURI}"

    # 1. Start TCP listener for Rust connection
    server_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_sock.bind(('127.0.0.1', 0))
    server_sock.listen(1)
    port = server_sock.getsockname()[1]
    print(f"[Test] Listening for Rust connection on port {port}...")

    ws_id = "ws-user-verify"
    ws_path = os.path.join(project_root, 'data', '.hyperclip', 'workspaces.json')
    settings_path = os.path.join(project_root, 'data', '.hyperclip', 'settings.json')
    
    # Backup and modify settings.json
    with open(settings_path, 'r', encoding='utf-8') as f:
        settings_store = json.load(f)
    
    original_settings = json.loads(json.dumps(settings_store))
    settings_store["settings"]["pollingEnabled"] = False
    settings_store["settings"]["autoDownloadEnabled"] = False
    
    with open(settings_path, 'w', encoding='utf-8') as f:
        json.dump(settings_store, f, indent=2, ensure_ascii=False)

    with open(ws_path, 'r', encoding='utf-8') as f:
        store = json.load(f)
    
    # Remove existing ws-user-verify workspaces
    store["workspaces"] = [w for w in store["workspaces"] if not w["id"].startswith(ws_id)]
    
    # Add new workspace
    new_ws = {
        "id": ws_id,
        "status": "waiting",
        "video_id": "MPH4jIzi0hU",
        "channel_id": "ch1778770285853",
        "channel_name": "Nhật Đức Anh Bùi",
        "title": "TÔI GHÉT CÂY TEST RENDER",
        "createdAt": int(time.time()*1000),
        "publishedAt": int(time.time()*1000),
        "trimStart": 0.0,
        "trimEnd": 300.0,
        "videoSpeed": 1.2,
        "fpsTarget": 30,
        "exportResolution": "720p",
        "isShort": True,
        "autoRender": True,
        "progress": None,
        "error": None,
    }
    store["workspaces"].insert(0, new_ws)
    
    with open(ws_path, 'w', encoding='utf-8') as f:
        json.dump(store, f, indent=2, ensure_ascii=False)
    print(f"[Test] Created workspace {ws_id}")

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

    # Trigger autoDownload
    payload = {
        "id": 1,
        "cmd": "workspace:autoDownload",
        "params": {
            "id": ws_id,
            "url": "https://www.youtube.com/watch?v=MPH4jIzi0hU",
            "trimMinutes": 5
        }
    }
    req_line = json.dumps(payload, ensure_ascii=False) + "\n"
    conn_sock.sendall(req_line.encode("utf-8"))
    print(f"[Test] Sent autoDownload command")

    start_time = time.time()
    download_completed = False
    render_completed = False
    
    conn_sock.settimeout(0.5)
    buffer = b""
    
    # Wait for download and auto-render to complete (timeout 4 minutes)
    while time.time() - start_time < 240:
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
                    
                    if method == "workspace:update" and params.get("id") == ws_id:
                        status = params.get("status")
                        progress = params.get("progress")
                        
                        if status == "ready" and not download_completed:
                            download_completed = True
                            print(f"[Test] Download finished. Downloaded path: {params.get('downloadedPath')}")
                            
                        if status == "done":
                            print(f"[Test] Main Render completed! Output: {params.get('renderedPath')}")
                            render_completed = True
                            break
                        elif status == "error":
                            print(f"[Error] Main Render failed: {params.get('error')}")
                            break
                            
                except Exception:
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

    # Restore settings.json
    with open(settings_path, 'w', encoding='utf-8') as f:
        json.dump(original_settings, f, indent=2, ensure_ascii=False)

    if render_completed:
        print("[Test] SUCCESS! Video re-downloaded and rendered completely.")
    else:
        print("[Test] FAILED to complete download and render.")

if __name__ == "__main__":
    run_test()
