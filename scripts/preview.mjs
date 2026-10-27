// scripts/preview.mjs — `npm run preview`: runs THIS checkout (any branch) on your own computer, so you can try a change
// before it is deployed. index.html loads its modules from the live site (absolute URLs), so this makes a local copy
// (preview.html, not committed) that loads them from here instead. It uses the TEST database (deploy/test/firebase-config.js,
// the same as test.azcarpool.nl), never the live one: it refuses to start when that config is missing, unfilled or the live project.
// The page carries the TESTOMGEVING bar so you can see at a glance where you are.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTestConfig, markAsTest } from './build-deploy.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT) || 8777;
const testConfigFile = join(root, 'deploy/test/firebase-config.js');
const testConfig = readTestConfig(testConfigFile);   // throws when it is not the TEST project
const html = markAsTest('index.html', readFileSync(join(root, 'index.html'), 'utf8')).replaceAll('https://mveen.github.io/AZ-Carpool/', `http://localhost:${port}/`);
writeFileSync(join(root, 'preview.html'), html);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  if(path === '/firebase-config.js'){ res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); res.end(testConfig); return; }   // the live config is never served
  const file = join(root, path === '/' || path === '' ? 'preview.html' : path);
  if(!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()){ res.writeHead(404); res.end('niet gevonden'); return; }
  res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(file));
})
  .on('error', e => {
    if(e.code === 'EADDRINUSE'){ console.error(`Port ${port} is already in use (an older preview or another server). Stop it, or run:  PORT=8790 npm run preview`); process.exit(1); }
    throw e;
  })
  .listen(port, () => console.log(`Preview: http://localhost:${port}/   (Ctrl+C to stop)\nDatabase: TEST (${(testConfig.match(/projectId:\s*"([^"]+)"/) || [])[1]}), not the live one.`));   // no host given: IPv4 and IPv6, so "localhost" always reaches THIS server
