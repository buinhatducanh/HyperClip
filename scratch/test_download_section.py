import subprocess
import os

ytdlp = r"D:\LOOP_COMPANY\HyperClip\resources\yt-dlp\yt-dlp.exe"
ffprobe = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"
output_file = r"scratch\test_poq_1min.mp4"

if os.path.exists(output_file):
    os.remove(output_file)

cmd = [
    ytdlp,
    "-f", "bestvideo[height<=?360]+bestaudio/best",
    "--remux-video", "mp4",
    "--download-sections", "*-00:01:00",
    "-o", output_file,
    "--ffmpeg-location", r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin",
    "https://youtube.com/watch?v=pOQJiJKvkEA"
]

print("Running yt-dlp download for 1 min section...")
res = subprocess.run(cmd, capture_output=True, text=True)
print("Return code:", res.returncode)

if os.path.exists(output_file):
    print("\nProbing downloaded file:")
    out_v = subprocess.check_output([
        ffprobe, "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=start_time",
        "-of", "default=noprint_wrappers=1:nokey=1",
        output_file
    ]).decode('utf-8').strip()
    print(f"Video start_time: {out_v}")

    out_a = subprocess.check_output([
        ffprobe, "-v", "error", "-select_streams", "a:0",
        "-show_entries", "stream=start_time",
        "-of", "default=noprint_wrappers=1:nokey=1",
        output_file
    ]).decode('utf-8').strip()
    print(f"Audio start_time: {out_a}")
else:
    print("Download failed, output file does not exist.")
