import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

log_path = r"C:\Users\MSI\Downloads\hyperclip.log.2026-06-27_20-44-20"

print("Analyzing log file...")

with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
    for line in f:
        clean_line = re.sub(r'\x1b\[[0-9;]*m', '', line).strip()
        
        # Check for spawning FFmpeg command
        if "Spawning FFmpeg" in clean_line:
            print("\n--- FFmpeg Command ---")
            print(clean_line)
            
        # Check for warning/error/stutter indications
        if "warning" in clean_line.lower() or "error" in clean_line.lower() or "fail" in clean_line.lower():
            if "hyperclip_ipc" in clean_line or "ffmpeg" in clean_line.lower():
                print(clean_line)
                
        # Check for speed, fps, dup, drop messages in ffmpeg
        if "speed=" in clean_line.lower() or "dup=" in clean_line.lower():
            print(clean_line)
