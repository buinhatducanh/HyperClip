import subprocess
import os

ffmpeg_path = "ffmpeg"
bundled = os.path.abspath("src-tauri/resources/ffmpeg/bin/ffmpeg.exe")
if os.path.exists(bundled):
    ffmpeg_path = bundled

try:
    output = subprocess.check_output([ffmpeg_path, "-filters"], stderr=subprocess.STDOUT, text=True)
    crop_filters = [line for line in output.splitlines() if "crop" in line]
    print("\nCrop-related filters:")
    for f in crop_filters:
        print(f)
except Exception as e:
    print(f"Error: {e}")
