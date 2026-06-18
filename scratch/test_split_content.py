import subprocess
import json
import os
import glob

project_root = r"d:\LOOP_COMPANY\HyperClip"
renders_dir = os.path.join(project_root, 'data', 'renders')
downloads_dir = os.path.join(project_root, 'data', 'downloads')

part1 = os.path.join(renders_dir, "Test Split 60s Video_part1.mp4")
part2 = os.path.join(renders_dir, "Test Split 60s Video_part2.mp4")

def get_video_frame(filepath, seek_time, out_img):
    if os.path.exists(out_img):
        os.remove(out_img)
    cmd = [
        'ffmpeg', '-y', '-ss', str(seek_time), '-i', filepath,
        '-vframes', '1', '-f', 'image2', out_img
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return os.path.exists(out_img)

def compare_images(img1, img2):
    # Use ffmpeg to compute similarity / difference
    # Or just check file sizes as a simple check, or PSNR.
    # Let's compute PSNR or RMSE using ffmpeg's psnr filter:
    # ffmpeg -i img1 -i img2 -filter_complex psnr -f null -
    cmd = [
        'ffmpeg', '-i', img1, '-i', img2,
        '-filter_complex', 'psnr', '-f', 'null', '-'
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    # Parse PSNR from stderr
    # Example output: "PSNR y:50.0 u:50.0 v:50.0 average:50.0 min:50.0 max:50.0" or similar
    # If identical, PSNR is inf.
    stderr = res.stderr
    if "average:inf" in stderr or "average:inf" in stderr.lower():
        return True
    # Let's find "average:" and check if it's high (e.g. > 30)
    for line in stderr.split('\n'):
        if "average:" in line:
            try:
                parts = line.split("average:")
                val = float(parts[1].split()[0])
                if val > 25.0:  # High similarity
                    return True
            except:
                pass
    return False

def check_split():
    print("Checking split video alignment...")
    if not os.path.exists(part1) or not os.path.exists(part2):
        print("Rendered parts do not exist.")
        return
    
    downloaded_files = glob.glob(os.path.join(downloads_dir, "*.mp4"))
    if not downloaded_files:
        print("Original downloaded file not found.")
        return
    original = downloaded_files[0]
    print(f"Original file: {original}")

    img_part1_2s = "part1_2s.jpg"
    img_part2_2s = "part2_2s.jpg"
    img_orig_2_4s = "orig_2_4s.jpg"
    img_orig_32_4s = "orig_32_4s.jpg"

    try:
        # Extract frames
        get_video_frame(part1, 2.0, img_part1_2s)
        get_video_frame(part2, 2.0, img_part2_2s)
        get_video_frame(original, 2.4, img_orig_2_4s)
        get_video_frame(original, 32.4, img_orig_32_4s)

        # Compare
        p1_match = compare_images(img_part1_2s, img_orig_2_4s)
        p2_match = compare_images(img_part2_2s, img_orig_32_4s)
        p2_wrong_match = compare_images(img_part2_2s, img_orig_2_4s)

        print(f"Part 1 at 2.0s matches Original at 2.4s: {p1_match}")
        print(f"Part 2 at 2.0s matches Original at 32.4s: {p2_match}")
        print(f"Part 2 at 2.0s matches Original at 2.4s (wrong): {p2_wrong_match}")

        if p1_match and p2_match:
            print("[SUCCESS] Splitting and speeding up aligned perfectly!")
        else:
            print("[FAIL] Mismatch in video content/alignment.")

    finally:
        for f in [img_part1_2s, img_part2_2s, img_orig_2_4s, img_orig_32_4s]:
            if os.path.exists(f):
                os.remove(f)

if __name__ == "__main__":
    check_split()
