# scratch/test_ipc_hardware.py
import subprocess
import json
import os
import sys

def main():
    backend_path = os.path.abspath("target/release/hyperclip-tauri.exe")
    print(f"Using backend: {backend_path}")
    
    env = os.environ.copy()
    env["HYPERCLIP_DATA_DIR"] = os.path.abspath("data")
    
    # Start the backend process using stdin/stdout for IPC
    proc = subprocess.Popen(
        [backend_path],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        text=True
    )
    
    # Send hardware:profile command
    cmd = {"id": 1, "cmd": "hardware:profile", "params": {}}
    proc.stdin.write(json.dumps(cmd) + "\n")
    proc.stdin.flush()
    
    # Read response
    while True:
        line = proc.stdout.readline()
        if not line:
            break
        print(f"Received: {line.strip()}")
        try:
            msg = json.loads(line)
            if msg.get("id") == 1:
                print("Hardware Profile Result:")
                print(json.dumps(msg, indent=2))
                break
        except json.JSONDecodeError:
            pass
            
    # Terminate backend
    proc.terminate()
    proc.wait()

if __name__ == "__main__":
    main()
