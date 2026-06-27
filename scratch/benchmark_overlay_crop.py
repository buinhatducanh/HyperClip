import subprocess
import time
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

ffmpeg_exe = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
video_path = r"D:\LOOP_COMPANY\HyperClip\data\media\Zilk Kay\downloads\8fAExeJIbKQ_20260627_005956.mp4"
thumb_path = r"D:\LOOP_COMPANY\HyperClip\data\media\Zilk Kay\thumbnails\8fAExeJIbKQ.jpg"

out_path_a = r"d:\LOOP_COMPANY\HyperClip\scratch\out_bench_method_a.mp4"
out_path_c = r"d:\LOOP_COMPANY\HyperClip\scratch\out_bench_method_c.mp4"

if os.path.exists(out_path_a): os.remove(out_path_a)
if os.path.exists(out_path_c): os.remove(out_path_c)

# Method A: Current optimized (with hwdownload -> crop -> hwupload)
cmd_a = [
    ffmpeg_exe, "-hide_banner", "-y",
    "-init_hw_device", "cuda=cuda", "-filter_hw_device", "cuda",
    "-hwaccel", "cuda", "-hwaccel_output_format", "cuda",
    "-i", video_path,
    "-framerate", "30", "-i", thumb_path,  # bg
    "-filter_complex",
    "[0:v]trim=start=0:duration=300,setpts=PTS-STARTPTS,setpts=0.9090909090909091*PTS,fps=30,scale_cuda=910:512,hwdownload,format=nv12,crop=720:512:95:0,hwupload_cuda[vid]; "
    "[1:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,format=nv12,hwupload_cuda,loop=loop=-1:size=1:start=0[bg]; "
    "[bg][vid]overlay_cuda=x=0:y=384:eof_action=repeat,setsar=1 [final]; "
    "[0:a]atrim=start=0:duration=300,asetpts=PTS-STARTPTS,atempo=1.1000[a]",
    "-t", "10",  # Test first 10 seconds (300 frames)
    "-map", "[final]", "-map", "[a]",
    "-c:v", "hevc_nvenc", "-preset", "p1", "-rc:v", "vbr", "-cq", "18", "-tune", "hq", "-g", "30", "-maxrate", "6M", "-bufsize", "6M", "-multipass", "disabled",
    "-c:a", "aac", "-b:a", "192k", "-r", "30", out_path_a
]

# Method C: New GPU-only negative coordinates overlay
cmd_c = [
    ffmpeg_exe, "-hide_banner", "-y",
    "-init_hw_device", "cuda=cuda", "-filter_hw_device", "cuda",
    "-hwaccel", "cuda", "-hwaccel_output_format", "cuda",
    "-i", video_path,
    "-framerate", "30", "-i", thumb_path,  # bg
    "-filter_complex",
    "[0:v]trim=start=0:duration=300,setpts=PTS-STARTPTS,setpts=0.9090909090909091*PTS,fps=30,scale_cuda=910:512[vid]; "
    "[1:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,format=nv12,hwupload_cuda,loop=loop=-1:size=1:start=0[bg]; "
    "[bg][vid]overlay_cuda=x=-95:y=384:eof_action=repeat,setsar=1 [final]; "
    "[0:a]atrim=start=0:duration=300,asetpts=PTS-STARTPTS,atempo=1.1000[a]",
    "-t", "10",  # Test first 10 seconds (300 frames)
    "-map", "[final]", "-map", "[a]",
    "-c:v", "hevc_nvenc", "-preset", "p1", "-rc:v", "vbr", "-cq", "18", "-tune", "hq", "-g", "30", "-maxrate", "6M", "-bufsize", "6M", "-multipass", "disabled",
    "-c:a", "aac", "-b:a", "192k", "-r", "30", out_path_c
]

print("Running Method A (CPU Crop)...")
t0 = time.time()
res_a = subprocess.run(cmd_a, capture_output=True, text=True)
dt_a = time.time() - t0
print(f"Method A Time: {dt_a:.4f}s")
if res_a.returncode != 0:
    print("Method A FAILED:", res_a.stderr[-500:])

print("\nRunning Method C (Negative Overlay Crop)...")
t0 = time.time()
res_c = subprocess.run(cmd_c, capture_output=True, text=True)
dt_c = time.time() - t0
print(f"Method C Time: {dt_c:.4f}s")
if res_c.returncode != 0:
    print("Method C FAILED:", res_c.stderr[-500:])

# Compare outputs
if os.path.exists(out_path_a) and os.path.exists(out_path_c):
    print("\nVerifying if visual output frames match...")
    
    def get_framemd5(file_path):
        cmd = [
            ffmpeg_exe, "-hide_banner", "-i", file_path, "-f", "framemd5", "-"
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        return res.stdout
        
    md5_a = get_framemd5(out_path_a)
    md5_c = get_framemd5(out_path_c)

    lines_a = [l for l in md5_a.splitlines() if not l.startswith('#')]
    lines_c = [l for l in md5_c.splitlines() if not l.startswith('#')]
    
    differ_count = 0
    for idx, (la, lc) in enumerate(zip(lines_a, lines_c)):
        if la != lc:
            if differ_count < 10:
                print(f"Diff at frame {idx}:")
                print(f"  Method A: {la}")
                print(f"  Method C: {lc}")
            differ_count += 1
            
    print(f"Total different frames: {differ_count} out of {len(lines_a)}")


