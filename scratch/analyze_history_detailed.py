import json
import datetime
import sys

def format_ts(ts):
    if not ts:
        return 'N/A'
    # ts can be in milliseconds or seconds
    if ts > 1e11:
        ts = ts / 1000.0
    dt = datetime.datetime.fromtimestamp(ts, datetime.timezone(datetime.timedelta(hours=7)))
    return dt.strftime('%Y-%m-%d %H:%M:%S')

def format_duration(ms):
    if ms is None:
        return 'N/A'
    total_seconds = ms / 1000.0
    return f"{total_seconds:.2f}s"

with open(r'C:\Users\MSI\Downloads\history.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

out_file = open(r'd:\LOOP_COMPANY\HyperClip\scratch\history_analysis.txt', 'w', encoding='utf-8')

def log(msg):
    out_file.write(msg + '\n')

log("=== HISTORY ENTRIES ===")
entries = data.get('entries', [])
for i, entry in enumerate(entries):
    published = format_ts(entry.get('publishedAt'))
    detected = format_ts(entry.get('detectedAt'))
    latency = entry.get('latencyMs', 0)
    
    # Calculate more readable latency
    latency_sec = latency / 1000.0
    if latency_sec > 86400:
        latency_str = f"{latency_sec / 86400:.2f} days"
    elif latency_sec > 3600:
        latency_str = f"{latency_sec / 3600:.2f} hours"
    elif latency_sec > 60:
        latency_str = f"{latency_sec / 60:.2f} mins"
    else:
        latency_str = f"{latency_sec:.2f} secs"
        
    log(f"{i+1}. Channel: {entry.get('channelName')} | Title: {entry.get('title')}")
    log(f"   Video ID: {entry.get('videoId')} | Status: {entry.get('status')}")
    log(f"   Published: {published} | Detected: {detected} | Latency: {latency_str}")
    
    # Check download info
    ws_id = entry.get('wsId')
    dl_info = data.get('download_data', {}).get(ws_id)
    if dl_info:
        dl_status = dl_info.get('status')
        dl_start = format_ts(dl_info.get('downloadStartAt'))
        dl_end = format_ts(dl_info.get('downloadCompleteAt'))
        dl_size_mb = dl_info.get('downloadedSize', 0) / (1024*1024)
        log(f"   Download Status: {dl_status} | Size: {dl_size_mb:.2f} MB")
        if dl_start != 'N/A':
            log(f"   Downloaded: {dl_start} -> {dl_end}")
    else:
        log("   No direct download info for wsId.")
    log("-" * 60)

log("\n=== ERRORS / RENDERING IN DOWNLOAD DATA ===")
for ws_id, dl in data.get('download_data', {}).items():
    status = dl.get('status')
    if status in ['error', 'rendering', 'downloading']:
        dl_start = format_ts(dl.get('downloadStartAt'))
        dl_end = format_ts(dl.get('downloadCompleteAt'))
        log(f"ID: {ws_id} | Status: {status} | Start: {dl_start} | End: {dl_end} | Size: {dl.get('downloadedSize', 0)/(1024*1024):.2f} MB")

out_file.close()
print("Done writing history_analysis.txt")
