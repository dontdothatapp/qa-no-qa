import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'site');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.txt': 'text/plain', '.png': 'image/png' };

/** Static server for the fixture site. `/hang` never responds (for timeout tests). */
export function serveFixtures(port = 0, host = '127.0.0.1'): Promise<{ url: string; port: number; close(): Promise<void> }> {
  const sockets = new Set<import('node:net').Socket>();
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (urlPath === '/hang') return; // intentionally never answers
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const file = path.join(SITE, rel);
    if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/html' }).end('<h1>404 Page not found</h1>');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const actual = (server.address() as import('node:net').AddressInfo).port;
      resolve({
        url: `http://${host}:${actual}`,
        port: actual,
        close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
      });
    });
  });
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  serveFixtures(4173, 'localhost').then((s) => console.log(`fixtures on ${s.url}`));
}
