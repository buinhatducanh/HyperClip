import subprocess
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

ffmpeg_exe = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
video_path = r"d:\LOOP_COMPANY\HyperClip\scratch\method_d.mp4"

cmd = [ffmpeg_exe, "-i", video_path, "-vf", "showinfo", "-f", "null", "-"]
res = subprocess.run(cmd, capture_output=True, text=True)

lines = res.stderr.split('\n')
frames = []
for line in lines:
    if "showinfo" in line and "n:" in line:
        # Extract frame index, pts, pts_time, and checksum
        # Example line: [Parsed_showinfo_0 @ 0000021c3246a480] n:   0 pts:      0 pts_time:0       pos:     48 ... checksum:D72B70FF ...
        n_match = re.search(r'\bn:\s*(\d+)', line)
        pts_match = re.search(r'\bpts:\s*(\d+)', line)
        pts_time_match = re.search(r'\bpts_time:\s*([\d\.]+)', line)
        checksum_match = re.search(r'\bchecksum:\s*([0-9A-F]+)', line)
        
        if n_match and pts_match and checksum_match:
            frames.append({
                'n': int(n_match.group(1)),
                'pts': int(pts_match.group(1)),
                'pts_time': float(pts_time_match.group(1)) if pts_time_match else 0.0,
                'checksum': checksum_match.group(1)
            })

print(f"Parsed {len(frames)} frames.")
dup_count = 0
for i in range(1, len(frames)):
    if frames[i]['checksum'] == frames[i-1]['checksum']:
        dup_count += 1
        if dup_count <= 20:
            print(f"Frame {frames[i]['n']} at {frames[i]['pts_time']}s is a duplicate of {frames[i-1]['n']}")

print(f"Total Duplicate frames: {dup_count} ({dup_count / len(frames) * 100:.2f}%)")
