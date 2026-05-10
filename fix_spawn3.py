with open('electron/main.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find and fix the duplicate lines
# Lines 998-1002 (0-indexed: 997-1001) are duplicates
# Line 997: "})" closes the FIRST spawn call
# Lines 998-1002 are the duplicate

# Find line "cwd: nextDir," after "env: spawnEnv,"
# The pattern is:
#   nextServer = spawn(...)
#   cwd: nextDir,
#   stdio: ...
#   env: spawnEnv,
# })   <- line 997
# Then duplicate lines

# Strategy: find "cwd: nextDir," after "env: spawnEnv," and remove everything until the next "nextServerOwned"

# Find all line numbers that start the duplicate block
remove_start = None
remove_end = None

for i, line in enumerate(lines):
    if 'cwd: nextDir,' in line and i > 990:
        if remove_start is None:
            # Check if previous line contains "env: spawnEnv,"
            if i > 0 and 'env: spawnEnv,' in lines[i-1]:
                remove_start = i
                print(f"Found duplicate start at line {i+1}: {line.strip()}")
        else:
            remove_end = i
            print(f"Found duplicate end at line {i+1}: {line.strip()}")
            break

if remove_start is not None and remove_end is not None:
    # Remove lines from remove_start to remove_end (inclusive)
    print(f"Removing lines {remove_start+1} to {remove_end+1}")
    lines = lines[:remove_start] + lines[remove_end+1:]
    print("Removed duplicate block")
else:
    print(f"No duplicate found. remove_start={remove_start}, remove_end={remove_end}")
    # Print context
    for i in range(max(0, remove_start-2 if remove_start else 990, remove_start+5 if remove_start else 1000):
        if i < len(lines):
            print(f"  {i+1}: {lines[i].rstrip()}")

with open('electron/main.ts', 'w', encoding='utf-8') as f:
    f.writelines(lines)
