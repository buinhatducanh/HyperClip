import os
import json

path = r"D:\HyperClip\HyperClip-TestCustomer-20260616-224538\HyperClip-Data\.hyperclip\channels\seen.json"
if os.path.exists(path):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    print(json.dumps(data, indent=2))
else:
    print("File not found")
