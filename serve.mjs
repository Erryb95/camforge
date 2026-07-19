// Static file server riusabile, zero-dipendenze.
// Usato sia dalla CLI di sviluppo (server.mjs) sia dal guscio desktop (desktop/main.js),
// così esiste UNA sola implementazione del server e il comportamento è identico.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.nc': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.stl': 'application/octet-stream',
};

/**
 * Avvia uno static server sotto `root`.
 * @param {{root:string, port?:number, host?:string, extraHeaders?:Record<string,string>}} opts
 *   port=0 → il SO sceglie una porta libera. extraHeaders: es. COOP/COEP se un giorno
 *   servisse l'isolamento cross-origin per i thread WASM (oggi occt-full gira senza).
 * @returns {Promise<{port:number, host:string, url:string, close:()=>Promise<void>}>}
 */
export function startStaticServer({ root, port = 0, host = '127.0.0.1', extraHeaders = {} } = {}) {
  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = normalize(join(root, path));
      if (!file.startsWith(root + sep) && file !== join(root, 'index.html')) {
        res.writeHead(403); res.end('403'); return;
      }
      const data = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-store',
        ...extraHeaders,
      });
      res.end(data);
    } catch {
      res.writeHead(404); res.end('404 - non trovato');
    }
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      const actual = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
      resolve({
        port: actual,
        host,
        url: `http://${host}:${actual}/`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
