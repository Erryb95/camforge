// Renderer headless: file NC/CN -> PNG dello sviluppo (o di una vista piana).
// Zero dipendenze: PNG scritto a mano con zlib di Node.
// Uso:  node tools/render-snapshot.mjs <input> <output.png> [vista] [larghezza] [altezza]
//       vista: DEV (default) | XY | XZ | YZ
import { readFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import '../src/loaders/nc/index.js';
import '../src/loaders/alma/index.js';
import { parseFile } from '../src/core/registry.js';

const [, , input, output, view = 'DEV', W = '1200', H = '700'] = process.argv;
if (!input || !output) {
  console.error('uso: node tools/render-snapshot.mjs <input> <output.png> [DEV|XY|XZ|YZ] [w] [h]');
  process.exit(1);
}
const w = parseInt(W, 10), h = parseInt(H, 10);

const text = await readFile(input, 'utf8');
const { model } = parseFile(input.split(/[\\/]/).pop(), text);

// --- proiezione ---
const PLANES = {
  XY: (p) => [p.x, p.y],
  XZ: (p) => [p.x, p.z],
  YZ: (p) => [p.y, p.z],
};
/** @type {{type:string, pts:number[][]}[]} */
const polys = [];
for (const seg of model.segments) {
  let pts;
  if (view === 'DEV') {
    if (!seg.uv) continue;
    pts = seg.uv.map((q) => [q.u, q.v]);
  } else {
    pts = seg.pts.map(PLANES[view]);
  }
  polys.push({ type: seg.type, pts });
}
if (!polys.length) {
  console.error(`nessun segmento proiettabile in vista ${view}`);
  process.exit(2);
}

// --- fit ---
let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
for (const p of polys) for (const [u, v] of p.pts) {
  if (u < minU) minU = u; if (u > maxU) maxU = u;
  if (v < minV) minV = v; if (v > maxV) maxV = v;
}
const scale = Math.min((w * 0.92) / Math.max(maxU - minU, 1e-6), (h * 0.92) / Math.max(maxV - minV, 1e-6));
const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
const sx = (u) => Math.round((u - cu) * scale + w / 2);
const sy = (v) => Math.round(h / 2 - (v - cv) * scale);

// --- raster RGB ---
const buf = Buffer.alloc(w * h * 3);
const put = (x, y, r, g, b) => {
  if (x < 0 || x >= w || y < 0 || y >= h) return;
  const i = (y * w + x) * 3;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
};
// sfondo
for (let i = 0; i < w * h; i++) { buf[i * 3] = 0x14; buf[i * 3 + 1] = 0x17; buf[i * 3 + 2] = 0x1c; }

function line(x0, y0, x1, y1, r, g, b, dashed = false) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const stx = x0 < x1 ? 1 : -1, sty = y0 < y1 ? 1 : -1;
  let err = dx + dy, n = 0;
  for (;;) {
    if (!dashed || n % 8 < 5) put(x0, y0, r, g, b);
    n++;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += stx; }
    if (e2 <= dx) { err += dx; y0 += sty; }
  }
}

// guide facce (vista DEV)
if (view === 'DEV' && model.meta && model.meta.unrollGuides) {
  for (const v of model.meta.unrollGuides) {
    const y = sy(v);
    if (y >= 0 && y < h) line(0, y, w - 1, y, 0x2e, 0x41, 0x60, true);
  }
}
// assi u=0 / v=0
line(sx(0), 0, sx(0), h - 1, 0x26, 0x2e, 0x3b);
line(0, sy(0), w - 1, sy(0), 0x26, 0x2e, 0x3b);

for (const p of polys) {
  const rapid = p.type === 'rapid';
  const [r, g, b] = rapid ? [0x8a, 0x55, 0x60] : [0x4c, 0xc9, 0xf0];
  for (let i = 1; i < p.pts.length; i++) {
    line(sx(p.pts[i - 1][0]), sy(p.pts[i - 1][1]), sx(p.pts[i][0]), sy(p.pts[i][1]), r, g, b, rapid);
  }
}

// --- PNG minimale (RGB8, filtro 0) ---
const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
const crc32 = (data) => {
  let c = -1;
  for (const byte of data) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
ihdr[8] = 8; ihdr[9] = 2; // 8 bit, RGB
const raw = Buffer.alloc(h * (1 + w * 3));
for (let y = 0; y < h; y++) {
  raw[y * (1 + w * 3)] = 0; // filtro 0
  buf.copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
await writeFile(output, png);
console.log(`${output}: ${w}x${h}, ${polys.length} segmenti, vista ${view}` +
  (model.meta && model.meta.perimeter ? `, perimetro ${model.meta.perimeter.toFixed(1)} mm` : ''));
