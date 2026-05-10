#!/usr/bin/env python3
content = open('electron/main.ts', encoding='utf-8').read()
old = "      env: { ...process.env, NODE_ENV: isDev ? 'development' : 'production', PORT: String(NEXT_PORT) },"
new = "      env: { ...process.env, NODE_ENV: isDev ? 'development' : 'production', PATH: (process.env.PATH or '') + path.delimiter + path.dirname(process.execPath), PORT: String(NEXT_PORT) },"
if old in content:
    content = content.replace(old, new)
    open('electron/main.ts', 'w', encoding='utf-8').write(content)
    print('Fixed')
else:
    print('NOT FOUND')
