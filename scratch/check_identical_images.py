from PIL import Image
import numpy as np

try:
    img_a = np.array(Image.open(r'd:\LOOP_COMPANY\HyperClip\scratch\frame_a.png'))
    img_c = np.array(Image.open(r'd:\LOOP_COMPANY\HyperClip\scratch\frame_c.png'))
except Exception as e:
    print("Error loading frames:", e)
    exit(1)

if img_a.shape != img_c.shape:
    print(f"Shapes differ! A: {img_a.shape}, C: {img_c.shape}")
    exit(1)

# Compute absolute difference
diff = np.abs(img_a.astype(int) - img_c.astype(int))
max_diff = np.max(diff)
mean_diff = np.mean(diff)

print(f"Max absolute pixel difference (0-255): {max_diff}")
print(f"Mean absolute pixel difference: {mean_diff:.6f}")

# Save diff image
diff_visual = (diff * 10).clip(0, 255).astype(np.uint8)
Image.fromarray(diff_visual).save(r'd:\LOOP_COMPANY\HyperClip\scratch\diff.png')
print("Saved diff visualization to scratch/diff.png")

# Count pixels where difference is > 2
count_large_diff = np.sum(diff > 2)
total_pixels = diff.size
print(f"Number of pixels with difference > 2: {count_large_diff} / {total_pixels} ({count_large_diff / total_pixels * 100:.4f}%)")


