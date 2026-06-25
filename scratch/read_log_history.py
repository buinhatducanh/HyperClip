import json

log_path = r"C:\Users\MSI\.gemini\antigravity-ide\brain\008c9d2c-730e-45b2-9f0e-3f35b9ada63d\.system_generated\logs\transcript.jsonl"
print("Searching history for ZIP packaging commands...")
with open(log_path, 'r', encoding='utf-8') as f:
    for line in f:
        if 'zip' in line.lower() or 'patch' in line.lower() or 'compress' in line.lower():
            try:
                obj = json.loads(line)
                # Print tool calls or content that might contain command execution
                tool_calls = obj.get("tool_calls", [])
                for tc in tool_calls:
                    if tc.get("name") == "run_command":
                        args = tc.get("args", {})
                        cmd = args.get("CommandLine", "")
                        if "zip" in cmd.lower() or "patch" in cmd.lower() or "compress" in cmd.lower():
                            print(f"Step {obj.get('step_index')}: {cmd}")
            except Exception as e:
                pass
