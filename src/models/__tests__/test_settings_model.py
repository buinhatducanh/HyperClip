import pytest
from src.models.settings_model import SettingsModel

class MockBackend:
    def __init__(self, should_succeed=True):
        self.should_succeed = should_succeed
        self.last_command = None
        self.last_payload = None

    def send_command(self, cmd, payload=None):
        self.last_command = cmd
        self.last_payload = payload
        if cmd == "settings:get":
            return {
                "ok": True,
                "result": {
                    "outputFolder": "test_folder",
                    "pollIntervalMs": 3000,
                    "pollingEnabled": True,
                }
            }
        elif cmd == "settings:update":
            return {"ok": self.should_succeed}
        return {"ok": False}

def test_settings_initial_state():
    settings = SettingsModel()
    # Initial state clean snapshot is None, so it shouldn't be dirty
    assert not settings.is_dirty

def test_settings_load_makes_it_clean():
    settings = SettingsModel()
    backend = MockBackend()
    assert settings.load_from_backend(backend)
    assert not settings.is_dirty
    assert settings.pollIntervalMs == 3000

def test_settings_modify_makes_it_dirty():
    settings = SettingsModel()
    backend = MockBackend()
    settings.load_from_backend(backend)
    
    # Change a setting
    settings.pollIntervalMs = 5000
    assert settings.is_dirty
    assert settings.pollIntervalMs == 5000

def test_settings_discard_changes():
    settings = SettingsModel()
    backend = MockBackend()
    settings.load_from_backend(backend)
    
    settings.pollIntervalMs = 5000
    assert settings.is_dirty
    
    settings.discard_changes()
    assert not settings.is_dirty
    assert settings.pollIntervalMs == 3000

def test_settings_save_resets_dirty():
    settings = SettingsModel()
    backend = MockBackend()
    settings.load_from_backend(backend)
    
    settings.pollIntervalMs = 5000
    assert settings.is_dirty
    
    # Save successfully
    assert settings.save_to_backend(backend)
    assert not settings.is_dirty
    assert settings.pollIntervalMs == 5000
    assert backend.last_command == "settings:update"
