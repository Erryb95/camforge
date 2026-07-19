// @ts-check
// Deriva lo STOCK grezzo da un modello NC quando il file non lo dichiara:
// bounding box del percorso di taglio + margine + sovrametallo, con risoluzione
// della griglia scelta in modo che le celle stiano tra 40 e 220 per lato.

import { Heightmap } from './heightmap.js';

const clampN = (n) => Math.max(40, Math.min(220, Math.round(n)));

/**
 * @param {import('../core/model.js').SceneModel} model
 * @param {{margin?:number, allowance?:number, underCut?:number, cell?:number, cellsTarget?:number}} [opts]
 * @returns {Heightmap|null}
 */
export function stockFromModel(model, opts = {}) {
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity, mnz = Infinity, mxz = -Infinity;
  const add = (p) => {
    if (p.x < mnx) mnx = p.x; if (p.x > mxx) mxx = p.x;
    if (p.y < mny) mny = p.y; if (p.y > mxy) mxy = p.y;
    if (p.z < mnz) mnz = p.z; if (p.z > mxz) mxz = p.z;
  };
  let anyCut = false;
  for (const s of model.segments) {
    if (s.type === 'rapid') continue;
    anyCut = true;
    for (const p of (s.pts && s.pts.length ? s.pts : [s.from, s.to])) add(p);
  }
  if (!anyCut) {                       // nessun taglio: usa tutto (raro)
    for (const s of model.segments) for (const p of (s.pts && s.pts.length ? s.pts : [s.from, s.to])) add(p);
  }
  if (mnx === Infinity) return null;

  const w = mxx - mnx, h = mxy - mny;
  const maxDim = Math.max(w, h, 1);
  const margin = opts.margin ?? Math.max(2, 0.05 * maxDim);
  const allowance = opts.allowance ?? Math.max(1, 0.02 * Math.hypot(w, h));

  const x0 = mnx - margin, y0 = mny - margin;
  const W = (mxx + margin) - x0, H = (mxy + margin) - y0;
  const cell = opts.cell ?? Math.max(W, H) / (opts.cellsTarget ?? 150);
  const nx = clampN(W / cell), ny = clampN(H / cell);

  const zTop = mxz + allowance;                 // cima grezzo poco sopra il taglio più alto
  const zBottom = mnz - (opts.underCut ?? 0.5); // fondo poco sotto il taglio più basso
  return new Heightmap(x0, y0, W / nx, H / ny, nx, ny, zTop, zBottom);
}
