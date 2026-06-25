import sys
sys.stdout.reconfigure(encoding='utf-8')

with open(r"C:\Users\MSI\Downloads\hyperclip.log.2026-06-25_15-03-51", "rb") as f:
    data = f.read()

text = data.decode("utf-8", errors="ignore")
lines = text.splitlines()

output_lines = []
for i, line in enumerate(lines):
    if any(k in line for k in ["Spawning yt-dlp", "elapsed", "yt-dlp output", "Auto-download", "download", "Download"]):
        output_lines.append(f"{i+1:3d}: {line.strip()}")

with open("scratch/log_matches.txt", "w", encoding="utf-8") as f_out:
    f_out.write("\n".join(output_lines))
print(f"Written {len(output_lines)} lines to scratch/log_matches.txt")


