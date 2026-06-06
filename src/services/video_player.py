# src/services/video_player.py
from PySide6.QtCore import QObject, Signal, Property, QUrl
from PySide6.QtMultimedia import QMediaPlayer, QAudioOutput
import os


class VideoPlayer(QObject):
    positionChanged = Signal(float)
    durationChanged = Signal(float)
    stateChanged = Signal(int)
    playingChanged = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._player = QMediaPlayer()
        self._audio = QAudioOutput()
        self._player.setAudioOutput(self._audio)
        self._player.positionChanged.connect(self._on_position)
        self._player.durationChanged.connect(self._on_duration)
        self._player.playbackStateChanged.connect(self._on_state)

    def set_video_output(self, widget):
        self._player.setVideoOutput(widget)

    def load(self, relative_path: str):
        abs_path = self._resolve_path(relative_path)
        if os.path.exists(abs_path):
            self._player.setSource(QUrl.fromLocalFile(abs_path))
        else:
            self._player.setSource(QUrl())

    def _resolve_path(self, relative_path: str) -> str:
        if not relative_path:
            return ""
        if os.path.isabs(relative_path):
            return relative_path
        return os.path.join("C:/HyperClip-Data/videos", relative_path)

    def play(self): self._player.play()
    def pause(self): self._player.pause()
    def stop(self): self._player.stop()

    def seek(self, seconds: float):
        self._player.setPosition(int(seconds * 1000))

    def seek_relative(self, delta: float):
        current = self._player.position() / 1000.0
        self.seek(max(0, current + delta))

    @Property(float, notify=positionChanged)
    def position(self) -> float:
        return self._player.position() / 1000.0

    @Property(float, notify=durationChanged)
    def duration(self) -> float:
        return self._player.duration() / 1000.0

    @Property(bool, notify=playingChanged)
    def isPlaying(self) -> bool:
        return self._player.playbackState() == QMediaPlayer.PlayingState

    def _on_position(self, ms):
        self.positionChanged.emit(ms / 1000.0)

    def _on_duration(self, ms):
        self.durationChanged.emit(ms / 1000.0)

    def _on_state(self, state):
        self.stateChanged.emit(int(state))
        self.playingChanged.emit()
