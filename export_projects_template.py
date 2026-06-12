#!/usr/bin/env python3
"""
Export project IDs from old HyperClip-Data/projects/ to a template JSON
that can be filled with credentials and imported into new system.
"""
import json
from pathlib import Path

OLD_PROJECTS_DIR = Path("D:/HyperClip-Data/projects")
TEMPLATE_FILE = Path("data/.hyperclip/projects_template.json")

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
            "source": "D:/HyperClip-Data/projects/" + project_id
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
