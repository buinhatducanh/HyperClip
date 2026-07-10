import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8')

ffmpeg_exe = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
video_path = r"D:\LOOP_COMPANY\HyperClip\data\media\Zilk Kay\downloads\8fAExeJIbKQ_20260627_005956.mp4"
thumb_path = r"D:\LOOP_COMPANY\HyperClip\data\media\Zilk Kay\thumbnails\8fAExeJIbKQ.jpg"
out_path = r"d:\LOOP_COMPANY\HyperClip\scratch\test_stutter.mp4"

# This command matches the exact customer command structure
cmd = [
    ffmpeg_exe, "-y",
    "-init_hw_device", "cuda=cuda", "-filter_hw_device", "cuda",
    "-hwaccel", "cuda", "-hwaccel_output_format", "cuda",
    "-i", video_path,
    "-framerate", "30", "-i", thumb_path,  # bg
    "-filter_complex",
    "[0:v]trim=start=0:duration=300,setpts=PTS-STARTPTS,setpts=0.9090909090909091*PTS,fps=30,scale_cuda=910:512[vid]; "
    "[1:v]loop=loop=-1:size=1:start=0,fps=30,format=nv12,hwupload_cuda[bg]; "
    "[bg][vid]overlay_cuda=x=-95:y=384:eof_action=repeat,setsar=1 [final]; "
    "[0:a]atrim=start=0:duration=300,asetpts=PTS-STARTPTS,atempo=1.1000[a]",
    "-t", "15",  # render 15 seconds
    "-map", "[final]", "-map", "[a]",
    "-c:v", "hevc_nvenc", "-preset", "p1", "-rc:v", "vbr", "-cq", "18", "-tune", "hq", "-g", "30", "-maxrate", "6M", "-bufsize", "6M", "-multipass", "disabled",
    "-c:a", "aac", "-b:a", "192k", "-r", "30", out_path
]

print("Executing FFmpeg...")
res = subprocess.run(cmd, capture_output=True, text=True)

print(f"Exit code: {res.returncode}")
print("\n--- FFmpeg Stderr Output ---")
print(res.stderr)
