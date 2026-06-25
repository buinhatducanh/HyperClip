import os
import subprocess

ffmpeg = r"D:\LOOP_COMPANY\HyperClip\resources\ffmpeg\bin\ffmpeg.exe"
full_video = r"d:\LOOP_COMPANY\HyperClip\scratch\test_full.mp4"
section_video = r"d:\LOOP_COMPANY\HyperClip\data\EqWMOrNVnjU_20260625_105602.mp4"

# Extract frame at 0.0 of full video
subprocess.run([
    ffmpeg, "-hide_banner", "-y",
    "-ss", "0.0",
    "-i", full_video,
    "-vframes", "1",
    r"d:\LOOP_COMPANY\HyperClip\scratch\full_frame_0.jpg"
])

# Extract frame at 4.9 of full video
subprocess.run([
    ffmpeg, "-hide_banner", "-y",
    "-ss", "4.9",
    "-i", full_video,
    "-vframes", "1",
    r"d:\LOOP_COMPANY\HyperClip\scratch\full_frame_4_9.jpg"
])

# Extract frame at 0.0 of section video
subprocess.run([
    ffmpeg, "-hide_banner", "-y",
    "-ss", "0.0",
    "-i", section_video,
    "-vframes", "1",
    r"d:\LOOP_COMPANY\HyperClip\scratch\section_frame_0.jpg"
])

# Let's compare files
def get_file_size(path):
    if os.path.exists(path):
        return os.path.getsize(path)
    return -1

print("full_frame_0.jpg size:", get_file_size(r"d:\LOOP_COMPANY\HyperClip\scratch\full_frame_0.jpg"))
print("full_frame_4_9.jpg size:", get_file_size(r"d:\LOOP_COMPANY\HyperClip\scratch\full_frame_4_9.jpg"))
print("section_frame_0.jpg size:", get_file_size(r"d:\LOOP_COMPANY\HyperClip\scratch\section_frame_0.jpg"))

# Let's check if the pixels of section_frame_0 match full_frame_4_9 or full_frame_0
try:
    from PIL import Image
    import numpy as np
    
    img_full_0 = Image.open(r"d:\LOOP_COMPANY\HyperClip\scratch\full_frame_0.jpg").convert('L').resize((100, 100))
    img_full_4_9 = Image.open(r"d:\LOOP_COMPANY\HyperClip\scratch\full_frame_4_9.jpg").convert('L').resize((100, 100))
    img_sec_0 = Image.open(r"d:\LOOP_COMPANY\HyperClip\scratch\section_frame_0.jpg").convert('L').resize((100, 100))
    
    arr_full_0 = np.array(img_full_0, dtype=float)
    arr_full_4_9 = np.array(img_full_4_9, dtype=float)
    arr_sec_0 = np.array(img_sec_0, dtype=float)
    
    diff_with_0 = np.mean(np.abs(arr_sec_0 - arr_full_0))
    diff_with_4_9 = np.mean(np.abs(arr_sec_0 - arr_full_4_9))
    
    print(f"Mean pixel diff between section_0 and full_0: {diff_with_0:.2f}")
    print(f"Mean pixel diff between section_0 and full_4_9: {diff_with_4_9:.2f}")
except Exception as e:
    print("PIL/Numpy compare failed:", e)
