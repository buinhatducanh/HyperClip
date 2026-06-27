import re

log_path = r"C:\Users\MSI\Downloads\hyperclip.log.2026-06-27_07-50-04"

# Search for lines containing "ffmpeg", "gpu", "render", "speed", "settings"
keywords = ["ffmpeg", "[GPU]", "render"]
exclude_keywords = ["got 100 videos", "skipping video", "polling", "innertube_client", "chrome_watcher", "cookies"]

output_lines = []
with open(log_path, 'r', encoding='utf-8') as f:
    for line in f:
        line_lower = line.lower()
        if any(kw in line_lower for kw in keywords) and not any(ex in line_lower for ex in exclude_keywords):
            output_lines.append(line.strip())

print(f"Total matching lines: {len(output_lines)}")

# Let's save matches to a new file
with open("scratch/parsed_log_renders.txt", "w", encoding="utf-8") as out:
    out.write("\n".join(output_lines))

print("Saved to scratch/parsed_log_renders.txt")
