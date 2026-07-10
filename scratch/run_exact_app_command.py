import subprocess
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

ffmpeg = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
input_video = r"d:\LOOP_COMPANY\HyperClip\data\media\Nhật Đức Anh Bùi\downloads\EqWMOrNVnjU_20260625_070440.mp4"
out_test = r"d:\LOOP_COMPANY\HyperClip\scratch\exact_test_out.mp4"

# Create dummy JPGs for inputs 1 and 2, and PNG for input 3
# To make it super simple, we can just use the colors as we did, or create actual blank files.
# Let's create actual small files using ffmpeg first so they are real files!
dummy_blur = r"d:\LOOP_COMPANY\HyperClip\scratch\dummy_blur.jpg"
dummy_thumb = r"d:\LOOP_COMPANY\HyperClip\scratch\dummy_thumb.jpg"
dummy_bar = r"d:\LOOP_COMPANY\HyperClip\scratch\dummy_bar.png"

# Generate dummy files
subprocess.run([ffmpeg, "-y", "-f", "lavfi", "-i", "color=c=black:s=736x1280", "-vframes", "1", dummy_blur], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
subprocess.run([ffmpeg, "-y", "-f", "lavfi", "-i", "color=c=blue:s=736x384", "-vframes", "1", dummy_thumb], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
subprocess.run([ffmpeg, "-y", "-f", "lavfi", "-i", "color=c=red:s=736x384", "-vframes", "1", dummy_bar], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# Now compile the exact command from the user log
# D:/HyperClip/.../ffmpeg.exe -hide_banner -y -hwaccel cuda -hwaccel_output_format cuda -c:v h264_cuvid -crop 0x0x62x62 -resize 736x512 -i ...
# Wait, let's use the actual file size / dimensions
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
        "[0:v]trim=start=4.9:duration=30.0,setpts=PTS-STARTPTS,fps=30[vid]; "
        "[1:v]scale=736:1280:force_original_aspect_ratio=increase,crop=736:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,fps=30,hwupload_cuda,scale_cuda=w=736:h=1280:format=nv12[bg]; "
        "[bg][vid]overlay_cuda=0:384 [vz]; "
        "[2:v]scale=736:384:force_original_aspect_ratio=increase,crop=736:384:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,hwupload_cuda,scale_cuda=w=736:h=384:format=nv12[hd]; "
        "[vz][hd]overlay_cuda=0:0 [vh]; "
        "[3:v]format=yuv420p,hwupload_cuda,scale_cuda=w=736:h=384:format=nv12[bb]; "
        "[vh][bb]overlay_cuda=0:896,setsar=1 [vf]; "
        "[vf]setpts=0.8333333333333334*PTS[final]; "
        "[0:a]atrim=start=4.9:duration=30.0,asetpts=PTS-STARTPTS,atempo=1.2[a]"
    ),
    "-t", "25.0",
    "-map", "[final]", "-map", "[a]",
    "-c:v", "h264_nvenc", "-preset", "p4", "-rc:v", "vbr", "-cq", "18", "-tune", "ull",
    "-bf", "0", "-refs", "1", "-g", "30", "-maxrate", "6M", "-bufsize", "6M", "-multipass", "disabled",
    "-c:a", "aac", "-b:a", "192k",
    out_test
]

print("Running command...")
res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
print("Exit code:", res.returncode)
print("\nSTDERR:")
print(res.stderr.decode('utf-8', errors='ignore'))
