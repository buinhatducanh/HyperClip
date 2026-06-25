import os
import subprocess
import json

ffprobe = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"
parts = [
    r"d:\LOOP_COMPANY\HyperClip\data\part 1.mp4",
    r"d:\LOOP_COMPANY\HyperClip\data\part 2.mp4"
]

for p in parts:
    print(f"\nVerifying: {p}")
    if os.path.exists(p):
        sz = os.path.getsize(p)
        print(f"Exists! Size: {sz} bytes")
        try:
            cmd = [
                ffprobe, "-v", "error",
                "-show_entries", "format=duration:stream=width,height,codec_name",
                "-of", "json", p
            ]
            res = subprocess.run(cmd, capture_output=True, text=True)
            data = json.loads(res.stdout)
            dur = float(data.get("format", {}).get("duration", 0))
            print(f"  Duration: {dur:.2f} seconds")
            for s in data.get("streams", []):
                print(f"  Stream: {s.get('codec_name')} ({s.get('width')}x{s.get('height')})")
        except Exception as e:
            print("  Probe failed:", e)
    else:
        print("Does not exist!")
