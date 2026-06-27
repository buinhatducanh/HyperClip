import subprocess
import re
import sys
import json

sys.stdout.reconfigure(encoding='utf-8')

ffmpeg_path = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
ffprobe_path = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"

def count_decimated_frames(filepath):
    print(f"\n========================================\nVisual Duplicate Frame Analysis for: {filepath}")
    
    # 1. Get total frames via ffprobe
    cmd_probe = [
        ffprobe_path, "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=nb_frames",
        "-of", "json", filepath
    ]
    probe_out = subprocess.check_output(cmd_probe).decode('utf-8')
    probe_data = json.loads(probe_out)
    total_frames = int(probe_data["streams"][0].get("nb_frames", 0))
    
    # 2. Run mpdecimate filter
    cmd = [
        ffmpeg_path, "-i", filepath,
        "-vf", "mpdecimate,metadata=mode=print",
        "-f", "null", "-"
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
    
    out_frames = 0
    m = re.findall(r"frame=\s*(\d+)", res.stderr)
    if m:
        out_frames = int(m[-1])
        
    print(f"Total encoded frames: {total_frames}")
    print(f"Frames remaining after mpdecimate (unique): {out_frames}")
    print(f"Number of duplicate/dropped frames: {total_frames - out_frames}")

count_decimated_frames(r"d:\LOOP_COMPANY\HyperClip\scratch\test_render_1_cuvid_decoder.mp4")
count_decimated_frames(r"d:\LOOP_COMPANY\HyperClip\scratch\test_render_2_standard_h264_hwaccel.mp4")
count_decimated_frames(r"d:\LOOP_COMPANY\HyperClip\scratch\test_render_3_cpu_decoder_gpu_encoder.mp4")
count_decimated_frames(r"d:\LOOP_COMPANY\HyperClip\scratch\out_case5.mp4")
count_decimated_frames(r"d:\LOOP_COMPANY\HyperClip\scratch\out_case7.mp4")

