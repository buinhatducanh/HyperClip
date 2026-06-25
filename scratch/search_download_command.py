import json

transcript_path = r"C:\Users\MSI\.gemini\antigravity-ide\brain\008c9d2c-730e-45b2-9f0e-3f35b9ada63d\.system_generated\logs\transcript.jsonl"

print("Searching download commands...")
with open(transcript_path, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            data = json.loads(line)
            content = str(data)
            if "yt-dlp" in content and "EqWMOrNVnjU" in content:
                print(f"Step {data.get('step_index')}: {data.get('type')}")
                # print a part of it
                print(content[:1000])
        except Exception as e:
            pass
