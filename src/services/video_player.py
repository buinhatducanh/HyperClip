from PySide6.QtCore import QObject, Signal, Property, Slot, QUrl
from PySide6.QtMultimedia import QMediaPlayer, QAudioOutput
import os
from src.data_dir import get_data_dir


class VideoPlayer(QObject):
    positionChanged = Signal(float)
    durationChanged = Signal(float)
    stateChanged = Signal(int)
    playingChanged = Signal()
    sourceChanged = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._player = QMediaPlayer()
        self._audio = QAudioOutput()
        self._player.setAudioOutput(self._audio)
        self._player.positionChanged.connect(self._on_position)
        self._player.durationChanged.connect(self._on_duration)
        self._player.playbackStateChanged.connect(self._on_state)
        self._source = ""

    def set_video_output(self, widget):
        self._player.setVideoOutput(widget)

    @Slot(str)
    def load(self, relative_path: str):
        abs_path = self._resolve_path(relative_path)
        self._source = relative_path
        self.sourceChanged.emit()
        if abs_path and os.path.exists(abs_path):
            self._player.setSource(QUrl.fromLocalFile(abs_path))
        else:
            self._player.setSource(QUrl())

    def _resolve_path(self, relative_path: str) -> str:
        if not relative_path:
            return ""
        if os.path.isabs(relative_path):
            return relative_path
        
        # 1. Try resolving relative to dynamic media/downloads dir
        p1 = os.path.join(get_data_dir(), "media", relative_path)
        if os.path.exists(p1):
            return p1
            
        p2 = os.path.join(get_data_dir(), relative_path)
        if os.path.exists(p2):
            return p2
            
        # 2. Try relative to CWD
        p3 = os.path.abspath(relative_path)
        if os.path.exists(p3):
            return p3
            
        # 3. Fallback to hardcoded C:/HyperClip-Data/videos if it exists, or p1
        p4 = os.path.join("C:/HyperClip-Data/videos", relative_path)
        if os.path.exists(p4):
            return p4
            
        return p1

    @Slot()
    def play(self): self._player.play()

    @Slot()
    def pause(self): self._player.pause()

    @Slot()
    def stop(self): self._player.stop()

    @Slot(float)
    def seek(self, seconds: float):
        self._player.setPosition(int(seconds * 1000))

    @Slot(float)
    def seek_relative(self, delta: float):
        current = self._player.position() / 1000.0
        self.seek(max(0.0, current + delta))

    @Property(float, notify=positionChanged)
    def position(self) -> float:
        return self._player.position() / 1000.0

    @Property(float, notify=durationChanged)
    def duration(self) -> float:
        return self._player.duration() / 1000.0

    @Property(bool, notify=playingChanged)
    def isPlaying(self) -> bool:
        return self._player.playbackState() == QMediaPlayer.PlayingState

    @Property(str, notify=sourceChanged)
    def source(self) -> str:
        return self._source

    def _on_position(self, ms):
        self.positionChanged.emit(ms / 1000.0)

    def _on_duration(self, ms):
        self.durationChanged.emit(ms / 1000.0)

    def _on_state(self, state):
        self.stateChanged.emit(int(state))
        self.playingChanged.emit()
