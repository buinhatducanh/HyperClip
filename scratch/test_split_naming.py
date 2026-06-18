import subprocess
import json
import os
import time

project_root = r"d:\LOOP_COMPANY\HyperClip"
TAURI = os.path.join(project_root, 'target', 'release', 'hyperclip-tauri.exe')

def run_test():
    import socket
    print("[Test] Starting split naming test...")
    assert os.path.exists(TAURI), f"Backend binary not found at {TAURI}"

    # 1. Start TCP listener
    server_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_sock.bind(('127.0.0.1', 0))
    server_sock.listen(1)
    port = server_sock.getsockname()[1]
    print(f"[Test] Listening for Rust connection on port {port}...")

    # Target parent workspace
    ws_id = "ws-ch-1781778529105" # This already exists in workspaces.json and is "done"

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
    server_sock.settimeout(5.0)
    try:
        conn_sock, addr = server_sock.accept()
        conn_file = conn_sock.makefile('rwb', buffering=0)
        print(f"[Test] Connected to backend at {addr}")
    except socket.timeout:
        print("[Error] Timeout waiting for backend connection")
        proc.terminate()
        return

    # We will split into 3 parts (0-10, 10-20, 20-30 seconds)
    parts = [
        {"start": 0.0, "end": 10.0},
        {"start": 10.0, "end": 20.0},
        {"start": 20.0, "end": 30.0}
    ]

    payload = {
        "id": 99,
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

    # Send command over TCP connection
    req_line = json.dumps(payload, ensure_ascii=False) + "\n"
    conn_file.write(req_line.encode("utf-8"))
    conn_file.flush()
    print(f"[Test] Sent split command: {req_line.strip()}")

    # Find the latest log file in data/logs/
    logs_dir = os.path.join(project_root, 'data', 'logs')
    time.sleep(2.0) # wait a moment for the log file to be created and written to
    
    latest_file = None
    if os.path.exists(logs_dir):
        files = [os.path.join(logs_dir, f) for f in os.listdir(logs_dir) if f.startswith("hyperclip.log")]
        if files:
            latest_file = max(files, key=os.path.getmtime)
    
    print(f"[Test] Reading logs from {latest_file}...")

    # Read output to see if it generates clean names
    start_time = time.time()
    found_renders = []

    # Read log file lines
    if latest_file:
        for _ in range(30):
            if time.time() - start_time > 5:
                break
            with open(latest_file, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            for line in lines:
                line = line.strip()
                if "Starting split render for part" in line and line not in found_renders:
                    # Print safely by replacing non-ASCII characters to avoid terminal encoding issues
                    safe_line = line.encode('ascii', 'replace').decode('ascii')
                    print(f"[Captured Log] {safe_line}")
                    found_renders.append(line)
            if len(found_renders) >= 3:
                break
            time.sleep(0.5)

    # Clean up process
    proc.terminate()
    try:
        proc.wait(timeout=2)
    except subprocess.TimeoutExpired:
        proc.kill()

    print("[Test] Test completed. Found render commands:")
    for r in found_renders:
        safe_r = r.encode('ascii', 'replace').decode('ascii')
        print(f" - {safe_r}")

if __name__ == "__main__":
    run_test()
