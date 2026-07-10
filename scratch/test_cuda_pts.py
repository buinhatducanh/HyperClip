import subprocess
import re

ffmpeg = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
input_file = r"scratch\test_poq_dl.mp4"

def get_first_few_pts(use_cuda):
    cmd = [ffmpeg, "-hide_banner", "-y"]
    if use_cuda:
        cmd.extend(["-hwaccel", "cuda", "-hwaccel_output_format", "cuda", "-c:v", "h264_cuvid"])
    cmd.extend(["-i", input_file, "-vf", "showinfo", "-f", "null", "-"])
    
    print(f"Running decode with {'CUDA' if use_cuda else 'CPU'}...")
    res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
    
    pts_list = []
    # Match lines like: [Parsed_showinfo_0 @ 0000021fb2788e00] n:   0 pts:   5760 pts_time:6.4
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

print("Comparing PTS of decoded frames:")
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
