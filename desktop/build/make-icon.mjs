// Genera l'icona dell'app (zero-dip): un BLOCCO isometrico ciano (lo "stock" che
// fresiamo) su fondo scuro arrotondato. Output: icon.png (256) + icon.ico (Windows).
//   node desktop/build/make-icon.mjs
import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const S = 256;
const buf = new Uint8Array(S * S * 4);                       // RGBA, trasparente
const px = (x, y, r, g, b, a = 255) => {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4, na = a / 255, ia = 1 - na;
  buf[i] = r * na + buf[i] * ia; buf[i + 1] = g * na + buf[i + 1] * ia;
  buf[i + 2] = b * na + buf[i + 2] * ia; buf[i + 3] = Math.max(buf[i + 3], a);
};

// sfondo: quadrato arrotondato con gradiente verticale scuro
const R = 52;
const inRounded = (x, y) => {
  const cx = Math.min(Math.max(x, R), S - 1 - R), cy = Math.min(Math.max(y, R), S - 1 - R);
  return (x - cx) ** 2 + (y - cy) ** 2 <= R * R;
};
for (let y = 0; y < S; y++) {
  const t = y / S;                                           // 0 alto → 1 basso
  const r = Math.round(0x1a + (0x0e - 0x1a) * t);
  const g = Math.round(0x20 + (0x12 - 0x20) * t);
  const b = Math.round(0x2a + (0x18 - 0x2a) * t);
  for (let x = 0; x < S; x++) if (inRounded(x, y)) px(x, y, r, g, b, 255);
}

// triangolo pieno (barycentrico)
const tri = (ax, ay, bx, by, cx, cy, r, g, b, a = 255) => {
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(S - 1, Math.ceil(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxY = Math.min(S - 1, Math.ceil(Math.max(ay, by, cy)));
  const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  if (Math.abs(area) < 1e-6) return;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const w0 = ((bx - ax) * (y + 0.5 - ay) - (by - ay) * (x + 0.5 - ax)) / area;
    const w1 = ((cx - bx) * (y + 0.5 - by) - (cy - by) * (x + 0.5 - bx)) / area;
    const w2 = 1 - w0 - w1;
    if (w0 >= -0.001 && w1 >= -0.001 && w2 >= -0.001) px(x, y, r, g, b, a);
  }
};
const quad = (p, q, s, t, col) => { tri(...p, ...q, ...s, ...col); tri(...p, ...s, ...t, ...col); };

// cubo isometrico centrato
const cx = 128, cy = 132, u = 46, w = 80;
const P_top = [cx, cy - 2 * u], P_uL = [cx - w, cy - u], P_uR = [cx + w, cy - u];
const P_lL = [cx - w, cy + u], P_lR = [cx + w, cy + u], P_bot = [cx, cy + 2 * u], P_c = [cx, cy];
quad(P_uL, P_top, P_uR, P_c, [0x7f, 0xdc, 0xff]);            // faccia superiore (chiara)
quad(P_uL, P_c, P_bot, P_lL, [0x2b, 0x7f, 0xa0]);            // faccia sinistra (scura)
quad(P_c, P_uR, P_lR, P_bot, [0x3f, 0xa8, 0xd0]);            // faccia destra (media)

// spigoli del cubo (linea chiara sottile)
const line = (x0, y0, x1, y1, r, g, b) => {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let e = dx + dy, X = x0, Y = y0;
  for (;;) { px(X, Y, r, g, b, 235); px(X + 1, Y, r, g, b, 120);
    if (X === x1 && Y === y1) break; const e2 = 2 * e;
    if (e2 >= dy) { e += dy; X += sx; } if (e2 <= dx) { e += dx; Y += sy; } }
};
for (const [a, b] of [[P_top, P_uL], [P_top, P_uR], [P_uL, P_c], [P_uR, P_c], [P_c, P_bot], [P_uL, P_lL], [P_uR, P_lR], [P_lL, P_bot], [P_lR, P_bot]])
  line(a[0] | 0, a[1] | 0, b[0] | 0, b[1] | 0, 0xbf, 0xec, 0xff);

// ---- encoder PNG RGBA ----
const crcTab = new Int32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTab[n] = c; }
const crc32 = (d) => { let c = -1; for (const b of d) c = crcTab[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function pngRGBA() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(S * (1 + S * 4));
  for (let y = 0; y < S; y++) { raw[y * (1 + S * 4)] = 0; Buffer.from(buf.buffer, y * S * 4, S * 4).copy(raw, y * (1 + S * 4) + 1); }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- wrapper ICO (PNG dentro, valido da Vista in poi) ----
function ico(png) {
  const dir = Buffer.alloc(6); dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(1, 4);
  const ent = Buffer.alloc(16);
  ent[0] = 0; ent[1] = 0;                 // 256×256 → 0/0
  ent[2] = 0; ent[3] = 0; ent.writeUInt16LE(1, 4); ent.writeUInt16LE(32, 6);
  ent.writeUInt32LE(png.length, 8); ent.writeUInt32LE(22, 12);
  return Buffer.concat([dir, ent, png]);
}

const out = dirname(fileURLToPath(import.meta.url));
const png = pngRGBA();
await writeFile(join(out, 'icon.png'), png);
await writeFile(join(out, 'icon.ico'), ico(png));
console.log(`icona generata: icon.png (${png.length} B) + icon.ico`);
