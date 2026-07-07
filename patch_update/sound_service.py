from PySide6.QtCore import QObject, Slot
import os
import sys
import ctypes

class SoundService(QObject):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._enabled: bool = True
        # On Windows, we use MessageBeep. On other platforms, we could use QSoundEffect.
        self._is_windows = sys.platform == 'win32'

    @Slot(str)
    def play(self, level: str = "info"):
        if not self._enabled:
            return

        if self._is_windows:
            # MB_OK = 0x00 (Default beep)
            # MB_ICONHAND = 0x10 (Error)
            # MB_ICONEXCLAMATION = 0x30 (Warning)
            # MB_ICONASTERISK = 0x40 (Info/Success)
            
            sound_type = 0x00 # Default (same as volume change)
            if level == "error":
                sound_type = 0x10
            elif level == "warn":
                sound_type = 0x30
            elif level == "success" or level == "info":
                sound_type = 0x40
            
            try:
                # Use MessageBeep for system-integrated sound
                ctypes.windll.user32.MessageBeep(sound_type)
            except Exception:
                pass
        else:
            # Fallback for non-windows (though this app is windows-centric)
            pass

    @Slot()
    def stopAll(self):
        pass

    @Slot(bool)
    def setEnabled(self, enabled: bool):
        self._enabled = bool(enabled)
