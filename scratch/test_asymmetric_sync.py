import subprocess
import os
import json
import re

ffmpeg = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
ffprobe = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"
input_file = r"scratch\test_poq_dl.mp4"
asym_ts = r"scratch\test_asymmetric.ts"

if os.path.exists(asym_ts):
    os.remove(asym_ts)

print("1. Generating asymmetric test file (video starts 5s later than audio)...")
cmd_shift = [
    ffmpeg, "-hide_banner", "-y",
    "-i", input_file,
    "-vf", "setpts=PTS+5/TB",
    "-af", "asetpts=PTS/TB",  # audio starts at 0
    "-c:v", "libx264", "-preset", "ultrafast",
    "-c:a", "aac",
    asym_ts
]
subprocess.run(cmd_shift, capture_output=True)

if not os.path.exists(asym_ts):
    print("Failed to generate asymmetric TS file!")
    exit(1)

# Probe the generated file
print("\n2. Probing asymmetric test file:")
out_v = subprocess.check_output([
    ffprobe, "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=start_time",
    "-of", "default=noprint_wrappers=1:nokey=1",
    asym_ts
]).decode('utf-8').strip()
print(f"  Video start_time: {out_v}s")

out_a = subprocess.check_output([
    ffprobe, "-v", "error", "-select_streams", "a:0",
    "-show_entries", "stream=start_time",
    "-of", "default=noprint_wrappers=1:nokey=1",
    asym_ts
]).decode('utf-8').strip()
print(f"  Audio start_time: {out_a}s")

# Let's parse video and audio start times
v_start = float(out_v.split()[0])
a_start = float(out_a.split()[0])

out_a_old = r"scratch\render_method_a.mp4"
out_b_old = r"scratch\render_method_b.mp4"
out_c_new = r"scratch\render_method_c.mp4"

for f in [out_a_old, out_b_old, out_c_new]:
    if os.path.exists(f):
        os.remove(f)

# Method A: Previous compact logic (Video trim start=0, Audio trim start=0)
# Both shifted to 0.0 using PTS-STARTPTS
print("\n3. Rendering Method A (Video trim=0, Audio trim=0, both shifted to 0 via PTS-STARTPTS)...")
cmd_a = [
    ffmpeg, "-hide_banner", "-y",
    "-i", asym_ts,
    "-filter_complex", "[0:v]trim=start=0:duration=10.0,setpts=PTS-STARTPTS[v]; [0:a]atrim=start=0:duration=10.0,asetpts=PTS-STARTPTS[a]",
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-c:a", "aac",
    out_a_old
]
subprocess.run(cmd_a, capture_output=True)

# Method B: Previous compact's OLD logic (Audio trim offset by start time, i.e., atrim=start=5)
print("Rendering Method B (Audio trimmed from 5.0, Video trimmed from 0, both shifted to 0 via PTS-STARTPTS)...")
cmd_b = [
    ffmpeg, "-hide_banner", "-y",
    "-i", asym_ts,
    "-filter_complex", f"[0:v]trim=start=0:duration=10.0,setpts=PTS-STARTPTS[v]; [0:a]atrim=start={v_start}:duration=10.0,asetpts=PTS-STARTPTS[a]",
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-c:a", "aac",
    out_b_old
]
subprocess.run(cmd_b, capture_output=True)

# Method C: Our new mathematically aligned sync logic
# target_container_trim_start = 0.0, video_trim_start = max(5.0, 0.0) = 5.0, video_offset = 5.0
# audio_trim_start = max(0.0, 0.0) = 0.0, audio_offset = 0.0
# Video filter: trim=start=5.0:duration=5.0, setpts=PTS-STARTPTS+5.0/TB
# Audio filter: atrim=start=0.0:duration=10.0, asetpts=PTS-STARTPTS
print("Rendering Method C (Our mathematically aligned sync)...")
video_trim_start = max(v_start, 0.0)
video_offset = video_trim_start - 0.0
video_dur = 10.0 - video_offset

audio_trim_start = max(a_start, 0.0)
audio_offset = audio_trim_start - 0.0
audio_dur = 10.0 - audio_offset

cmd_c = [
    ffmpeg, "-hide_banner", "-y",
    "-i", asym_ts,
    "-filter_complex", f"[0:v]trim=start={video_trim_start}:duration={video_dur},setpts=PTS-STARTPTS+{video_offset}/TB[v]; [0:a]atrim=start={audio_trim_start}:duration={audio_dur},asetpts=PTS-STARTPTS+{audio_offset}/TB[a]",
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-c:a", "aac",
    out_c_new
]
subprocess.run(cmd_c, capture_output=True)

def verify_and_print_pts(path, label):
    print(f"\n--- Verify {label} ---")
    if not os.path.exists(path):
        print("  File not generated!")
        return
    # Use showinfo to print the output frames' PTS
    cmd = [ffmpeg, "-hide_banner", "-i", path, "-vf", "showinfo", "-f", "null", "-"]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
    
    first_v_pts = None
    for line in res.stderr.splitlines():
        if "Parsed_showinfo" in line and "pts_time:" in line:
            match = re.search(r"n:\s*0\s+pts:\s*(\d+)\s+pts_time:\s*([\d\.-]+)", line)
            if match:
                first_v_pts = float(match.group(2))
                break
                
    cmd_a = [ffmpeg, "-hide_banner", "-i", path, "-af", "ashowinfo", "-f", "null", "-"]
    res_a = subprocess.run(cmd_a, capture_output=True, text=True, encoding='utf-8')
    first_a_pts = None
    for line in res_a.stderr.splitlines():
        if "Parsed_ashowinfo" in line and "pts_time:" in line:
            match = re.search(r"n:\s*0\s+pts:\s*(\d+)\s+pts_time:\s*([\d\.-]+)", line)
            if match:
                first_a_pts = float(match.group(2))
                break
                
    print(f"  First Video output PTS: {first_v_pts}s")
    print(f"  First Audio output PTS: {first_a_pts}s")
    
    # Use ffprobe to print stream start times
    cmd_probe = [
        ffprobe, "-v", "error",
        "-show_entries", "format=duration:stream=codec_type,duration,start_time",
        "-of", "json", path
    ]
    res_probe = subprocess.run(cmd_probe, capture_output=True, text=True)
    data = json.loads(res_probe.stdout)
    for s in data.get("streams", []):
        t = s.get("codec_type")
        start = s.get("start_time")
        dur = s.get("duration")
        print(f"  {t.upper()} stream: start_time={start}s, duration={dur}s")

verify_and_print_pts(out_a_old, "Method A (Desynced - Video starts at 0.0s output)")
verify_and_print_pts(out_b_old, "Method B (Cut off - First 5s of audio cut off)")
verify_and_print_pts(out_c_new, "Method C (New Sync - Video starts 5s later than audio)")
