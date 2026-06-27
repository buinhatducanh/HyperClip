import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

log_path = r"C:\Users\MSI\Downloads\hyperclip.log.2026-06-27_20-44-20"

print("Dumping FFmpeg stdout/stderr output...")

capture = False
with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
    for line in f:
        clean_line = re.sub(r'\x1b\[[0-9;]*m', '', line).strip()
        
        # When we start spawning FFmpeg, we want to start looking
        if "Spawning FFmpeg" in clean_line:
            capture = True
            print("\n======================= NEW RENDER EXECUTION =======================")
            
        if capture:
            # Let's print log lines from the ffmpeg module or command runner
            if "hyperclip_ipc::ffmpeg" in clean_line:
                # Print output lines that are not the progress ticks (unless it's the last one)
                if "[FFmpeg progress]" not in clean_line or "Lsize=" in clean_line:
                    print(clean_line)
                    
        # Stop capturing after render completion or error
        if "Auto-render completed" in clean_line or "render failed" in clean_line.lower():
            capture = False
