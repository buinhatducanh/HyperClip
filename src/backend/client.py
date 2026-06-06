"""RustClient - manages Rust subprocess + JSON-RPC."""
import os, sys, json, subprocess, threading, queue
from typing import Optional

def find_hyperclip_backend():
    candidates = [
        os.path.join("target", "debug", "hyperclip-tauri.exe"),
        os.path.join("src-tauri", "target", "debug", "hyperclip-tauri.exe"),
        os.path.join("target", "release", "hyperclip-tauri.exe"),
        "hyperclip-tauri.exe",
        "hyperclip.exe",
    ]
    for c in candidates:
        if os.path.exists(c):
            return os.path.abspath(c)
    return "hyperclip-tauri.exe"


class RustClient:
    def __init__(self, binary_path):
        self._proc = None
        self._binary_path = binary_path
        self._next_id = 1
        self._id_lock = threading.Lock()
        self._pending = {}
        self._pending_lock = threading.Lock()
        self._event_queue = queue.Queue()
        self._reader_thread = None
        self._stderr_thread = None
        self._stop_event = threading.Event()
        self._start()
        self._install_drainer()

    def _start(self):
        try:
            self._proc = subprocess.Popen(
                [self._binary_path],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        except FileNotFoundError as e:
            raise RuntimeError("Backend binary not found: " + str(self._binary_path)) from e
        self._reader_thread = threading.Thread(target=self._read_stdout, daemon=True, name="rust-reader")
        self._reader_thread.start()
        self._stderr_thread = threading.Thread(target=self._read_stderr, daemon=True, name="rust-stderr")
        self._stderr_thread.start()

    def _install_drainer(self):
        try:
            from PySide6.QtCore import QTimer
            timer = QTimer()
            timer.setInterval(50)
            timer.timeout.connect(self._drain_events)
            timer.start()
            self._drainer_timer = timer
        except Exception as e:
            sys.stderr.write("[RustClient] drainer install failed: " + str(e) + "\n")
            sys.stderr.flush()

    def _drain_events(self):
        try:
            from src.backend.events import get_event_bus
            bus = get_event_bus()
            while True:
                try:
                    msg = self._event_queue.get_nowait()
                except queue.Empty:
                    break
                method = msg.get("method")
                params = msg.get("params", {})
                self._dispatch_event(bus, method, params)
        except Exception as e:
            sys.stderr.write("[RustClient] drain error: " + str(e) + "\n")
            sys.stderr.flush()

    def send_command(self, cmd, params=None, timeout=5.0):
        with self._id_lock:
            req_id = self._next_id
            self._next_id += 1
        resp_queue = queue.Queue(maxsize=1)
        with self._pending_lock:
            self._pending[req_id] = resp_queue
        payload = {"id": req_id, "cmd": cmd}
        if params:
            payload.update(params)
        line = json.dumps(payload) + "\n"
        try:
            assert self._proc and self._proc.stdin
            self._proc.stdin.write(line.encode("utf-8"))
            self._proc.stdin.flush()
        except (BrokenPipeError, OSError) as e:
            with self._pending_lock:
                self._pending.pop(req_id, None)
            return {"ok": False, "error": "backend not running: " + str(e)}
        try:
            return resp_queue.get(timeout=timeout)
        except queue.Empty:
            with self._pending_lock:
                self._pending.pop(req_id, None)
            return {"ok": False, "error": "backend timeout"}

    def _read_stdout(self):
        assert self._proc and self._proc.stdout
        buf = b""
        while not self._stop_event.is_set():
            chunk = self._proc.stdout.read(1)
            if not chunk:
                break
            if chunk == b"\n":
                line = buf.decode("utf-8", errors="replace").strip()
                buf = b""
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    sys.stderr.write("[RustClient] invalid JSON: " + line[:200] + "\n")
                    sys.stderr.flush()
                    continue
                if "id" in msg:
                    req_id = msg["id"]
                    with self._pending_lock:
                        q = self._pending.pop(req_id, None)
                    if q is not None:
                        try:
                            q.put_nowait(msg)
                        except queue.Full:
                            pass
                else:
                    self._event_queue.put(msg)
            else:
                buf += chunk

    def _dispatch_event(self, bus, method, params):
        try:
            if method == "workspace:update":
                bus.workspace_updated.emit(params)
            elif method == "render:progress":
                bus.render_progress.emit(params.get("id", ""), params.get("progress", 0.0))
            elif method == "system:stats":
                bus.system_stats_updated.emit(params)
            elif method == "notification":
                bus.notification.emit(params.get("title", ""), params.get("message", ""))
            elif method == "newVideoDetected":
                bus.new_video_detected.emit(params)
            elif method == "poller:status":
                bus.poller_status_changed.emit(params)
            elif method == "channel:synced":
                bus.channel_synced.emit()
        except BaseException as e:
            sys.stderr.write("[RustClient] dispatch error: " + str(type(e).__name__) + ": " + str(e) + "\n")
            sys.stderr.flush()

    def _read_stderr(self):
        assert self._proc and self._proc.stderr
        while not self._stop_event.is_set():
            chunk = self._proc.stderr.read(1)
            if not chunk:
                break
            try:
                sys.stderr.write(chunk.decode("utf-8", errors="replace"))
            except Exception:
                pass

    def stop(self):
        self._stop_event.set()
        if self._proc and self._proc.poll() is None:
            try:
                self._proc.terminate()
                self._proc.wait(timeout=2)
            except Exception:
                try:
                    self._proc.kill()
                except Exception:
                    pass


_client = None
def get_client():
    global _client
    if _client is None:
        try:
            _client = RustClient(find_hyperclip_backend())
        except RuntimeError as e:
            sys.stderr.write("[RustClient] " + str(e) + "\n")
            sys.stderr.flush()
            _client = None
    return _client
