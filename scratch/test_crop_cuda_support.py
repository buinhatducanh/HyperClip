import subprocess

ffmpeg_exe = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
video_path = r"D:\LOOP_COMPANY\HyperClip\data\media\Zilk Kay\downloads\8fAExeJIbKQ_20260627_005956.mp4"
out_test = r"d:\LOOP_COMPANY\HyperClip\scratch\out_test_crop_cuda.mp4"

cmd = [
    ffmpeg_exe, "-hide_banner", "-y",
    "-init_hw_device", "cuda=cuda", "-filter_hw_device", "cuda",
    "-hwaccel", "cuda", "-hwaccel_output_format", "cuda",
    "-i", video_path,
    "-filter_complex",
    "[0:v]trim=start=0:duration=5,setpts=PTS-STARTPTS,fps=30,scale_cuda=910:512,crop_cuda=w=720:h=512:x=95:y=0[vid]",
    "-map", "[vid]",
    "-c:v", "hevc_nvenc", "-preset", "p1", out_test
]

print("Testing crop_cuda support...")
res = subprocess.run(cmd, capture_output=True, text=True)
if res.returncode == 0:
    print("SUCCESS: crop_cuda is supported!")
else:
    print("FAILED: crop_cuda not supported.")
    print(res.stderr[-500:])
