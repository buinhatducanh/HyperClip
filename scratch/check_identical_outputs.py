import subprocess
import json

ffprobe_exe = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"
out_orig = r"d:\LOOP_COMPANY\HyperClip\scratch\out_orig.mp4"
out_opt2 = r"d:\LOOP_COMPANY\HyperClip\scratch\out_opt2.mp4"

def get_video_info(path):
    cmd = [
        ffprobe_exe, "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=r_frame_rate,nb_frames,duration,width,height",
        "-of", "json", path
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    return json.loads(res.stdout)

info_orig = get_video_info(out_orig)
info_opt2 = get_video_info(out_opt2)

print("Original Video Info:")
print(json.dumps(info_orig, indent=2))
print("Optimized Video Info:")
print(json.dumps(info_opt2, indent=2))

if info_orig == info_opt2:
    print("SUCCESS: Video parameters are identical!")
else:
    print("WARNING: Video parameters differ!")
