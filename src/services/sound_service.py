"""SoundService — phát âm thanh notification dùng QSoundEffect (cross-platform, không cần thư viện ngoài)."""
from PySide6.QtCore import QObject, Slot, QUrl
from PySide6.QtMultimedia import QSoundEffect
import os
import sys


class SoundService(QObject):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._enabled: bool = True
        # Three built-in tones (Windows system sounds)
        # We use QSoundEffect with file URLs — but we generate WAVs in-memory for portability
        self._effects = {
            "info": QSoundEffect(self),
            "success": QSoundEffect(self),
            "warn": QSoundEffect(self),
            "error": QSoundEffect(self),
        }

        # Generate simple beep tones on init — pure Python, no files needed
        self._setup_tones()

    def _setup_tones(self):
        """Generate 4 short tone WAV files in temp dir, load into QSoundEffect."""
        import struct
        import wave
        import tempfile

        tones = {
            "info": (880, 0.08),      # A5 note, short
            "success": (1320, 0.12),  # E6 note
            "warn": (660, 0.18),      # E5 note, longer
            "error": (440, 0.25),     # A4 note, longest
        }

        sample_rate = 22050
        temp_dir = tempfile.gettempdir()
        os.makedirs(os.path.join(temp_dir, "hyperclip_sounds"), exist_ok=True)

        for name, (freq, duration) in tones.items():
            file_path = os.path.join(temp_dir, "hyperclip_sounds", f"{name}.wav")
            if not os.path.exists(file_path):
                n_samples = int(sample_rate * duration)
                with wave.open(file_path, "w") as w:
                    w.setnchannels(1)
                    w.setsampwidth(2)
                    w.setframerate(sample_rate)
                    for i in range(n_samples):
                        # Sine wave with envelope (fade out)
                        envelope = 1.0 - (i / n_samples) * 0.7
                        sample = int(32767 * 0.3 * envelope *
                                     (1 if (i // int(sample_rate / freq)) % 2 == 0 else -1))
                        w.writeframes(struct.pack("<h", sample))

            self._effects[name].setSource(QUrl.fromLocalFile(file_path))
            self._effects[name].setVolume(0.5)

    @Slot(str)
    def play(self, level: str = "info"):
        if not self._enabled:
            return
        effect = self._effects.get(level, self._effects["info"])
        if effect.source() and not effect.isPlaying():
            effect.play()

    @Slot()
    def stopAll(self):
        for e in self._effects.values():
            e.stop()

    @Slot(bool)
    def setEnabled(self, enabled: bool):
        self._enabled = bool(enabled)
