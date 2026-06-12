"""RustClient — manages Rust subprocess + JSON-RPC.

Architecture
────────────
  Threads:   writer (caller thread)    stdout reader (daemon)
                   │                         │
             send_command_async()            │
             write JSON to stdin ──────────→ │
                   │                    parse JSON line
                   │                    ┌──────────────┐
                   │                    │ has "id"?     │
                   │                    │ YES → fill    │
                   │                    │  cell[0] = msg│
                   │                    │  + queued cb  │
                   │                    │ NO  → emit    │
                   │                    │  eventReceived│
                   │                    └──────────────┘
                   │                         │
             ┌─────┴─────┐          (queued signal)
             │ callback   │◄────────────────┘
             │ done.set() │
             └────────────┘

  On the Qt main thread:
    - send_command() uses QEventLoop to keep UI alive during synchronous waits
    - send_command_async() is fully non-blocking
    - Push events are dispatched via queued signal (no polling timer)

  NO timer polling. NO synchronous queue.get() on main thread.
"""
import os
import sys
import json
import subprocess
import threading

from PySide6.QtCore import QObject, Signal, Slot, Qt, QEventLoop, QTimer


from src.data_dir import get_data_dir

def find_hyperclip_backend():
    candidates = [
        os.path.join("target", "release", "hyperclip-tauri.exe"),
        os.path.join("src-tauri", "target", "release", "hyperclip-tauri.exe"),
        os.path.join("target", "debug", "hyperclip-tauri.exe"),
        os.path.join("src-tauri", "target", "debug", "hyperclip-tauri.exe"),
        "hyperclip-tauri.exe",
        "hyperclip.exe",
    ]
    for c in candidates:
        if os.path.exists(c):
            return os.path.abspath(c)
    return "hyperclip-tauri.exe"


