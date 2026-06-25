import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

docs_dir = r"d:\LOOP_COMPANY\HyperClip\docs"
root_dir = r"d:\LOOP_COMPANY\HyperClip"

def search_files(directory):
    for root, dirs, files in os.walk(directory):
        if "node_modules" in root or ".git" in root or "target" in root or ".claude" in root:
            continue
        for fn in files:
            if fn.endswith(".md") or fn.endswith(".txt"):
                fp = os.path.join(root, fn)
                try:
                    with open(fp, 'r', encoding='utf-8') as f:
                        for i, line in enumerate(f, 1):
                            if "detect" in line.lower() and ("<5" in line or "5s" in line or "giây" in line or "second" in line):
                                print(f"{os.path.relpath(fp, root_dir)}:L{i}: {line.strip()}")
                except Exception as e:
                    pass

search_files(docs_dir)
search_files(root_dir)
