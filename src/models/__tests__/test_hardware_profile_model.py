import pytest
from src.models.hardware_profile_model import HardwareProfileModel
from src.models.settings_model import SettingsModel

class MockBackend:
    def __init__(self, should_succeed=True):
        self.should_succeed = should_succeed
        self.last_command = None
        self.last_payload = None
        self.saved_profile = None

    def send_command(self, cmd, payload=None):
        self.last_command = cmd
        self.last_payload = payload
        if cmd == "settings:get":
            return {
                "ok": True,
                "result": {
                    "hardwareProfile": self.saved_profile
                }
            }
        elif cmd == "settings:update":
            if self.should_succeed and payload and "hardwareProfile" in payload:
                self.saved_profile = payload["hardwareProfile"]
            return {"ok": self.should_succeed}
        elif cmd == "hardware:profile":
            active_id = "ultra"
            if self.saved_profile:
                v = self.saved_profile.get("vramGB")
                if v == 16: active_id = "ultra"
                elif v == 12: active_id = "high"
                elif v == 8: active_id = "medium"
                elif v == 6: active_id = "low"
                elif v == 4: active_id = "minimal"
            return {
                "ok": True,
                "result": {
                    "detected": {"gpuName": "RTX 5080", "vramGB": 16, "ramGB": 64},
                    "active": active_id
                }
            }
        return {"ok": False}

def test_hardware_profile_initialization():
    hw = HardwareProfileModel()
    assert hw.detectedGpuName == "—"
    assert hw.detectedVramGb == 0
    assert hw.detectedRamGb == 0
    assert hw.activeId == ""
    assert hw.activeLabel == "Auto"

def test_hardware_profile_refresh():
    hw = HardwareProfileModel()
    backend = MockBackend()
    hw.refresh_from_backend(backend)
    assert hw.detectedGpuName == "RTX 5080"
    assert hw.detectedVramGb == 16
    assert hw.detectedRamGb == 64
    assert hw.activeId == "ultra"
    assert hw.activeLabel == "Ultra"

def test_hardware_profile_select_preset_saves_explicitly():
    hw = HardwareProfileModel()
    settings = SettingsModel()
    backend = MockBackend()
    
    # Refresh initial state
    hw.refresh_from_backend(backend)
    assert hw.activeId == "ultra"
    
    # Select low preset (6 VRAM)
    success = hw.select_preset(backend, settings, "low")
    assert success
    assert hw.activeId == "low"
    assert backend.saved_profile == {"vramGB": 6, "ramGB": 24}
    assert settings.hardwareVramGb == 6
    assert settings.hardwareRamGb == 24

    # Select ultra preset (16 VRAM) while ultra is already selected/active (it should NOT toggle to None now!)
    # Let's first make it low, then select ultra, then select ultra again.
    success = hw.select_preset(backend, settings, "ultra")
    assert success
    assert hw.activeId == "ultra"
    assert backend.saved_profile == {"vramGB": 16, "ramGB": 64}
    assert settings.hardwareVramGb == 16
    assert settings.hardwareRamGb == 64

    # Select ultra AGAIN. Under old logic, this would toggle to None/null.
    # Under new logic, it should stay explicitly saved as ultra/16 VRAM.
    success = hw.select_preset(backend, settings, "ultra")
    assert success
    assert hw.activeId == "ultra"
    assert backend.saved_profile == {"vramGB": 16, "ramGB": 64}
    assert settings.hardwareVramGb == 16
    assert settings.hardwareRamGb == 64
