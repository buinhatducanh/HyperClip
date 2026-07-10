import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8')

ffmpeg = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
input_video = r"d:\LOOP_COMPANY\HyperClip\data\media\Nhật Đức Anh Bùi\downloads\EqWMOrNVnjU_20260625_070440.mp4"
out_test = r"d:\LOOP_COMPANY\HyperClip\scratch\test_out.mp4"

# Let's run a simple CUDA decode + scale command to see if it works
cmd = [
    ffmpeg, "-y",
    "-hwaccel", "cuda", "-hwaccel_output_format", "cuda",
    "-c:v", "h264_cuvid", "-i", input_video,
    "-vf", "scale_cuda=736:1280",
    "-c:v", "h264_nvenc",
    "-t", "5",
    out_test
]

print("Running command: " + " ".join(cmd))
res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
print("\nSTDOUT:")
print(res.stdout.decode('utf-8', errors='ignore'))
print("\nSTDERR:")
print(res.stderr.decode('utf-8', errors='ignore'))
