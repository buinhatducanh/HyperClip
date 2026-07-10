import subprocess
import os
import re
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

ffmpeg = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
ffprobe = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"

# Find a valid downloaded video to test
video_path = r"d:\LOOP_COMPANY\HyperClip\data\media\Nhật Đức Anh Bùi\downloads\EqWMOrNVnjU_20260625_110529.mp4"
if not os.path.exists(video_path):
    # Fallback to look for other videos
    import glob
    candidates = glob.glob(r"d:\LOOP_COMPANY\HyperClip\data\media\*\downloads\*.mp4")
    if candidates:
        video_path = candidates[0]
    else:
        print("Error: No test video found.")
        exit(1)

print(f"Using test video: {video_path}")

# Create dummy background image
dummy_bg = r"d:\LOOP_COMPANY\HyperClip\scratch\dummy_bg.png"
subprocess.run([ffmpeg, "-y", "-f", "lavfi", "-i", "color=c=gray:s=720x1280", "-vframes", "1", dummy_bg], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def run_test(name, decode_args):
    out_path = f"d:\\LOOP_COMPANY\\HyperClip\\scratch\\speed_test_{name}.mp4"
    if os.path.exists(out_path):
        os.remove(out_path)
    
    # We build the same filter graph as the client uses
    filter_complex = (
        "[0:v]trim=start=0:duration=10,setpts=PTS-STARTPTS,setpts=0.9090909090909091*PTS,fps=30,scale_cuda=720:512[vid]; "
        "[1:v]loop=loop=-1:size=1:start=0,fps=30,format=nv12,hwupload_cuda[bg]; "
        "[bg][vid]overlay_cuda=x=0:y=384:eof_action=repeat,setsar=1 [final]"
    )
    
    cmd = [ffmpeg, "-hide_banner", "-y"]
    cmd.extend(decode_args)
    cmd.extend([
        "-i", video_path,
        "-framerate", "30", "-i", dummy_bg,
        "-filter_complex", filter_complex,
        "-t", "9.09",
        "-map", "[final]",
        "-c:v", "hevc_nvenc", "-preset", "p1", "-rc:v", "vbr", "-cq", "18", "-tune", "hq", "-g", "30",
        out_path
    ])
    
    print(f"\n--- Testing: {name} ---")
    import time
    t0 = time.time()
    res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
    dt = time.time() - t0
    print(f"Render time: {dt:.4f}s")
    if res.returncode != 0:
        print("FAILED to render:")
        print(res.stderr[-1000:])
        return None
    
    # Run mpdecimate to see duplicate frames
    cmd_dec = [
        ffmpeg, "-hide_banner", "-i", out_path,
        "-vf", "mpdecimate,metadata=mode=print",
        "-f", "null", "-"
    ]
    res_dec = subprocess.run(cmd_dec, capture_output=True, text=True, encoding='utf-8')
    
    out_frames = 0
    m = re.findall(r"frame=\s*(\d+)", res_dec.stderr)
    if m:
        out_frames = int(m[-1])
        
    print(f"Total encoded frames: {int(9.09 * 30)}")
    print(f"Unique frames remaining: {out_frames}")
    print(f"Duplicate frames dropped: {int(9.09 * 30) - out_frames}")
    return out_frames

# 1. CUVID decoder option (like client used)
run_test("Cuvid_decoder", [
    "-init_hw_device", "cuda=cuda", "-filter_hw_device", "cuda",
    "-hwaccel", "cuda", "-hwaccel_output_format", "cuda",
    "-c:v", "h264_cuvid"
])

# 2. Modern cuda hwaccel (no cuvid)
run_test("Modern_cuda_hwaccel", [
    "-init_hw_device", "cuda=cuda", "-filter_hw_device", "cuda",
    "-hwaccel", "cuda", "-hwaccel_output_format", "cuda"
])
