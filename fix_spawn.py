import re

with open('electron/main.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the spawn call for Next.js server
old_spawn = "nextServer = spawn('node', [nextBin, '-p', String(NEXT_PORT)], {"
if old_spawn in content:
    new_spawn = """// Add node.exe directory to PATH so 'node' is found in the spawned process.
    const nodeExeDir = path.dirname(process.execPath)
    const spawnEnv = { ...process.env, NODE_ENV: isDev ? 'development' : 'production', PORT: String(NEXT_PORT) }
    if (spawnEnv.PATH && !spawnEnv.PATH.includes(nodeExeDir)) {
      spawnEnv.PATH = nodeExeDir + path.delimiter + spawnEnv.PATH
    }
    nextServer = spawn('node', [nextBin, '-p', String(NEXT_PORT)], {
      cwd: nextDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: spawnEnv,
    })"""
    content = content.replace(old_spawn, new_spawn)
    print("Fixed spawn call")
else:
    print("Spawn call not found. Searching...")
    # Try to find the nextBin spawn
    idx = content.find("spawn('node', [nextBin")
    if idx != -1:
        print(f"Found at position {idx}")
        print("Context:", repr(content[idx:idx+200]))
    else:
        print("NOT FOUND")
        # Search for any spawn with 'node'
        idx2 = content.find("spawn('node'")
        print(f"spawn('node' at: {idx2}")
        if idx2 != -1:
            print("Context:", repr(content[idx2-50:idx2+200]))

with open('electron/main.ts', 'w', encoding='utf-8') as f:
    f.write(content)
