import urllib.request
import time
import os

url = "http://mirror.viettelcloud.vn/ubuntu/ls-lR.gz"
out_file = "scratch/speedtest_domestic.gz"

if os.path.exists(out_file):
    try: os.remove(out_file)
    except: pass

print("Downloading domestic test file from FPT Ubuntu Mirror...")
start = time.time()
try:
    req = urllib.request.Request(
        url, 
        headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    )
    with urllib.request.urlopen(req) as response, open(out_file, 'wb') as out:
        out.write(response.read())
    elapsed = time.time() - start
    size_mb = os.path.getsize(out_file) / (1024 * 1024)
    speed = size_mb / elapsed
    print(f"FPT Domestic test: {elapsed:.2f}s | Size: {size_mb:.2f}MB | Speed: {speed:.2f}MB/s ({speed*8:.2f} Mbps)")
except Exception as e:
    print("Error during domestic speed test:", e)

if os.path.exists(out_file):
    try: os.remove(out_file)
    except: pass
