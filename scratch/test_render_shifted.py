import subprocess
import os
import json

ffmpeg = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
ffprobe = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"
shifted_ts = r"scratch\test_shift.ts"

out_old = r"scratch\render_old.mp4"
out_new = r"scratch\render_new.mp4"

for f in [out_old, out_new]:
    if os.path.exists(f):
        os.remove(f)

# Old logic: Video trim=0.0, Audio trim=6.4
cmd_old = [
    ffmpeg, "-hide_banner", "-y",
    "-i", shifted_ts,
    "-filter_complex", "[0:v]trim=start=0:duration=3.6,setpts=PTS-STARTPTS[v]; [0:a]atrim=start=6.4:duration=3.6,asetpts=PTS-STARTPTS[a]",
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-c:a", "aac",
    out_old
]

# New logic: Video trim=0.0, Audio trim=0.0
cmd_new = [
    ffmpeg, "-hide_banner", "-y",
    "-i", shifted_ts,
    "-filter_complex", "[0:v]trim=start=0:duration=3.6,setpts=PTS-STARTPTS[v]; [0:a]atrim=start=0.0:duration=3.6,asetpts=PTS-STARTPTS[a]",
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-c:a", "aac",
    out_new
]

print("Running rendering under OLD logic...")
subprocess.run(cmd_old, capture_output=True)

print("Running rendering under NEW logic...")
subprocess.run(cmd_new, capture_output=True)

def verify_output(path, label):
    print(f"\n--- {label} Output ({path}) ---")
    if not os.path.exists(path):
        print("  File not generated!")
        return
    
    cmd = [
        ffprobe, "-v", "error",
        "-show_entries", "format=duration:stream=codec_type,duration,start_time",
        "-of", "json", path
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    data = json.loads(res.stdout)
    
    print(f"  Format duration: {data.get('format', {}).get('duration')}s")
    for s in data.get("streams", []):
        t = s.get("codec_type")
        start = s.get("start_time")
        dur = s.get("duration")
        print(f"  {t.upper()} stream: start_time={start}s, duration={dur}s")

verify_output(out_old, "OLD LOGIC")
verify_output(out_new, "NEW LOGIC (FIXED)")
