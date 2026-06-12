#!/usr/bin/env python3
"""
Migrate 30 OAuth projects from old Electron format (D:/HyperClip-Data/projects/)
to new Rust format (data/.hyperclip/projects.json).

Old format: Each project has folder with config.enc.yaml, token.enc.yaml, stats.json (AES-256-GCM encrypted)
New format: Single projects.json with array of project objects

Requires machineId from old machine to decrypt.
"""
import os
import json
import base64
import hashlib
from pathlib import Path
from Crypto.Cipher import AES
from Crypto.Protocol.KDF import PBKDF2
from Crypto.Hash import SHA256

OLD_PROJECTS_DIR = Path("D:/HyperClip-Data/projects")
NEW_PROJECTS_FILE = Path("data/.hyperclip/projects.json")

# AES-256-GCM constants from old crypto.ts
ALGORITHM = 'aes-256-gcm'
KEY_LENGTH = 32
IV_LENGTH = 12
AUTH_TAG_LENGTH = 16
SALT_LENGTH = 32
PBKDF2_ITERATIONS = 100_000


def get_machine_id():
    """Get machine ID - same logic as old hwid.ts"""
    import uuid
    import subprocess

    # Windows: use WMIC/PowerShell
    try:
        # Try PowerShell first (Windows 11+)
        result = subprocess.run(
            ['powershell', '-Command', '(Get-CimInstance Win32_ComputerSystemProduct).UUID'],
            capture_output=True, text=True, timeout=10
        )
        uuid_str = result.stdout.strip()
        if 'GUID' in uuid_str:
            return uuid_str.split(':')[-1].strip().lower()
    except:
        pass

    try:
        result = subprocess.run(
            ['wmic', 'csproduct', 'get', 'uuid'],
            capture_output=True, text=True, timeout=10
        )
        for line in result.stdout.split('\n'):
            if line.strip() and 'UUID' not in line:
                return line.strip().lower()
    except:
        pass

    # Fallback
    return str(uuid.getnode())


def derive_key(machine_id: str, salt: bytes) -> bytes:
    """PBKDF2 key derivation - same as old crypto.ts"""
    return PBKDF2(machine_id.encode(), salt, dkLen=KEY_LENGTH, count=PBKDF2_ITERATIONS, hmac_hash_module=SHA256)


def decrypt_blob(blob: dict, machine_id: str) -> dict:
    """Decrypt AES-256-GCM blob"""
    iv = bytes.fromhex(blob['iv'])
    salt = bytes.fromhex(blob['salt'])
    tag = bytes.fromhex(blob['tag'])
    data = base64.b64decode(blob['data'])

    key = derive_key(machine_id, salt)

    cipher = AES.new(key, AES.MODE_GCM, nonce=iv)
    cipher.update(b'')  # No AAD in old implementation
    plaintext = cipher.decrypt_and_verify(data, tag)

    return json.loads(plaintext.decode('utf-8'))


def parse_encrypted_yaml(filepath: Path) -> dict:
    """Parse encrypted YAML file"""
    import yaml
    with open(filepath, 'r') as f:
        content = f.read()

    # Simple YAML parsing for the specific format
    lines = content.strip().split('\n')
    blob = {}
    data_lines = []
    in_data = False

    for line in lines:
        if line.startswith('data: |'):
            in_data = True
            continue
        elif in_data:
            if line.startswith('  '):
                data_lines.append(line.strip())
            else:
                in_data = False
        elif ': ' in line and not in_data:
            key, val = line.split(': ', 1)
            blob[key.strip()] = val.strip().strip('"')

    blob['data'] = ''.join(data_lines)
    return blob


def migrate():
    # Get machine ID
    machine_id = get_machine_id()
    print(f"Machine ID: {machine_id}")
    print(f"Machine ID hash: {hashlib.sha256(machine_id.encode()).hexdigest()}")

    if not OLD_PROJECTS_DIR.exists():
        print(f"Old projects dir not found: {OLD_PROJECTS_DIR}")
        return

    projects = []

    for project_dir in OLD_PROJECTS_DIR.iterdir():
        if not project_dir.is_dir():
            continue

        config_file = project_dir / "config.enc.yaml"
        token_file = project_dir / "token.enc.yaml"
        stats_file = project_dir / "stats.json"

        if not config_file.exists():
            continue

        print(f"\nProcessing: {project_dir.name}")

        try:
            # Decrypt config
            config_blob = parse_encrypted_yaml(config_file)
            config = decrypt_blob(config_blob, machine_id)

            # Decrypt token
            token = None
            if token_file.exists():
                token_blob = parse_encrypted_yaml(token_file)
                token = decrypt_blob(token_blob, machine_id)

            # Read stats (plain JSON)
            stats = {}
            if stats_file.exists():
                with open(stats_file, 'r') as f:
                    stats = json.load(f)

            # Build new format project
            project = {
                "projectId": config.get('projectId', project_dir.name),
                "name": config.get('projectName', config.get('projectId', project_dir.name)),
                "clientId": config.get('clientId', ''),
                "healthy": config.get('status', 'active') != 'exhausted' and config.get('status') != 'unauthorized',
                "quotaUsed": stats.get('usedToday', 0),
                "quotaLimit": 10000,
                "error": None if config.get('status') != 'unauthorized' else 'unauthorized',
                "lastRefresh": int(stats.get('lastUsed', 0) / 1000) if stats.get('lastUsed') else 0
            }

            projects.append(project)
            print(f"  ✓ Migrated: {project['projectId']} ({project['name']})")

        except Exception as e:
            print(f"  Failed: {e}")

    # Write new format
    NEW_PROJECTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(NEW_PROJECTS_FILE, 'w') as f:
        json.dump({"projects": projects}, f, indent=2)

    print(f"\n✓ Migrated {len(projects)} projects to {NEW_PROJECTS_FILE}")


if __name__ == "__main__":
    migrate()
