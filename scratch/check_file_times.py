import os
import sys
import datetime

sys.stdout.reconfigure(encoding='utf-8')

def print_mtime(filepath):
    if os.path.exists(filepath):
        mtime = os.path.getmtime(filepath)
        dt = datetime.datetime.fromtimestamp(mtime)
        print(f"{filepath}: modified at {dt}")
    else:
        print(f"{filepath}: does not exist")

print_mtime(r"d:\LOOP_COMPANY\HyperClip\data\TÔI GHÉT CÂY , VÀ NÓ CŨNG THẾ ! ! !  Tree hate you  MB3R.mp4")
print_mtime(r"d:\LOOP_COMPANY\HyperClip\data\TÔI GHÉT CÂY , VÀ NÓ CŨNG THẾ ! ! !  Tree hate you  MB3R ( F2 ).mp4")
