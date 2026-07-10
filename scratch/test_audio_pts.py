import subprocess
import re

ffmpeg = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
shifted_ts = r"scratch\test_shift.ts"

def get_audio_pts():
    cmd = [ffmpeg, "-hide_banner", "-y", "-i", shifted_ts, "-af", "ashowinfo", "-f", "null", "-"]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
    
    pts_list = []
    # Match lines like: [Parsed_ashowinfo_0 @ 000001f3db98f040] n:   0 pts:     1024 pts_time:0.021333
    for line in res.stderr.splitlines():
        if "Parsed_ashowinfo" in line and "pts_time:" in line:
            match = re.search(r"n:\s*(\d+)\s+pts:\s*(\d+)\s+pts_time:\s*([\d\.-]+)", line)
            if match:
                frame_idx = int(match.group(1))
                pts_time = float(match.group(3))
                pts_list.append((frame_idx, pts_time))
                if len(pts_list) >= 5:
                    break
    return pts_list

print("Decoded audio PTS times:")
try:
    audio_pts = get_audio_pts()
    print(audio_pts)
except Exception as e:
    print("Failed to get audio PTS:", e)
