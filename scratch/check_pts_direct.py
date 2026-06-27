import subprocess
import json

ffprobe_path = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"
video_path = r"d:\LOOP_COMPANY\HyperClip\data\renders\part 1.mp4"

def probe_file(path):
    print(f"Probing {path}")
    try:
        cmd = [
            ffprobe_path, "-v", "error", "-select_streams", "v:0",
            "-show_entries", "packet=pts,pts_time,dts,dts_time,flags",
            "-of", "json", path
        ]
        out = subprocess.check_output(cmd).decode('utf-8')
        data = json.loads(out)
        packets = data.get("packets", [])
        print(f"Total video packets: {len(packets)}")
        print("First 30 packets:")
        for i, p in enumerate(packets[:30]):
            print(f"  Pkt {i:02d}: pts={p.get('pts')}, pts_time={p.get('pts_time')}, flags={p.get('flags')}")
    except Exception as e:
        print(f"Error: {e}")

probe_file(video_path)
