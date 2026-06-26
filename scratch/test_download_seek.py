import subprocess
import os

ytdlp = r"D:\LOOP_COMPANY\HyperClip\resources\yt-dlp\yt-dlp.exe"
ffprobe = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffprobe.exe"
url = "https://www.youtube.com/watch?v=EqWMOrNVnjU" # Short 60s test video

def run_test(name, extra_args):
    out_file = f"scratch/test_dl_{name}.mp4"
    if os.path.exists(out_file):
        try:
            os.remove(out_file)
        except Exception:
            pass
            
    cmd = [
        ytdlp,
        "-f", "bestvideo[height<=?360]+bestaudio/best",
        "--remux-video", "mp4",
        "-o", out_file,
        "--ffmpeg-location", r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin"
    ] + extra_args + [url]
    
    print(f"\n--- Running test: {name} ---")
    print("Command:", " ".join(cmd))
    res = subprocess.run(cmd, capture_output=True, text=True)
    if os.path.exists(out_file):
        print(f"[{name}] Downloaded successfully.")
        
        # Probe start times
        start_v = subprocess.check_output([
            ffprobe, "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=start_time",
            "-of", "default=noprint_wrappers=1:nokey=1",
            out_file
        ]).decode('utf-8').strip()
        
        start_a = subprocess.check_output([
            ffprobe, "-v", "error", "-select_streams", "a:0",
            "-show_entries", "stream=start_time",
            "-of", "default=noprint_wrappers=1:nokey=1",
            out_file
        ]).decode('utf-8').strip()
        
        print(f"[{name}] Video Start Time: {start_v}")
        print(f"[{name}] Audio Start Time: {start_a}")
        
        # Get frame count
        nb_frames = subprocess.check_output([
            ffprobe, "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=nb_frames",
            "-of", "default=noprint_wrappers=1:nokey=1",
            out_file
        ]).decode('utf-8').strip()
        print(f"[{name}] Video Frames: {nb_frames}")
        
        # Extract first frame
        frame_out = f"scratch/test_dl_{name}_frame_0.jpg"
        if os.path.exists(frame_out):
            os.remove(frame_out)
        subprocess.run([
            r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe",
            "-hide_banner", "-y", "-ss", "0.0", "-i", out_file, "-vframes", "1", frame_out
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
        # Compare first frame with full video frames
        try:
            from PIL import Image
            import numpy as np
            img_full_0 = Image.open(r"d:\LOOP_COMPANY\HyperClip\scratch\full_frame_0.jpg").convert('L').resize((100, 100))
            img_full_4_9 = Image.open(r"d:\LOOP_COMPANY\HyperClip\scratch\full_frame_4_9.jpg").convert('L').resize((100, 100))
            img_sec = Image.open(frame_out).convert('L').resize((100, 100))
            
            diff_0 = np.mean(np.abs(np.array(img_sec, dtype=float) - np.array(img_full_0, dtype=float)))
            diff_4_9 = np.mean(np.abs(np.array(img_sec, dtype=float) - np.array(img_full_4_9, dtype=float)))
            print(f"[{name}] Pixel diff to full_0: {diff_0:.2f}")
            print(f"[{name}] Pixel diff to full_4_9: {diff_4_9:.2f}")
            if diff_0 < diff_4_9:
                print(f"[{name}] SUCCESS: Starts at the real beginning (0.0s)!")
            else:
                print(f"[{name}] FAIL: Starts at the delayed position (4.9s)!")
        except Exception as e:
            print("Compare error:", e)
    else:
        print(f"[{name}] Download failed.")
        print("Stderr:", res.stderr)

# 1. tv_embedded client, seeking with asterisk (current behavior)
run_test("tv_asterisk", ["--download-sections", "*00:00:00-00:00:20", "--extractor-args", "youtube:player_client=tv_embedded"])

# 2. tv_embedded client, seeking WITHOUT asterisk
run_test("tv_no_asterisk", ["--download-sections", "00:00:00-00:00:20", "--extractor-args", "youtube:player_client=tv_embedded"])

# 3. web client, seeking with asterisk (DASH stream)
run_test("web_asterisk", ["--download-sections", "*00:00:00-00:00:20", "--extractor-args", "youtube:player_client=web"])
