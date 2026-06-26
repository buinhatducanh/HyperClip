import subprocess
import os
import re

ffmpeg = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
ffprobe = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"
input_file = r"scratch\test_poq_dl.mp4"
shifted_ts = r"scratch\test_shift.ts"

if os.path.exists(shifted_ts):
    os.remove(shifted_ts)

# Generate MPEG-TS with shifted timestamps
cmd_shift = [
    ffmpeg, "-hide_banner", "-y",
    "-i", input_file,
    "-vf", "setpts=PTS+5/TB",
    "-af", "asetpts=PTS+5/TB",
    "-c:v", "libx264", "-preset", "ultrafast",
    "-c:a", "aac",
    shifted_ts
]
print("Generating shifted TS file...")
subprocess.run(cmd_shift, capture_output=True)

if not os.path.exists(shifted_ts):
    print("Failed to generate TS file!")
    exit(1)

# Probe TS file
print("Probing TS file:")
out_v = subprocess.check_output([
    ffprobe, "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=start_time",
    "-of", "default=noprint_wrappers=1:nokey=1",
    shifted_ts
]).decode('utf-8').strip()
print(f"  Video start_time: {out_v}")

out_a = subprocess.check_output([
    ffprobe, "-v", "error", "-select_streams", "a:0",
    "-show_entries", "stream=start_time",
    "-of", "default=noprint_wrappers=1:nokey=1",
    shifted_ts
]).decode('utf-8').strip()
print(f"  Audio start_time: {out_a}")

def get_first_few_pts(use_cuda):
    cmd = [ffmpeg, "-hide_banner", "-y"]
    if use_cuda:
        cmd.extend(["-hwaccel", "cuda", "-c:v", "h264_cuvid"])
    cmd.extend(["-i", shifted_ts, "-vf", "showinfo", "-f", "null", "-"])
    
    res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
    
    pts_list = []
    for line in res.stderr.splitlines():
        if "Parsed_showinfo" in line and "pts_time:" in line:
            match = re.search(r"n:\s*(\d+)\s+pts:\s*(\d+)\s+pts_time:\s*([\d\.-]+)", line)
            if match:
                frame_idx = int(match.group(1))
                pts_time = float(match.group(3))
                pts_list.append((frame_idx, pts_time))
                if len(pts_list) >= 5:
                    break
    return pts_list

print("\nComparing Decoded PTS on Shifted TS File:")
try:
    cpu_pts = get_first_few_pts(use_cuda=False)
    print("CPU decoded PTS times:", cpu_pts)
except Exception as e:
    print("CPU Decode failed:", e)

try:
    cuda_pts = get_first_few_pts(use_cuda=True)
    print("CUDA decoded PTS times:", cuda_pts)
except Exception as e:
    print("CUDA Decode failed:", e)
