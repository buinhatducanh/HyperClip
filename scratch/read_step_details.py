import json

transcript_path = r"C:\Users\MSI\.gemini\antigravity-ide\brain\008c9d2c-730e-45b2-9f0e-3f35b9ada63d\.system_generated\logs\transcript.jsonl"

print("Reading step details...")
with open(transcript_path, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            data = json.loads(line)
            step_idx = data.get("step_index")
            if step_idx in [4766, 4767, 4768, 4769]:
                print(f"--- Step {step_idx} ({data.get('type')}) ---")
                print(json.dumps(data, indent=2, ensure_ascii=False)[:3000])
        except Exception as e:
            pass
