const fs = require('fs');
const readline = require('readline');

async function findWorkspaces() {
  const fileStream = fs.createReadStream('C:/Users/phung/.gemini/antigravity/brain/c9c3e511-f95c-47e1-b2f9-3e76e1787f41/.system_generated/logs/transcript_full.jsonl');
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  const map = new Map();

  for await (const line of rl) {
    if (line.includes('ws-ch-')) {
      // Find JSON objects containing "id":"ws-ch-..."
      let idx = 0;
      while ((idx = line.indexOf('"id":"ws-ch-', idx)) !== -1) {
        // Find start of object
        let start = line.lastIndexOf('{', idx);
        if (start !== -1) {
          // Find matching end of object
          let depth = 0;
          let end = -1;
          for (let i = start; i < line.length; i++) {
            if (line[i] === '{') depth++;
            else if (line[i] === '}') {
              depth--;
              if (depth === 0) {
                end = i;
                break;
              }
            }
          }
          if (end !== -1) {
            try {
              let candidate = line.slice(start, end + 1);
              // Clean up escaped quotes if inside string
              if (candidate.includes('\\"')) {
                candidate = candidate.replace(/\\"/g, '"');
              }
              const obj = JSON.parse(candidate);
              if (obj.id && obj.id.startsWith('ws-ch-') && obj.title) {
                map.set(obj.id, obj);
              }
            } catch(e) {}
          }
        }
        idx += 12;
      }
    }
  }
  console.log('Found full workspace objects from transcript:', map.size);
  for (const [id, ws] of map) {
    console.log(id, ws.title || ws.video_id, ws.status);
  }
}
findWorkspaces();

