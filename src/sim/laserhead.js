// @ts-check
// Testa laser 3D (STL) come layer di contesto animato che segue il punto di taglio
// (stile NCSIMUL). Carica ugello + supporto una volta; `place()` restituisce la
// mesh trasformata (traslata+scalata) con la PUNTA UGELLO sul punto di taglio.

import { parseSTL, mergeMeshes, meshBounds } from '../loaders/stl/index.js';

let cached = /** @type {{merged:any, tip:number[], rawH:number}|null} */ (null);

/** Carica e prepara la testa laser (fetch dei 2 STL serviti da samples/laserhead/). */
export async function loadLaserHead() {
  if (cached) return cached;
  const base = 'samples/laserhead/';
  const [a, b] = await Promise.all([
    fetch(base + 'LaserHead2.stl').then((r) => r.arrayBuffer()),
    fetch(base + 'LaserHeadHolder2.stl').then((r) => r.arrayBuffer()),
  ]);
  const head = parseSTL(new Uint8Array(a), 3);     // triTool 3 = corpo ugello
  const holder = parseSTL(new Uint8Array(b), 4);   // triTool 4 = supporto/braccio
  const merged = mergeMeshes([head, holder]);
  const hb = meshBounds(head);                     // punta ugello = Z-min della TESTA
  const tip = [(hb.min[0] + hb.max[0]) / 2, (hb.min[1] + hb.max[1]) / 2, hb.min[2]];
  cached = { merged, tip, rawH: hb.size[2] };
  return cached;
}

/**
 * Testa posizionata con l'ugello su (cx,cy) a `zTop + standoff`, scalata a `scale`.
 * (Lamiera: ugello verso −Z, già l'orientamento nativo dell'STL.)
 * @param {number} cx @param {number} cy @param {number} zTop
 * @param {{scale:number, standoff?:number}} opts
 */
export function placeHead(cx, cy, zTop, opts) {
  if (!cached) return null;
  const s = opts.scale, st = opts.standoff ?? 3;
  const P = cached.merged.positions, tip = cached.tip;
  const out = new Float64Array(P.length);
  const tz = zTop + st;
  for (let i = 0; i < P.length; i += 3) {
    out[i] = cx + (P[i] - tip[0]) * s;
    out[i + 1] = cy + (P[i + 1] - tip[1]) * s;
    out[i + 2] = tz + (P[i + 2] - tip[2]) * s;
  }
  return { positions: out, indices: cached.merged.indices, triTool: cached.merged.triTool };
}

/**
 * Testa ORIENTATA: ugello (punta) in `tipPos`, che punta lungo `nozzleDir`
 * (versore). Usata sul tubo, dove la testa è radiale (punta verso l'asse).
 * @param {number[]} tipPos @param {number[]} nozzleDir @param {{scale:number}} opts
 */
export function placeHeadOriented(tipPos, nozzleDir, opts) {
  if (!cached) return null;
  const s = opts.scale;
  const nl = Math.hypot(nozzleDir[0], nozzleDir[1], nozzleDir[2]) || 1;
  const up = [-nozzleDir[0] / nl, -nozzleDir[1] / nl, -nozzleDir[2] / nl];   // Z-locale (corpo) verso l'esterno
  const ref = Math.abs(up[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let ex = [ref[1] * up[2] - ref[2] * up[1], ref[2] * up[0] - ref[0] * up[2], ref[0] * up[1] - ref[1] * up[0]];
  const exl = Math.hypot(ex[0], ex[1], ex[2]) || 1; ex = [ex[0] / exl, ex[1] / exl, ex[2] / exl];
  const ey = [up[1] * ex[2] - up[2] * ex[1], up[2] * ex[0] - up[0] * ex[2], up[0] * ex[1] - up[1] * ex[0]];
  const P = cached.merged.positions, tip = cached.tip;
  const out = new Float64Array(P.length);
  for (let i = 0; i < P.length; i += 3) {
    const lx = (P[i] - tip[0]) * s, ly = (P[i + 1] - tip[1]) * s, lz = (P[i + 2] - tip[2]) * s;
    out[i] = tipPos[0] + ex[0] * lx + ey[0] * ly + up[0] * lz;
    out[i + 1] = tipPos[1] + ex[1] * lx + ey[1] * ly + up[1] * lz;
    out[i + 2] = tipPos[2] + ex[2] * lx + ey[2] * ly + up[2] * lz;
  }
  return { positions: out, indices: cached.merged.indices, triTool: cached.merged.triTool };
}

/** Scala consigliata perché l'altezza ugello sia ~`targetH` mm. */
export function headScaleFor(targetH) {
  return cached && cached.rawH > 0 ? targetH / cached.rawH : 0.3;
}
