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
        """Generate 4 professional chime WAV files in temp dir, load into QSoundEffect."""
        import struct
        import wave
        import tempfile
        import math

        # CapCut/Apple style chimes using harmonic sine wave arpeggios
        # Format: { name: (frequencies_list, duration, arpeggio_delay_sec) }
        tones = {
            "info": ([523.25, 783.99], 0.25, 0.06),          # C5 -> G5 double chime (soft)
            "success": ([523.25, 659.25, 783.99, 1046.50], 0.45, 0.035), # C5->E5->G5->C6 arpeggio (upward chime)
            "warn": ([392.00, 493.88], 0.35, 0.08),           # G4 -> B4 double low chime
            "error": ([220.00, 207.65], 0.40, 0.12),          # A3 -> G#3 dissonant warning chime
        }

        sample_rate = 22050
        temp_dir = tempfile.gettempdir()
        sound_dir = os.path.join(temp_dir, "hyperclip_sounds_v2")
        os.makedirs(sound_dir, exist_ok=True)

        for name, (freqs, duration, delay) in tones.items():
            file_path = os.path.join(sound_dir, f"{name}.wav")
            if not os.path.exists(file_path):
                n_samples = int(sample_rate * duration)
                with wave.open(file_path, "w") as w:
                    w.setnchannels(1)
                    w.setsampwidth(2)
                    w.setframerate(sample_rate)
                    
                    for i in range(n_samples):
                        t = i / sample_rate
                        val = 0.0
                        for idx, freq in enumerate(freqs):
                            note_delay = idx * delay
                            if t > note_delay:
                                note_t = t - note_delay
                                # Exponential decay envelope
                                env = math.exp(-8.0 * note_t)
                                val += math.sin(2 * math.pi * freq * note_t) * env
                        
                        # Normalize and scale to safe amplitude (prevent clipping)
                        val = val / max(len(freqs), 1)
                        sample = int(32767 * 0.45 * val)
                        w.writeframes(struct.pack("<h", sample))

            self._effects[name].setSource(QUrl.fromLocalFile(file_path))
            self._effects[name].setVolume(0.55)

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