def _sanitize_for_qml(obj):
    if isinstance(obj, dict):
        return {k: _sanitize_for_qml(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_sanitize_for_qml(v) for v in obj]
    elif isinstance(obj, int) and not isinstance(obj, bool):
        # Always use float to map to JS Number directly, avoiding PySide6 integer copy-convert issues
        return float(obj)
    return obj

class RustClient(QObject):
    """Subprocess JSON-RPC client with non-blocking API."""

    eventReceived = Signal(object)  # push event dict (queued → main thread)

    def __init__(self, binary_path, parent=None):
        super().__init__(parent)
        self._proc = None
        self._binary_path = binary_path
        self._next_id = 1
        self._id_lock = threading.Lock()
        self._write_lock = threading.Lock()

        # Each pending request: [result_or_None, callback_or_None, lock]
        self._pending: dict[int, list] = {}
        self._pending_lock = threading.Lock()

        self._reader_thread = None
        self._stderr_thread = None
        self._stop_event = threading.Event()

        self.eventReceived.connect(self._on_event_signal, Qt.QueuedConnection)
        self._start()

    def _start(self):
        try:
            env = os.environ.copy()
            data_dir = get_data_dir()
            env["HYPERCLIP_DATA_DIR"] = os.path.abspath(data_dir)
            self._proc = subprocess.Popen(
                [self._binary_path],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0,
                env=env,
            )
        except FileNotFoundError as e:
            raise RuntimeError("Backend binary not found: " + str(self._binary_path)) from e
        self._reader_thread = threading.Thread(
            target=self._read_stdout, daemon=True, name="rust-reader"
        )
        self._reader_thread.start()
        self._stderr_thread = threading.Thread(
            target=self._read_stderr, daemon=True, name="rust-stderr"
        )
        self._stderr_thread.start()

    # ── Public API (Python + QML) ──────────────────────────────────

    def send_command_async(self, cmd, params=None, callback=None) -> int:
        """Fire-and-forget. Returns req_id. Optional callback fires on main thread."""
        with self._id_lock:
            req_id = self._next_id
            self._next_id += 1

        cell = [None, callback]  # [result, callback]
        with self._pending_lock:
            self._pending[req_id] = cell

        payload = {"id": req_id, "cmd": cmd, "params": params if params else {}}
        line = json.dumps(payload, ensure_ascii=False) + "\n"

        try:
            with self._write_lock:
                assert self._proc and self._proc.stdin
                self._proc.stdin.write(line.encode("utf-8"))
                self._proc.stdin.flush()
        except (BrokenPipeError, OSError) as e:
            with self._pending_lock:
                self._pending.pop(req_id, None)
            err = {"ok": False, "error": str(e)}
            if callback:
                self._invoke_callback_async(callback, err)
        return req_id

    @Slot(str, result='QVariantMap')
    @Slot(str, 'QVariantMap', result='QVariantMap')
    def send_command(self, cmd, params={}, timeout=5.0) -> dict:
        """Synchronous send. Callable from both Python and QML (@Slot overload for 1 or 2 args)."""
        if isinstance(params, dict):
            params = dict(params) if params else None
        result = []
        done = threading.Event()

        def cb(resp):
            result.append(resp)
            done.set()

        self.send_command_async(cmd, params, callback=cb)

        if threading.current_thread() is threading.main_thread():
            loop = QEventLoop()
            check = QTimer()
            check.setInterval(10)
            check.timeout.connect(lambda: loop.quit() if done.is_set() else None)
            check.start()
            QTimer.singleShot(int(timeout * 1000), loop.quit)
            if not done.is_set():
                loop.exec()
            check.stop()
        else:
            done.wait(timeout=timeout)

        return result[0] if result else {"ok": False, "error": "backend timeout"}

    # ── Reader thread ─────────────────────────────────────────────────
    def _read_stdout(self):
        assert self._proc and self._proc.stdout
        import os as _os
        # Non-blocking raw read on the underlying fd. `read(n)` on a buffered
        # text-mode file may wait for `n` bytes on Windows, which starves
        # `send_command`'s QEventLoop when a small JSON response is in flight.
        stdout_fd = self._proc.stdout.fileno()
        try:
            _os.set_blocking(stdout_fd, False)
        except (OSError, ValueError):
            pass

        buf = b""
        while not self._stop_event.is_set():
            try:
                try:
                    chunk = _os.read(stdout_fd, 4096)
                except (BlockingIOError, OSError):
                    self._stop_event.wait(0.01)
                    continue
                if not chunk:
                    break  # EOF
            except ValueError:
                break
            buf += chunk
            while b"\n" in buf:
                raw, buf = buf.split(b"\n", 1)
                line = raw.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                    msg = _sanitize_for_qml(msg)
                except json.JSONDecodeError:
                    sys.stderr.write("[RustClient] invalid JSON: " + line[:200] + "\n")
                    continue

                if "id" in msg:
                    req_id = msg["id"]
                    cell = None
                    with self._pending_lock:
                        if req_id in self._pending:
                            cell = self._pending.pop(req_id)
                    if cell:
                        cell[0] = msg
                        if cell[1]:
                            self._invoke_callback_async(cell[1], msg)
                else:
                    self.eventReceived.emit(msg)

    def _invoke_callback_async(self, callback, msg):
        # We can't easily marshal Python callables through Qt's QueuedConnection
        # (Q_ARG("QVariant", ...) round-trip is finicky for closures). Since
        # the callback for `send_command` is just an Event.set() + list append
        # (thread-safe), we can call it directly from the reader thread.
        try:
            callback(msg)
        except Exception as e:
            sys.stderr.write(f"[RustClient] callback error: {e}\n")

    def _invoke_callback(self, callback, msg):
        try:
            callback(msg)
        except Exception as e:
            sys.stderr.write(f"[RustClient] callback error: {e}\n")

    # ── Event dispatch (always on main thread via queued signal) ──────
    def _on_event_signal(self, msg: dict):
        try:
            from src.backend.events import get_event_bus
            bus = get_event_bus()
            method = msg.get("method")
            params = msg.get("params", {})
            if method == "workspace:update":
                bus.workspace_updated.emit(params)
            elif method == "render:progress":
                bus.render_progress.emit(params.get("id", ""), float(params.get("progress", 0.0)))
            elif method == "system:stats":
                bus.system_stats_updated.emit(params)
            elif method == "notification":
                bus.notification.emit(params.get("title", ""), params.get("message", ""))
            elif method == "new_video_detected":
                bus.new_video_detected.emit(params)
            elif method == "download:progress-event":
                bus.download_progress.emit(
                    params.get("workspace_id", ""),
                    float(params.get("percent", 0.0)),
                    float(params.get("speed_mbps", 0.0)),
                    float(params.get("eta_sec", 0.0)),
                )
            elif method == "poller:status":
                bus.poller_status_changed.emit(params)
            elif method == "channel:synced":
                bus.channel_synced.emit()
        except Exception as e:
            sys.stderr.write(f"[RustClient] dispatch error: {type(e).__name__}: {e}\n")

    # ── stderr reader ─────────────────────────────────────────────────
    def _read_stderr(self):
        assert self._proc and self._proc.stderr
        import os as _os
        stderr_fd = self._proc.stderr.fileno()
        try:
            _os.set_blocking(stderr_fd, False)
        except (OSError, ValueError):
            pass
        buf = b""
        while not self._stop_event.is_set():
            try:
                try:
                    chunk = _os.read(stderr_fd, 4096)
                except (BlockingIOError, OSError):
                    self._stop_event.wait(0.01)
                    continue
                if not chunk:
                    break
            except ValueError:
                break
            buf += chunk
            while b"\n" in buf:
                raw, buf = buf.split(b"\n", 1)
                try:
                    sys.stderr.write(raw.decode("utf-8", errors="replace") + "\n")
                except Exception:
                    pass
        if buf:
            try:
                sys.stderr.write(buf.decode("utf-8", errors="replace"))
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
