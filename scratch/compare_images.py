# scratch/compare_images.py
from PIL import Image
import numpy as np

def load_img(path):
    img = Image.open(path).convert('L') # grayscale
    img = img.resize((100, 100))
    return np.array(img, dtype=np.float32)

out = load_img("scratch/frame_output.jpg")
inp_8s = load_img("scratch/frame_input_8s.jpg")
inp_10s = load_img("scratch/frame_input_10s.jpg")

diff_8s = np.mean(np.abs(out - inp_8s))
diff_10s = np.mean(np.abs(out - inp_10s))

print(f"Diff to 8s input frame: {diff_8s:.2f}")
print(f"Diff to 10s input frame: {diff_10s:.2f}")

if diff_10s < diff_8s:
    print("[SUCCESS] The output at 8.33s is closer to the input at 10s. Speedup is working!")
else:
    print("[FAIL] The output at 8.33s is closer to the input at 8.33s. No speedup happened (video was truncated)!")
