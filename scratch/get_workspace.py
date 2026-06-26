# scratch/get_workspace.py
import json
import sys

def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    with open('data/.hyperclip/workspaces.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
    for w in data.get("workspaces", []):
        if w.get("id") == "ws-ch-1781893145271":
            print(json.dumps(w, indent=2))
            break

if __name__ == "__main__":
    main()
