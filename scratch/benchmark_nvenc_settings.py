import subprocess
import time
import os

ffmpeg_exe = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
video_path = r"D:\LOOP_COMPANY\HyperClip\data\media\Zilk Kay\downloads\8fAExeJIbKQ_20260627_005956.mp4"
thumb_path = r"D:\LOOP_COMPANY\HyperClip\data\media\Zilk Kay\thumbnails\8fAExeJIbKQ.jpg"

configurations = [
    {
        "name": "HEVC NVENC, p1, tune hq, multipass disabled (current optimized)",
        "codec": "hevc_nvenc", "preset": "p1", "tune": "hq", "multipass": "disabled"
    },
    {
        "name": "HEVC NVENC, p1, tune ll, multipass disabled",
        "codec": "hevc_nvenc", "preset": "p1", "tune": "ll", "multipass": "disabled"
    },
    {
        "name": "HEVC NVENC, p1, tune ull, multipass disabled",
        "codec": "hevc_nvenc", "preset": "p1", "tune": "ull", "multipass": "disabled"
    },
    {
        "name": "H264 NVENC, p1, tune hq, multipass disabled",
        "codec": "h264_nvenc", "preset": "p1", "tune": "hq", "multipass": "disabled"
    },
    {
        "name": "H264 NVENC, p1, tune ll, multipass disabled",
        "codec": "h264_nvenc", "preset": "p1", "tune": "ll", "multipass": "disabled"
    },
    {
        "name": "H264 NVENC, p1, tune ull, multipass disabled",
        "codec": "h264_nvenc", "preset": "p1", "tune": "ull", "multipass": "disabled"
    },
]

for idx, config in enumerate(configurations):
    out_path = f"d:\\LOOP_COMPANY\\HyperClip\\scratch\\out_bench_{idx}.mp4"
    if os.path.exists(out_path):
        os.remove(out_path)

    cmd = [
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
        "-c:v", config["codec"], "-preset", config["preset"], "-rc:v", "vbr", "-cq", "18", "-tune", config["tune"], "-g", "30", "-maxrate", "6M", "-bufsize", "6M", "-multipass", config["multipass"],
        "-c:a", "aac", "-b:a", "192k", "-r", "30", out_path
    ]

    print(f"Running: {config['name']}...")
    t0 = time.time()
    res = subprocess.run(cmd, capture_output=True, text=True)
    dt = time.time() - t0
    print(f"Time: {dt:.4f}s")
    if res.returncode != 0:
        print(f"Error in {config['name']}: {res.stderr[-500:]}")
    else:
        # Check size of output
        sz_mb = os.path.getsize(out_path) / 1024 / 1024
        print(f"Size: {sz_mb:.2f} MB")
