import re
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

log_path = r"C:\Users\MSI\Downloads\hyperclip.log - Sao chép.2026-06-27_10-48-43"

print("Analyzing large log file...")

renders = []
workspace_updates = {}

with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
    for line in f:
        clean_line = re.sub(r'\x1b\[[0-9;]*m', '', line).strip()
        
        # Capture render milestones
        if "spawn_render_async" in clean_line:
            renders.append(("start", clean_line))
        elif "render finished" in clean_line.lower() or "render completed" in clean_line.lower() or "render done" in clean_line.lower():
            renders.append(("finish", clean_line))
        elif "took" in clean_line.lower() or "elapsed" in clean_line.lower() or "duration" in clean_line.lower() or "render speed" in clean_line.lower():
            renders.append(("duration", clean_line))
            
        if "workspace:update" in clean_line or "Workspace update" in clean_line:
            m = re.search(r'(?:workspace:update|Workspace update).*?({.*})', clean_line)
            if m:
                try:
                    data = json.loads(m.group(1))
                    ws_id = data.get("id")
                    if ws_id:
                        if ws_id not in workspace_updates:
                            workspace_updates[ws_id] = []
                        workspace_updates[ws_id].append(data)
                except:
                    pass
            else:
                renders.append(("ws_raw", clean_line))

print(f"Total render events captured: {len(renders)}")
print("\n--- Last 50 Render Logs ---")
for event_type, msg in renders[-50:]:
    print(f"[{event_type.upper()}] {msg}")

print("\n--- Recent Workspace Updates summary ---")
for ws_id, updates in list(workspace_updates.items())[-3:]:
    print(f"\nWorkspace: {ws_id} (Total updates: {len(updates)})")
    for u in updates[-5:]:
        status = u.get("status")
        progress = u.get("progress")
        downloaded = u.get("downloadedPath") is not None
        rendered = u.get("renderedPath") is not None
        error = u.get("error")
        print(f"  Status: {status}, Progress: {progress}, Downloaded: {downloaded}, Rendered: {rendered}, Error: {error}")
