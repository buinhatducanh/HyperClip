import subprocess
import os
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

ffmpeg = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
ffprobe = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"

input_video = r"d:\LOOP_COMPANY\HyperClip\data\media\Zilk Kay\downloads\aRsM4G3T5uo_20260625_073853.mp4"
out_test = r"d:\LOOP_COMPANY\HyperClip\scratch\test_method_b_out.mp4"

if os.path.exists(out_test):
    os.remove(out_test)

dummy_blur = r"d:\LOOP_COMPANY\HyperClip\scratch\dummy_blur.jpg"
dummy_thumb = r"d:\LOOP_COMPANY\HyperClip\scratch\dummy_thumb.jpg"
dummy_bar = r"d:\LOOP_COMPANY\HyperClip\scratch\dummy_bar.png"

# Method B: Trim both at max(video_start, audio_start) = 6.4
trim_start = 6.4
trim_duration = 30.0

cmd = [
    ffmpeg, "-hide_banner", "-y",
    "-hwaccel", "cuda",
    "-hwaccel_output_format", "cuda",
    "-c:v", "h264_cuvid",
    "-i", input_video,
    "-i", dummy_blur,
    "-i", dummy_thumb,
    "-i", dummy_bar,
    "-filter_complex", (
        f"[0:v]trim=start={trim_start}:duration={trim_duration},setpts=PTS-STARTPTS,fps=30[vid]; "
        f"[1:v]scale=736:1280:force_original_aspect_ratio=increase,crop=736:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,fps=30,hwupload_cuda,scale_cuda=w=736:h=1280:format=nv12[bg]; "
        f"[bg][vid]overlay_cuda=0:384 [vz]; "
        f"[2:v]scale=736:384:force_original_aspect_ratio=increase,crop=736:384:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,hwupload_cuda,scale_cuda=w=736:h=384:format=nv12[hd]; "
        f"[vz][hd]overlay_cuda=0:0 [vh]; "
        f"[3:v]format=yuv420p,hwupload_cuda,scale_cuda=w=736:h=384:format=nv12[bb]; "
        f"[vh][bb]overlay_cuda=0:896,setsar=1 [vf]; "
        f"[vf]setpts=0.8333333333333334*PTS[final]; "
        f"[0:a]atrim=start={trim_start}:duration={trim_duration},asetpts=PTS-STARTPTS,atempo=1.2[a]"
    ),
    "-t", "25.0",
    "-map", "[final]", "-map", "[a]",
    "-c:v", "h264_nvenc", "-preset", "p4", "-rc:v", "vbr", "-cq", "18", "-tune", "ull",
    "-bf", "0", "-refs", "1", "-g", "30", "-maxrate", "6M", "-bufsize", "6M", "-multipass", "disabled",
    "-c:a", "aac", "-b:a", "192k",
    out_test
]

print("Running command with Method B (trim_start=6.4)...")
res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
print("Exit code:", res.returncode)

if res.returncode == 0:
    # Probe output PTS
    try:
        cmd_probe = [
            ffprobe, "-v", "error", "-select_streams", "v:0",
            "-show_entries", "packet=pts_time",
            "-of", "json", out_test
        ]
        out = subprocess.check_output(cmd_probe).decode('utf-8')
        data = json.loads(out)
        packets = data.get("packets", [])
        print(f"Total video packets in output: {len(packets)}")
        if packets:
            print("First 15 Video packets:")
            for i, pkt in enumerate(packets[:15]):
                print(f"  Pkt {i}: pts_time={pkt.get('pts_time')}")
    except Exception as e:
        print("Probe error:", e)
else:
    print("Stderr:", res.stderr.decode('utf-8', errors='ignore'))
