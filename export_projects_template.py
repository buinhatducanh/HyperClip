#!/usr/bin/env python3
"""
Export project IDs from old HyperClip-Data/projects/ to a template JSON
that can be filled with credentials and imported into new system.
"""
import os
import json
from pathlib import Path

def find_old_projects_dir() -> Path:
    # 1. Try env var
    env_dir = os.environ.get("HYPERCLIP_DATA_DIR")
    if env_dir:
        p = Path(env_dir) / "projects"
        if p.exists():
            return p
    # 2. Try developer default
    d_path = Path("D:/HyperClip-Data/projects")
    if d_path.exists():
        return d_path
    # 3. Check largest available drive
    if os.name == 'nt':
        for letter in ['C', 'E', 'F', 'G', 'D']:
            p = Path(f"{letter}:/HyperClip-Data/projects")
            if p.exists():
                return p
    # 4. Check APPDATA
    appdata = os.environ.get("APPDATA")
    if appdata:
        p = Path(appdata) / "HyperClip" / "HyperClip-Data" / "projects"
        if p.exists():
            return p
    # Fallback default
    return Path("data/projects")

def get_target_data_dir() -> Path:
    env_dir = os.environ.get("HYPERCLIP_DATA_DIR")
    if env_dir:
        return Path(env_dir)
    local_data = Path("data")
    if local_data.exists() and local_data.is_dir():
        return local_data
    appdata = os.environ.get("APPDATA")
    if appdata:
        return Path(appdata) / "HyperClip"
    return local_data

OLD_PROJECTS_DIR = find_old_projects_dir()
TEMPLATE_FILE = get_target_data_dir() / ".hyperclip" / "projects_template.json"

if not OLD_PROJECTS_DIR.exists():
    print(f"Old projects dir not found: {OLD_PROJECTS_DIR}")
    exit(1)

projects = []

for project_dir in OLD_PROJECTS_DIR.iterdir():
    if not project_dir.is_dir():
        continue

    project_id = project_dir.name

    # Check if it has encrypted config (valid project)
    config_file = project_dir / "config.enc.yaml"
    if not config_file.exists():
        continue

    # Read stats if available
    stats_file = project_dir / "stats.json"
    stats = {}
    if stats_file.exists():
        try:
            with open(stats_file, 'r') as f:
                stats = json.load(f)
        except:
            pass

    # Read encrypted config machineId for reference
    machine_id_short = "unknown"
    try:
        with open(config_file, 'r') as f:
            for line in f:
                if line.startswith('machineId:'):
                    machine_id_short = line.split(':')[-1].strip().strip('"')
                    break
    except:
        pass

    project = {
        "projectId": project_id,
        "name": project_id,  # Will update after filling credentials
        "clientId": "",       # FILL: GCP OAuth client ID
        "clientSecret": "",   # FILL: GCP OAuth client secret
        "healthy": True,
        "quotaUsed": stats.get('usedToday', 0),
        "quotaLimit": 10000,
        "error": None,
        "lastRefresh": int(stats.get('lastUsed', 0) / 1000) if stats.get('lastUsed') else 0,
        "_notes": {
            "originalMachineId": machine_id_short,
            "source": str(OLD_PROJECTS_DIR / project_id)
        }
    }
    projects.append(project)

# Write template
TEMPLATE_FILE.parent.mkdir(parents=True, exist_ok=True)
with open(TEMPLATE_FILE, 'w', encoding='utf-8') as f:
    json.dump({"projects": projects}, f, indent=2, ensure_ascii=False)

print(f"Exported {len(projects)} project IDs to {TEMPLATE_FILE}")
print("\nNext steps:")
print("1. Open the template file")
print("2. Fill in clientId and clientSecret for each project")
print("3. Copy to data/.hyperclip/projects.json")
print("4. Restart app or click 'Test all' in Projects panel")
