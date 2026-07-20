// Server statico zero-dipendenze per sviluppo locale.
// Avvio:  node server.mjs   →  http://localhost:8123
// (l'implementazione vive in serve.mjs, condivisa col guscio desktop Electron)
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStaticServer } from './serve.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 8123;
// default 127.0.0.1 in locale (sicuro). Su un host Node (Render/Railway/…) la
// piattaforma imposta PORT: in quel caso bind 0.0.0.0 per essere raggiungibile.
// Per SELF-HOST / accesso da mobile in LAN: HOST=0.0.0.0
const host = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');

const { url } = await startStaticServer({ root, port, host });
console.log(`CAD/CAM Viewer LGE → ${url}` + (host === '0.0.0.0' ? `  (LAN: http://<IP-del-PC>:${port}/)` : ''));
