import subprocess
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

ffprobe = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"

def analyze_pts(filepath):
    print(f"\n========================================\nPTS Analysis for: {filepath}")
    cmd = [
        ffprobe, "-v", "error", "-select_streams", "v:0",
        "-show_entries", "packet=pts_time",
        "-of", "json", filepath
    ]
    out = subprocess.check_output(cmd).decode('utf-8')
    data = json.loads(out)
    packets = data.get("packets", [])
    
    # Let's count how many distinct PTS times we have, and check for duplicates or gaps
    pts_times = [float(p.get("pts_time")) for p in packets if p.get("pts_time") is not None]
    print(f"Total video packets: {len(pts_times)}")
    if not pts_times:
        print("No video packets found.")
        return
        
    gaps = []
    for i in range(1, len(pts_times)):
        diff = pts_times[i] - pts_times[i-1]
        if abs(diff - 0.033333) > 0.005:
            gaps.append((i, pts_times[i-1], pts_times[i], diff))
            
    print(f"Number of PTS irregularities (gaps/duplicates): {len(gaps)}")
    if gaps:
        print("First 10 irregularities:")
        for idx, t1, t2, d in gaps[:10]:
            print(f"  At frame {idx:04d}: {t1:.4f}s -> {t2:.4f}s (diff: {d:.4f}s)")
            
analyze_pts(r"d:\LOOP_COMPANY\HyperClip\scratch\speed_test_Cuvid_decoder.mp4")
analyze_pts(r"d:\LOOP_COMPANY\HyperClip\scratch\speed_test_Modern_cuda_hwaccel.mp4")
