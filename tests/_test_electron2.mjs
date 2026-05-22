// Test createRequire loading electron
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const req = createRequire(__filename);
const electron = req('electron');
console.log('typeof electron:', typeof electron);
console.log('electron:', typeof electron === 'string' ? electron.slice(0,50) : 'object');
