import subprocess
import time
import sys

sys.stdout.reconfigure(encoding='utf-8')

ffmpeg_exe = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
video_path = r"D:\LOOP_COMPANY\HyperClip\data\media\Zilk Kay\downloads\8fAExeJIbKQ_20260627_005956.mp4"
thumb_path = r"D:\LOOP_COMPANY\HyperClip\data\media\Zilk Kay\thumbnails\8fAExeJIbKQ.jpg"

out_a = r"d:\LOOP_COMPANY\HyperClip\scratch\method_a.mp4"
out_c = r"d:\LOOP_COMPANY\HyperClip\scratch\method_c.mp4"
out_d = r"d:\LOOP_COMPANY\HyperClip\scratch\method_d.mp4"

# Method A: GPU decode, GPU scale, CPU download, CPU crop, GPU upload
cmd_a = [
    ffmpeg_exe, "-y",
    "-init_hw_device", "cuda=cuda", "-filter_hw_device", "cuda",
    "-hwaccel", "cuda", "-hwaccel_output_format", "cuda",
    "-i", video_path,
    "-framerate", "30", "-i", thumb_path,
    "-filter_complex",
    "[0:v]trim=start=0:duration=300,setpts=PTS-STARTPTS,setpts=0.9090909090909091*PTS,fps=30,scale_cuda=910:512,hwdownload,format=nv12,crop=720:512:95:0,hwupload_cuda[vid]; "
    "[1:v]loop=loop=-1:size=1:start=0,fps=30,format=nv12,hwupload_cuda[bg]; "
    "[bg][vid]overlay_cuda=x=0:y=384:eof_action=repeat,setsar=1 [final]; "
    "[0:a]atrim=start=0:duration=300,asetpts=PTS-STARTPTS,atempo=1.1000[a]",
    "-t", "10",
    "-map", "[final]", "-map", "[a]",
    "-c:v", "hevc_nvenc", "-preset", "p1", "-rc:v", "vbr", "-cq", "18", "-tune", "hq", "-g", "30", "-maxrate", "6M", "-bufsize", "6M", "-multipass", "disabled",
    "-c:a", "aac", "-b:a", "192k", "-r", "30", out_a
]

# Method C: GPU decode, GPU scale, Negative GPU overlay
cmd_c = [
    ffmpeg_exe, "-y",
    "-init_hw_device", "cuda=cuda", "-filter_hw_device", "cuda",
    "-hwaccel", "cuda", "-hwaccel_output_format", "cuda",
    "-i", video_path,
    "-framerate", "30", "-i", thumb_path,
    "-filter_complex",
    "[0:v]trim=start=0:duration=300,setpts=PTS-STARTPTS,setpts=0.9090909090909091*PTS,fps=30,scale_cuda=910:512[vid]; "
    "[1:v]loop=loop=-1:size=1:start=0,fps=30,format=nv12,hwupload_cuda[bg]; "
    "[bg][vid]overlay_cuda=x=-95:y=384:eof_action=repeat,setsar=1 [final]; "
    "[0:a]atrim=start=0:duration=300,asetpts=PTS-STARTPTS,atempo=1.1000[a]",
    "-t", "10",
    "-map", "[final]", "-map", "[a]",
    "-c:v", "hevc_nvenc", "-preset", "p1", "-rc:v", "vbr", "-cq", "18", "-tune", "hq", "-g", "30", "-maxrate", "6M", "-bufsize", "6M", "-multipass", "disabled",
    "-c:a", "aac", "-b:a", "192k", "-r", "30", out_c
]

# Method D: CPU decode, CPU scale, CPU crop, format=nv12, GPU upload
cmd_d = [
    ffmpeg_exe, "-y",
    "-init_hw_device", "cuda=cuda", "-filter_hw_device", "cuda",
    "-i", video_path,  # No hwaccel at decoder level
    "-framerate", "30", "-i", thumb_path,
    "-filter_complex",
    "[0:v]trim=start=0:duration=300,setpts=PTS-STARTPTS,setpts=0.9090909090909091*PTS,fps=30,scale=910:512:flags=fast_bilinear,crop=720:512:95:0,format=nv12,hwupload_cuda[vid]; "
    "[1:v]loop=loop=-1:size=1:start=0,fps=30,format=nv12,hwupload_cuda[bg]; "
    "[bg][vid]overlay_cuda=x=0:y=384:eof_action=repeat,setsar=1 [final]; "
    "[0:a]atrim=start=0:duration=300,asetpts=PTS-STARTPTS,atempo=1.1000[a]",
    "-t", "10",
    "-map", "[final]", "-map", "[a]",
    "-c:v", "hevc_nvenc", "-preset", "p1", "-rc:v", "vbr", "-cq", "18", "-tune", "hq", "-g", "30", "-maxrate", "6M", "-bufsize", "6M", "-multipass", "disabled",
    "-c:a", "aac", "-b:a", "192k", "-r", "30", out_d
]

def run_bench(name, cmd):
    start = time.time()
    res = subprocess.run(cmd, capture_output=True, text=True)
    end = time.time()
    duration = end - start
    print(f"{name}: {duration:.2f}s, Return code: {res.returncode}")
    if res.returncode != 0:
        print(f"Error output: {res.stderr}")

print("Running Method A...")
run_bench("Method A (Baseline)", cmd_a)

print("Running Method C (Negative GPU)...")
run_bench("Method C (Negative GPU)", cmd_c)

print("Running Method D (CPU Decode + GPU Upload)...")
run_bench("Method D (CPU Decode)", cmd_d)
