import subprocess
import time
import os

ffmpeg_exe = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
video_path = r"D:\LOOP_COMPANY\HyperClip\data\media\unknown\downloads\b0qpo9N89w8_20260627_121325.mp4"
thumb_path = r"D:\LOOP_COMPANY\HyperClip\data\media\unknown\thumbnails\b0qpo9N89w8.jpg"

out_cpu = r"d:\LOOP_COMPANY\HyperClip\scratch\out_cpu_bench.mp4"
out_gpu_nvdec_cpu = r"d:\LOOP_COMPANY\HyperClip\scratch\out_gpu_nvdec_cpu.mp4"
out_gpu_scale_dl = r"d:\LOOP_COMPANY\HyperClip\scratch\out_gpu_scale_dl.mp4"

for path in [out_cpu, out_gpu_nvdec_cpu, out_gpu_scale_dl]:
    if os.path.exists(path):
        os.remove(path)

canvas_w, canvas_h = 720, 1280
video_h = 512
scaled_w, scaled_h = 910, 512
crop_x = 95

# Option A: Pure CPU decode, CPU scale, CPU crop, GPU upload
cmd_a = [
    ffmpeg_exe, "-hide_banner", "-y",
    "-init_hw_device", "cuda=cuda", "-filter_hw_device", "cuda",
    "-i", video_path,
    "-framerate", "30", "-i", thumb_path,  # bg
    "-framerate", "30", "-i", thumb_path,  # hd
    "-framerate", "30", "-i", thumb_path,  # bb
    "-filter_complex",
    f"[0:v]trim=start=0:duration=30,setpts=PTS-STARTPTS,setpts=0.9090909090909091*PTS,fps=30,scale={scaled_w}:{scaled_h}:flags=fast_bilinear,crop={canvas_w}:{video_h}:{crop_x}:0,format=nv12,hwupload_cuda[vid]; "
    f"[1:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,format=nv12,hwupload_cuda,loop=loop=-1:size=1:start=0[bg]; "
    f"[bg][vid]overlay_cuda=x=0:y=384:eof_action=repeat[vz]; "
    f"[2:v]scale=720:384:force_original_aspect_ratio=increase,crop=720:384:(ow-iw)/2:(oh-ih)/2,setsar=1,format=nv12,hwupload_cuda,loop=loop=-1:size=1:start=0[hd]; "
    f"[vz][hd]overlay_cuda=x=0:y=0:eof_action=repeat[vh]; "
    f"[3:v]format=nv12,hwupload_cuda,loop=loop=-1:size=1:start=0[bb]; "
    f"[vh][bb]overlay_cuda=x=0:y=896:eof_action=repeat,setsar=1[final]; "
    f"[0:a]atrim=start=0:duration=30,asetpts=PTS-STARTPTS,atempo=1.1000[a]",
    "-t", "27.27",
    "-map", "[final]", "-map", "[a]",
    "-c:v", "hevc_nvenc", "-preset", "p4", "-rc:v", "vbr_hq", "-cq", "18", "-tune", "hq", "-g", "30", "-maxrate", "6M", "-bufsize", "6M",
    "-c:a", "aac", "-b:a", "192k", "-r", "30", out_cpu
]

# Option B: NVDEC (GPU decode to CPU memory), CPU scale, CPU crop, GPU upload
cmd_b = [
    ffmpeg_exe, "-hide_banner", "-y",
    "-init_hw_device", "cuda=cuda", "-filter_hw_device", "cuda",
    "-hwaccel", "cuda",  # decode on GPU, but no output_format cuda
    "-i", video_path,
    "-framerate", "30", "-i", thumb_path,  # bg
    "-framerate", "30", "-i", thumb_path,  # hd
    "-framerate", "30", "-i", thumb_path,  # bb
    "-filter_complex",
    f"[0:v]trim=start=0:duration=30,setpts=PTS-STARTPTS,setpts=0.9090909090909091*PTS,fps=30,scale={scaled_w}:{scaled_h}:flags=fast_bilinear,crop={canvas_w}:{video_h}:{crop_x}:0,format=nv12,hwupload_cuda[vid]; "
    f"[1:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,format=nv12,hwupload_cuda,loop=loop=-1:size=1:start=0[bg]; "
    f"[bg][vid]overlay_cuda=x=0:y=384:eof_action=repeat[vz]; "
    f"[2:v]scale=720:384:force_original_aspect_ratio=increase,crop=720:384:(ow-iw)/2:(oh-ih)/2,setsar=1,format=nv12,hwupload_cuda,loop=loop=-1:size=1:start=0[hd]; "
    f"[vz][hd]overlay_cuda=x=0:y=0:eof_action=repeat[vh]; "
    f"[3:v]format=nv12,hwupload_cuda,loop=loop=-1:size=1:start=0[bb]; "
    f"[vh][bb]overlay_cuda=x=0:y=896:eof_action=repeat,setsar=1[final]; "
    f"[0:a]atrim=start=0:duration=30,asetpts=PTS-STARTPTS,atempo=1.1000[a]",
    "-t", "27.27",
    "-map", "[final]", "-map", "[a]",
    "-c:v", "hevc_nvenc", "-preset", "p4", "-rc:v", "vbr_hq", "-cq", "18", "-tune", "hq", "-g", "30", "-maxrate", "6M", "-bufsize", "6M",
    "-c:a", "aac", "-b:a", "192k", "-r", "30", out_gpu_nvdec_cpu
]

