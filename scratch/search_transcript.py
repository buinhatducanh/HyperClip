import json

transcript_path = r"C:\Users\MSI\.gemini\antigravity-ide\brain\008c9d2c-730e-45b2-9f0e-3f35b9ada63d\.system_generated\logs\transcript.jsonl"

print("Searching transcript...")
with open(transcript_path, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            data = json.loads(line)
            # Look for run_command steps
            if data.get("type") == "RUN_COMMAND" or "CommandLine" in str(data):
                cmd = data.get("tool_calls", [{}])[0].get("args", {}).get("CommandLine", "")
                if not cmd:
                    cmd = data.get("content", "")
                print(f"Step {data.get('step_index')}: {cmd[:200]}")
        except Exception as e:
            pass
