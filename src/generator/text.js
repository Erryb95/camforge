// @ts-check
// INCISIONE TESTO a tratto singolo (single-line), integrando il font Hershey
// "futural" (dati PUBLIC DOMAIN da techninja/hersheytextjs, vendorizzati in
// hersheyFutural.js). Rende una stringa in polilinee APERTE (u,v) pronte per la
// marcatura/scribe (operazione engrave del taglio lamiera). Nessuna dipendenza nuova.

import { FUTURAL } from './hersheyFutural.js';

const CAP = 21;   // cap-height nativa Hershey (unità font)

/** Glifo `d` ("M4,1 L4,22 M..") → polilinee [[x,y]...] (coordinate font, Y in giù). */
function glyphStrokes(d) {
  /** @type {number[][][]} */ const subs = [];
  let cur = null;
  for (const t of String(d).trim().split(/\s+/)) {
    if (!t) continue;
    let s = t, move = false;
    if (t[0] === 'M') { move = true; s = t.slice(1); }
    else if (t[0] === 'L') s = t.slice(1);
    const [x, y] = s.split(',').map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (move || !cur) { cur = [[x, y]]; subs.push(cur); } else cur.push([x, y]);
  }
  return subs;
}

/**
 * Rende una stringa in polilinee (u,v). Ogni glifo è normalizzato alla propria
 * larghezza (nessuna sovrapposizione), Y ribaltata (font y-giù → CAD y-su).
 * @param {string} str
 * @param {{size?:number, x?:number, y?:number, gap?:number, spaceWidth?:number}} [opts]
 * @returns {{polylines:{u:number,v:number}[][], width:number, height:number}}
 */
export function textToPolylines(str, opts = {}) {
  const size = opts.size > 0 ? opts.size : 20;  // altezza cap in mm (guarda 0/NaN/negativi → no NaN nel G-code)
  const scale = size / CAP;
  const x0 = opts.x ?? 0, y0 = opts.y ?? 0;
  const gap = (opts.gap ?? 2.5) / scale;        // spazio tra lettere (in unità font)
  const spaceW = (opts.spaceWidth ?? size * 0.6) / scale;
  /** @type {{u:number,v:number}[][]} */ const out = [];
  let cx = 0;
  for (const ch of String(str)) {
    if (ch === ' ') { cx += spaceW; continue; }
    if (ch === '\n' || ch === '\t' || ch === '\r') continue;
    const g = FUTURAL.chars[String(ch.charCodeAt(0) - 33)];
    if (!g) { cx += spaceW; continue; }
    const strokes = glyphStrokes(g.d);
    const xs = strokes.flat().map((p) => p[0]);
    const minX = xs.length ? Math.min(...xs) : 0;
    const maxX = xs.length ? Math.max(...xs) : 0;
    for (const sub of strokes) {
      const pl = sub.map(([x, y]) => ({ u: x0 + (cx + (x - minX)) * scale, v: y0 - y * scale }));
      if (pl.length >= 2) out.push(pl);
    }
    // avanzamento = larghezza inchiostro, ma con un minimo dall'advance nativo `o`
    // così i glifi sottili (l, i, punteggiatura, ink≈0) non collassano sullo spazio
    cx += Math.max(maxX - minX, (g.o || 0) * 0.5) + gap;
  }
  return { polylines: out, width: cx * scale, height: size };
}