# Option C: GPU Decode, GPU Scale -> CPU Crop (hwdownload/hwupload)
cmd_c = [
    ffmpeg_exe, "-hide_banner", "-y",
    "-init_hw_device", "cuda=cuda", "-filter_hw_device", "cuda",
    "-hwaccel", "cuda", "-hwaccel_output_format", "cuda",
    "-i", video_path,
    "-framerate", "30", "-i", thumb_path,  # bg
    "-framerate", "30", "-i", thumb_path,  # hd
    "-framerate", "30", "-i", thumb_path,  # bb
    "-filter_complex",
    f"[0:v]trim=start=0:duration=30,setpts=PTS-STARTPTS,setpts=0.9090909090909091*PTS,fps=30,scale_cuda={scaled_w}:{scaled_h},hwdownload,format=nv12,crop={canvas_w}:{video_h}:{crop_x}:0,hwupload_cuda[vid]; "
    f"[1:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,format=nv12,hwupload_cuda,loop=loop=-1:size=1:start=0[bg]; "
    f"[bg][vid]overlay_cuda=x=0:y=384:eof_action=repeat[vz]; "
    f"[2:v]scale=720:384:force_original_aspect_ratio=increase,crop=720:384:(ow-iw)/2:(oh-ih)/2,setsar=1,format=nv12,hwupload_cuda,loop=loop=-1:size=1:start=0[hd]; "
    f"[vz][hd]overlay_cuda=x=0:y=0:eof_action=repeat[vh]; "
    f"[3:v]format=nv12,hwupload_cuda,loop=loop=-1:size=1:start=0[bb]; "
    f"[vh][bb]overlay_cuda=x=0:y=896:eof_action=repeat,setsar=1[final]; "
    f"[0:a]atrim=start=0:duration=30,asetpts=PTS-STARTPTS,atempo=1.1000[a]",
    "-t", "27.27",
    "-map", "[final]", "-map", "[a]",
    "-c:v", "hevc_nvenc", "-preset", "p4", "-rc:v", "vbr_hq", "-cq", "18", "-tune", "hq", "-g", "30", "-maxrate", "6M", "-bufsize", "6M",
    "-c:a", "aac", "-b:a", "192k", "-r", "30", out_gpu_scale_dl
]

print("Running Option A (Pure CPU Decode)...")
t0 = time.time()
res_a = subprocess.run(cmd_a, capture_output=True, text=True)
dt_a = time.time() - t0
print(f"Time: {dt_a:.4f}s")
if res_a.returncode != 0:
    print("FAILED:", res_a.stderr[-1000:])

print("\nRunning Option B (GPU Decode to CPU memory)...")
t0 = time.time()
res_b = subprocess.run(cmd_b, capture_output=True, text=True)
dt_b = time.time() - t0
print(f"Time: {dt_b:.4f}s")
if res_b.returncode != 0:
    print("FAILED:", res_b.stderr[-1000:])

print("\nRunning Option C (GPU Decode + GPU Scale -> CPU Crop -> GPU upload)...")
t0 = time.time()
res_c = subprocess.run(cmd_c, capture_output=True, text=True)
dt_c = time.time() - t0
print(f"Time: {dt_c:.4f}s")
if res_c.returncode != 0:
    print("FAILED:", res_c.stderr[-1000:])
