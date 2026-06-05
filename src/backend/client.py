# src/backend/client.py
import subprocess
import json
import threading
from typing import Optional

class RustClient:
    def __init__(self, binary_path: str):
        self._proc = subprocess.Popen(
            [binary_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=1,
        )
        self._reader_thread = threading.Thread(target=self._read_stdout, daemon=True)
        self._reader_thread.start()

    def send_command(self, cmd: str, params: Optional[dict] = None) -> dict:
        payload = {"cmd": cmd}
        if params:
            payload.update(params)
        line = json.dumps(payload) + "\n"
        self._proc.stdin.write(line.encode())
        self._proc.stdin.flush()
        resp_line = self._proc.stdout.readline()
        return json.loads(resp_line)

    def _read_stdout(self):
        from src.backend.events import get_event_bus
        bus = get_event_bus()
        for line in self._proc.stdout:
            msg = json.loads(line)
            method = msg.get("method")
            params = msg.get("params", {})
            if method == "workspace:update":
                bus.workspace_updated.emit(params)
            elif method == "render:progress":
                bus.render_progress.emit(params["id"], params["progress"])
            elif method == "system:stats":
                bus.system_stats_updated.emit(params)
            elif method == "notification":
                bus.notification.emit(params["title"], params["message"])
            elif method == "newVideoDetected":
                bus.new_video_detected.emit(params)
            elif method == "poller:status":
                bus.poller_status_changed.emit(params)
            elif method == "channel:synced":
                bus.channel_synced.emit()
