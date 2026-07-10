# scratch/list_workspaces.py
import json
import sys

def main():
    try:
        # Reconfigure stdout to use utf-8 to avoid encoding errors on Windows console
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(encoding='utf-8')
        
        with open('data/.hyperclip/workspaces.json', 'r', encoding='utf-8') as f:
            data = json.load(f)
        for w in data.get("workspaces", []):
            print(f"{w.get('id')}: status={w.get('status')}, title={w.get('title')}, error={w.get('error')}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
