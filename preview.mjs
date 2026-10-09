// preview.mjs — `npm run preview`: runs THIS checkout (any branch) on your own computer, so you can try a change
// before it is deployed. index.html loads its modules from the live site (absolute URLs), so this makes a local copy
// (preview.html, not committed) that loads them from here instead. It uses the real database: what you save is saved for real.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT) || 8777;
const html = readFileSync(join(root, 'index.html'), 'utf8').replaceAll('https://mveen.github.io/AZ-Carpool/', `http://localhost:${port}/`);
writeFileSync(join(root, 'preview.html'), html);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(root, path === '/' || path === '' ? 'preview.html' : path);
  if(!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()){ res.writeHead(404); res.end('niet gevonden'); return; }
  res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(file));
}).listen(port, '127.0.0.1', () => console.log(`Preview: http://localhost:${port}/   (Ctrl+C to stop)`));
