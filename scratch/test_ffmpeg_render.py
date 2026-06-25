import subprocess
import os
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

ffmpeg = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
ffprobe = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"

input_video = r"d:\LOOP_COMPANY\HyperClip\data\media\Nhật Đức Anh Bùi\downloads\EqWMOrNVnjU_20260625_070440.mp4"
out_no_loop = r"d:\LOOP_COMPANY\HyperClip\scratch\render_no_loop.mp4"
out_with_loop = r"d:\LOOP_COMPANY\HyperClip\scratch\render_with_loop.mp4"

# Remove old outputs if they exist
for f in [out_no_loop, out_with_loop]:
    if os.path.exists(f):
        os.remove(f)

# Settings from workspaces/settings
canvas_w, canvas_h = 736, 1280
header_h, bottom_bar_h = 384, 384
video_h = canvas_h - header_h - bottom_bar_h  # 512
video_top = header_h

# Common parameters
fps = 30
trim_start = 4.9
trim_duration = 30.0
total_duration_str = "25.0" # with speed 1.2, 30.0 / 1.2 = 25.0

# ----------------- Render WITHOUT Loop -----------------
print("\n--- Running Render WITHOUT Loop ---")
filter_no_loop = (
    f"[0:v]trim=start={trim_start}:duration={trim_duration},setpts=PTS-STARTPTS,fps={fps}[vid]; "
    f"[1:v]scale={canvas_w}:{canvas_h}:force_original_aspect_ratio=increase,crop={canvas_w}:{canvas_h}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,fps={fps},hwupload_cuda,scale_cuda=w={canvas_w}:h={canvas_h}:format=nv12[bg]; "
    f"[bg][vid]overlay_cuda=0:{video_top} [vz]; "
    f"[2:v]scale={canvas_w}:{header_h}:force_original_aspect_ratio=increase,crop={canvas_w}:{header_h}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,hwupload_cuda,scale_cuda=w={canvas_w}:h={header_h}:format=nv12[hd]; "
    f"[vz][hd]overlay_cuda=0:0 [vh]; "
    f"[3:v]format=yuv420p,hwupload_cuda,scale_cuda=w={canvas_w}:h={bottom_bar_h}:format=nv12[bb]; "
    f"[vh][bb]overlay_cuda=0:{canvas_h - bottom_bar_h},setsar=1 [vf]; "
    f"[vf]setpts=0.8333333333333334*PTS[final]; "
    f"[0:a]atrim=start={trim_start}:duration={trim_duration},asetpts=PTS-STARTPTS,atempo=1.2[a]"
)

cmd_no_loop = [
    ffmpeg, "-hide_banner", "-y",
    "-hwaccel", "cuda", "-hwaccel_output_format", "cuda",
    "-c:v", "h264_cuvid", "-i", input_video,
    "-f", "lavfi", "-i", f"color=c=0x2d2d2d:s={canvas_w}x{canvas_h}:d=0.04",
    "-f", "lavfi", "-i", f"color=c=0x0d0d0d:s={canvas_w}x{header_h}:d=0.04",
    "-f", "lavfi", "-i", f"color=c=0x1a1a1a:s={canvas_w}x{bottom_bar_h}:d=0.04",
    "-filter_complex", filter_no_loop,
    "-t", total_duration_str,
    "-map", "[final]", "-map", "[a]",
    "-c:v", "h264_nvenc", "-preset", "p4", "-rc:v", "vbr", "-cq", "18",
    "-tune", "ull", "-bf", "0", "-refs", "1", "-g", "30", "-maxrate", "6M", "-bufsize", "6M",
    "-multipass", "disabled", "-c:a", "aac", "-b:a", "192k",
    out_no_loop
]

print("Executing: " + " ".join(cmd_no_loop))
subprocess.run(cmd_no_loop, check=True)

# ----------------- Render WITH Loop -----------------
print("\n--- Running Render WITH Loop ---")
filter_with_loop = (
    f"[0:v]trim=start={trim_start}:duration={trim_duration},setpts=PTS-STARTPTS,fps={fps}[vid]; "
    f"[1:v]loop=loop=-1:size=1:start=0,scale={canvas_w}:{canvas_h}:force_original_aspect_ratio=increase,crop={canvas_w}:{canvas_h}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,fps={fps},hwupload_cuda,scale_cuda=w={canvas_w}:h={canvas_h}:format=nv12[bg]; "
    f"[bg][vid]overlay_cuda=0:{video_top} [vz]; "
    f"[2:v]loop=loop=-1:size=1:start=0,scale={canvas_w}:{header_h}:force_original_aspect_ratio=increase,crop={canvas_w}:{header_h}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,hwupload_cuda,scale_cuda=w={canvas_w}:h={header_h}:format=nv12[hd]; "
    f"[vz][hd]overlay_cuda=0:0 [vh]; "
    f"[3:v]loop=loop=-1:size=1:start=0,format=yuv420p,hwupload_cuda,scale_cuda=w={canvas_w}:h={bottom_bar_h}:format=nv12[bb]; "
    f"[vh][bb]overlay_cuda=0:{canvas_h - bottom_bar_h},setsar=1 [vf]; "
    f"[vf]setpts=0.8333333333333334*PTS[final]; "
    f"[0:a]atrim=start={trim_start}:duration={trim_duration},asetpts=PTS-STARTPTS,atempo=1.2[a]"
)

cmd_with_loop = [
    ffmpeg, "-hide_banner", "-y",
    "-hwaccel", "cuda", "-hwaccel_output_format", "cuda",
    "-c:v", "h264_cuvid", "-i", input_video,
    "-f", "lavfi", "-i", f"color=c=0x2d2d2d:s={canvas_w}x{canvas_h}:d=0.04",
    "-f", "lavfi", "-i", f"color=c=0x0d0d0d:s={canvas_w}x{header_h}:d=0.04",
    "-f", "lavfi", "-i", f"color=c=0x1a1a1a:s={canvas_w}x{bottom_bar_h}:d=0.04",
    "-filter_complex", filter_with_loop,
    "-t", total_duration_str,
    "-map", "[final]", "-map", "[a]",
    "-c:v", "h264_nvenc", "-preset", "p4", "-rc:v", "vbr", "-cq", "18",
    "-tune", "ull", "-bf", "0", "-refs", "1", "-g", "30", "-maxrate", "6M", "-bufsize", "6M",
    "-multipass", "disabled", "-c:a", "aac", "-b:a", "192k",
    out_with_loop
]

print("Executing: " + " ".join(cmd_with_loop))
subprocess.run(cmd_with_loop, check=True)

# ----------------- Verification -----------------
print("\n========================================\nVerification results:")
def probe_output(filepath):
    print(f"\nProbing: {filepath}")
    # Run ffprobe to check video packet PTS
    try:
        cmd = [
            ffprobe, "-v", "error", "-select_streams", "v:0",
            "-show_entries", "packet=pts_time",
            "-of", "json", filepath
        ]
        out = subprocess.check_output(cmd).decode('utf-8')
        data = json.loads(out)
        packets = data.get("packets", [])
        print(f"Total video packets: {len(packets)}")
        if packets:
            print("First 5 Video packets:")
            for i, pkt in enumerate(packets[:5]):
                print(f"  Pkt {i}: pts_time={pkt.get('pts_time')}")
    except Exception as e:
        print(f"Error: {e}")

probe_output(out_no_loop)
probe_output(out_with_loop)
