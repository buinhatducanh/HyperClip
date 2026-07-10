import subprocess
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

ffprobe = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"

def analyze_file_pts(filepath):
    print(f"\n========================================\nAnalyzing PTS for: {filepath}")
    
    # Run ffprobe to get packet info for the first 15 video packets
    try:
        cmd = [
            ffprobe, "-v", "error", "-select_streams", "v:0",
            "-show_entries", "packet=pts,pts_time,dts,dts_time,flags",
            "-of", "json", filepath
        ]
        out = subprocess.check_output(cmd).decode('utf-8')
        data = json.loads(out)
        packets = data.get("packets", [])
        print(f"First 15 Video packets (total packets: {len(packets)}):")
        for i, pkt in enumerate(packets[:15]):
            print(f"  Pkt {i}: pts={pkt.get('pts')}, pts_time={pkt.get('pts_time')}, flags={pkt.get('flags')}")
    except Exception as e:
        print(f"Error getting video packets: {e}")

    # Run ffprobe to get packet info for the first 15 audio packets
    try:
        cmd = [
            ffprobe, "-v", "error", "-select_streams", "a:0",
            "-show_entries", "packet=pts,pts_time,dts,dts_time",
            "-of", "json", filepath
        ]
        out = subprocess.check_output(cmd).decode('utf-8')
        data = json.loads(out)
        packets = data.get("packets", [])
        print(f"First 15 Audio packets (total packets: {len(packets)}):")
        for i, pkt in enumerate(packets[:15]):
            print(f"  Pkt {i}: pts={pkt.get('pts')}, pts_time={pkt.get('pts_time')}")
    except Exception as e:
        print(f"Error getting audio packets: {e}")

analyze_file_pts(r"d:\LOOP_COMPANY\HyperClip\data\media\ch1778770285853\downloads\EqWMOrNVnjU_20260625_103852.mp4")
