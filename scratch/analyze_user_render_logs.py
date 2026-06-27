import sys
sys.stdout.reconfigure(encoding='utf-8')

log_path = r"C:\Users\MSI\Downloads\hyperclip.log - Sao chép.2026-06-27_10-33-13"
with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
    lines = f.readlines()

print(f"Total lines in log: {len(lines)}")

# Find index of "Spawning FFmpeg"
spawn_idx = -1
for i, line in enumerate(lines):
    if "Spawning FFmpeg:" in line:
        spawn_idx = i
        print(f"Found 'Spawning FFmpeg' at line {i+1}")
        break

# Search for all Spawning FFmpeg instances and their outcomes
print("\n--- All FFmpeg Spawns ---")
spawn_indices = [i for i, line in enumerate(lines) if "Spawning FFmpeg:" in line]
print(f"Total FFmpeg renders: {len(spawn_indices)}")
for idx in spawn_indices:
    print(f"Line {idx+1}: {lines[idx].strip()[:300]}")
    # Print the next 20 lines to see progress and final speed
    print("  Progress:")
    for j in range(idx + 1, min(idx + 100, len(lines))):
        if "[FFmpeg progress]" in lines[j] or "Lsize=" in lines[j] or "Error" in lines[j] or "Aborted" in lines[j] or "crashed" in lines[j] or "Finished" in lines[j]:
            print(f"    Line {j+1}: {lines[j].strip()}")

print("\n--- CPU/GPU Worker Info or Performance Bottlenecks ---")
for line in lines:
    if any(k in line.lower() for k in ["worker", "session", "thread", "queue", "capacity", "slow", "delay", "lag"]):
        if not any(x in line for x in ["get_latest_videos", "innertube_client", "poller", "Cookie updated", "Skipping video"]):
            print(line.strip())




