// Local development server, bound only to this computer. No upload/write routes.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); res.end(); return; }
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!/^(index\.html|login\.html|admin\.html|(?:js|css)\/[A-Za-z0-9_.-]+|\.vendor\/package\/dist\/forge\.min\.js)$/.test(relative)) { res.writeHead(404); res.end(); return; }
  fs.readFile(path.join(root, relative), (error, data) => {
    if (error) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(relative)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}).listen(8080, '127.0.0.1', () => console.log('社内付箋: http://127.0.0.1:8080'));
