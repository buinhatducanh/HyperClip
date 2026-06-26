import os

paths = [
    r"C:\Users\MSI\Downloads\hyperclip.log.2026-06-25_15-53-57",
    r"C:\Users\MSI\Downloads\hyperclip.log - Sao chép.2026-06-25_16-14-44",
]

for p in paths:
    if os.path.exists(p):
        print(f"File: {p}")
        print(f"  Size: {os.path.getsize(p)} bytes")
    else:
        print(f"File not found: {p}")
