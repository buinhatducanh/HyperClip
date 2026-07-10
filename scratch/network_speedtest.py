import urllib.request
import time
import os

# 20MB test file from Cloudflare
url = "https://speed.cloudflare.com/__down?bytes=20000000"
out_file = "scratch/speedtest_20mb.bin"

if os.path.exists(out_file):
    try: os.remove(out_file)
    except: pass

print("Downloading 20MB test file from Cloudflare...")
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
    print(f"Cloudflare test: {elapsed:.2f}s | Size: {size_mb:.2f}MB | Speed: {speed:.2f}MB/s ({speed*8:.2f} Mbps)")
except Exception as e:
    print("Error during speed test:", e)

if os.path.exists(out_file):
    try: os.remove(out_file)
    except: pass
