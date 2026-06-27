import subprocess
import time
import os

ffmpeg_exe = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
video_path = r"D:\LOOP_COMPANY\HyperClip\data\media\Zilk Kay\downloads\8fAExeJIbKQ_20260627_005956.mp4"
thumb_path = r"D:\LOOP_COMPANY\HyperClip\data\media\Zilk Kay\thumbnails\8fAExeJIbKQ.jpg"

out_orig = r"d:\LOOP_COMPANY\HyperClip\scratch\out_orig_full.mp4"
out_opt2 = r"d:\LOOP_COMPANY\HyperClip\scratch\out_opt2_full.mp4"

# Clean up outputs
for path in [out_orig, out_opt2]:
    if os.path.exists(path):
        os.remove(path)

# Original Command (Full 5 min)
cmd_orig = [
    ffmpeg_exe, "-hide_banner", "-y",
    "-init_hw_device", "cuda=cuda", "-filter_hw_device", "cuda",
    "-hwaccel", "cuda", "-hwaccel_output_format", "cuda",
    "-i", video_path,
    "-framerate", "30", "-i", thumb_path,  # bg
    "-framerate", "30", "-i", thumb_path,  # hd
    "-framerate", "30", "-i", thumb_path,  # bb
    "-filter_complex",
    "[0:v]trim=start=0:duration=300,setpts=PTS-STARTPTS,setpts=0.9090909090909091*PTS,fps=30,scale_cuda=910:512,hwdownload,format=nv12,crop=720:512:95:0,hwupload_cuda[vid]; "
    "[1:v]loop=loop=-1:size=1:start=0,fps=30,scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,format=nv12,hwupload_cuda[bg]; "
    "[bg][vid]overlay_cuda=x=0:y=384:eof_action=repeat [vz]; "
    "[2:v]loop=loop=-1:size=1:start=0,fps=30,scale=720:384:force_original_aspect_ratio=increase,crop=720:384:(ow-iw)/2:(oh-ih)/2,setsar=1,format=nv12,hwupload_cuda[hd]; "
    "[vz][hd]overlay_cuda=x=0:y=0:eof_action=repeat [vh]; "
    "[3:v]loop=loop=-1:size=1:start=0,fps=30,format=nv12,hwupload_cuda[bb]; "
    "[vh][bb]overlay_cuda=x=0:y=896:eof_action=repeat,setsar=1 [vf]; "
    "[vf]null[final]; "
    "[0:a]atrim=start=0:duration=300,asetpts=PTS-STARTPTS,atempo=1.1000[a]",
    "-t", "272.73",
    "-map", "[final]", "-map", "[a]",
    "-c:v", "hevc_nvenc", "-preset", "p1", "-rc:v", "vbr", "-cq", "18", "-tune", "hq", "-g", "30", "-maxrate", "6M", "-bufsize", "6M", "-multipass", "disabled",
    "-c:a", "aac", "-b:a", "192k", "-r", "30", out_orig
]

print("Running Original Full Command (300s duration)...")
t0 = time.time()
res_orig = subprocess.run(cmd_orig, capture_output=True, text=True)
t_orig = time.time() - t0
print(f"Original Full Time: {t_orig:.4f}s")
if res_orig.returncode != 0:
    print(res_orig.stderr[-1000:])

# Optimized Command (Full 5 min)
cmd_opt2 = [
    ffmpeg_exe, "-hide_banner", "-y",
    "-init_hw_device", "cuda=cuda", "-filter_hw_device", "cuda",
    "-hwaccel", "cuda", "-hwaccel_output_format", "cuda",
    "-i", video_path,
    "-framerate", "30", "-i", thumb_path,  # bg
    "-framerate", "30", "-i", thumb_path,  # hd
    "-framerate", "30", "-i", thumb_path,  # bb
    "-filter_complex",
    "[0:v]trim=start=0:duration=300,setpts=PTS-STARTPTS,setpts=0.9090909090909091*PTS,fps=30,scale_cuda=910:512,hwdownload,format=nv12,crop=720:512:95:0,hwupload_cuda[vid]; "
    "[1:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,format=nv12,hwupload_cuda,loop=loop=-1:size=1:start=0[bg]; "
    "[bg][vid]overlay_cuda=x=0:y=384:eof_action=repeat [vz]; "
    "[2:v]scale=720:384:force_original_aspect_ratio=increase,crop=720:384:(ow-iw)/2:(oh-ih)/2,setsar=1,format=nv12,hwupload_cuda,loop=loop=-1:size=1:start=0[hd]; "
    "[vz][hd]overlay_cuda=x=0:y=0:eof_action=repeat [vh]; "
    "[3:v]format=nv12,hwupload_cuda,loop=loop=-1:size=1:start=0[bb]; "
    "[vh][bb]overlay_cuda=x=0:y=896:eof_action=repeat,setsar=1 [vf]; "
    "[vf]null[final]; "
    "[0:a]atrim=start=0:duration=300,asetpts=PTS-STARTPTS,atempo=1.1000[a]",
    "-t", "272.73",
    "-map", "[final]", "-map", "[a]",
    "-c:v", "hevc_nvenc", "-preset", "p1", "-rc:v", "vbr", "-cq", "18", "-tune", "hq", "-g", "30", "-maxrate", "6M", "-bufsize", "6M", "-multipass", "disabled",
    "-c:a", "aac", "-b:a", "192k", "-r", "30", out_opt2
]

print("Running Optimized Full Command (300s duration)...")
t0 = time.time()
res_opt2 = subprocess.run(cmd_opt2, capture_output=True, text=True)
t_opt2 = time.time() - t0
print(f"Optimized Full Time: {t_opt2:.4f}s")
if res_opt2.returncode != 0:
    print(res_opt2.stderr[-1000:])
