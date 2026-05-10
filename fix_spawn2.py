with open('electron/main.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Remove the duplicate lines
old_block = """    nextServer = spawn('node', [nextBin, '-p', String(NEXT_PORT)], {
      cwd: nextDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: spawnEnv,
    })
      cwd: nextDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: isDev ? 'development' : 'production', PORT: String(NEXT_PORT) },
    })"""

new_block = """    nextServer = spawn('node', [nextBin, '-p', String(NEXT_PORT)], {
      cwd: nextDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: spawnEnv,
    })"""

if old_block in content:
    content = content.replace(old_block, new_block)
    print("Fixed duplicate block")
else:
    print("Old block not found. Searching...")
    idx = content.find("env: spawnEnv")
    if idx != -1:
        print("Found at", idx)
        print("Context:", repr(content[idx-300:idx+100]))
    else:
        print("spawnEnv not found either")
        # Try finding the nextServer spawn
        idx2 = content.find("spawn('node'")
        if idx2 != -1:
            print("spawn at", idx2)
            print("Context:", repr(content[idx2:idx2+200]))

with open('electron/main.ts', 'w', encoding='utf-8') as f:
    f.write(content)
