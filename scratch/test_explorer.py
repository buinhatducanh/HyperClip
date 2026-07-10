import subprocess
import time

test_file = r"D:\LOOP_COMPANY\HyperClip\data\renders\PART 1_DG3tw_WBVnQ.mp4"

print("Test 1: Split arguments (current Rust backend approach)")
# cmd /c explorer.exe "/select," "path"
p1 = subprocess.Popen(["explorer.exe", "/select,", test_file])
time.sleep(2)

print("Test 2: Single argument with quotes inside (Rust standard arg formatting with space)")
# cmd /c explorer.exe "/select,path"
p2 = subprocess.Popen(["explorer.exe", f"/select,{test_file}"])
time.sleep(2)

print("Test 3: Unquoted /select, and quoted path (Raw command line approach)")
# cmd /c explorer.exe /select,"path"
cmd = f'explorer.exe /select,"{test_file}"'
p3 = subprocess.Popen(cmd, shell=True)
time.sleep(2)

print("Done testing.")
