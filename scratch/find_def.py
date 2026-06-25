with open(r"d:\LOOP_COMPANY\HyperClip\crates\hyperclip_ipc\src\youtube.rs", 'r', encoding='utf-8') as f:
    for i, line in enumerate(f, 1):
        if "maybe_trim" in line or "fn maybe_trim" in line:
            print(f"Line {i}: {line.strip()}")
