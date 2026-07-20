// @ts-check
// DXF 2.5D → PEZZO FRESABILE. Un DXF è geometria 2D (contorni nel piano XY, z=0):
// da solo non ha una mesh, quindi qui lo trasformiamo nel solido reale che quei
// contorni rappresentano — una LASTRA di spessore con i contorni interni come FORI/
// asole passanti — così la pipeline di fresatura 3-assi (partToMillGcode) lo rivela
// dall'alto (contorno esterno + fori scavati). Riusa chainSegments (concatenazione
// per estremità: gestisce anche rettangoli fatti di LINE separate) + extrudeRegion.

import { chainSegments } from '../loaders/cad/sequence.js';
import { extrudeRegion, signedArea } from '../sim/triangulate.js';

const TOL = 1e-3;
const same = (a, b) => Math.abs(a.x - b.x) < TOL && Math.abs(a.y - b.y) < TOL;

/** Ricostruisce l'anello ordinato di punti [x,y] da una catena chiusa. */
function chainToRing(chain) {
  const pts = [];
  let cur = chain.start;
  pts.push([cur.x, cur.y]);
  for (const s of chain.segs) {
    const nxt = same(s.from, cur) ? s.to : (same(s.to, cur) ? s.from : s.to);
    pts.push([nxt.x, nxt.y]);
    cur = nxt;
  }
  return pts;
}

function ringBBox(ring) {
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (const [x, y] of ring) { if (x < mnx) mnx = x; if (y < mny) mny = y; if (x > mxx) mxx = x; if (y > mxy) mxy = y; }
  return [mnx, mny, mxx, mxy];
}
function centroid(ring) {
  let x = 0, y = 0;
  for (const [px, py] of ring) { x += px; y += py; }
  return [x / ring.length, y / ring.length];
}
/** Ray-casting: il punto [x,y] è dentro l'anello? */
function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * RIPARAZIONE contorni: "welda" gli estremi vicini entro `tol` a un punto canonico
 * (hash spaziale a celle `tol`), così i gap dei DXF reali si chiudono e i loop
 * quasi-chiusi diventano chiusi. Come l'auto-close di SheetCam. Non muta il modello.
 * @param {import('../core/model.js').Segment[]} segs @param {number} tol
 * @returns {{segs:import('../core/model.js').Segment[], welded:number}}
 */
export function weldSegments(segs, tol) {
  if (!(tol > 0)) return { segs, welded: 0 };
  /** @type {Map<string, {x:number,y:number,z:number}[]>} */
  const buckets = new Map();
  let welded = 0;
  const canon = (p) => {
    const gx = Math.floor(p.x / tol), gy = Math.floor(p.y / tol);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const arr = buckets.get(`${gx + dx},${gy + dy}`);
      if (arr) for (const q of arr) if (Math.hypot(q.x - p.x, q.y - p.y) <= tol) {
        if (Math.hypot(q.x - p.x, q.y - p.y) > 1e-9) welded++;
        return q;
      }
    }
    const q = { x: p.x, y: p.y, z: 0 };
    const k = `${gx},${gy}`;
    (buckets.get(k) || buckets.set(k, []).get(k)).push(q);
    return q;
  };
  return { segs: segs.map((s) => ({ ...s, from: canon(s.from), to: canon(s.to) })), welded };
}

/**
 * Anelli CHIUSI dai segmenti del DXF (per estremità coincidenti). Ripara i gap
 * entro `repairTol` (default 0.05 mm) → i DXF "sporchi" reali si chiudono comunque.
 * @param {import('../core/model.js').SceneModel} model
 * @param {{repairTol?:number}} [opts]
 * @returns {number[][][]} lista di anelli [ [x,y], ... ]
 */
export function closedRingsFromDxf(model, opts = {}) {
  const raw = model.segments.filter((s) => s.type !== 'rapid' && s.from && s.to);
  const segs = weldSegments(raw, opts.repairTol ?? 0.05).segs;
  const chains = chainSegments(segs);
  const rings = [];
  for (const c of chains) {
    if (c.segs.length < 2 || !same(c.start, c.end)) continue;   // solo catene chiuse
    const r = chainToRing(c);
    if (r.length >= 4 && Math.abs(signedArea(r)) > 1e-6) rings.push(r.slice(0, -1));   // togli il doppione finale
  }
  return rings;
}

/**
 * DXF → mesh solida fresabile (lastra con fori). L'anello di area massima è il
 * contorno esterno; gli anelli contenuti sono fori/asole passanti.
 * @param {import('../core/model.js').SceneModel} model
 * @param {{thickness?:number}} [opts]
 * @returns {{positions:Float64Array, indices:Uint32Array, thickness:number, outerBB:number[], holes:number}}
 */
export function dxfToPartMesh(model, opts = {}) {
  const rings = closedRingsFromDxf(model);
  if (!rings.length) throw new Error('nessun contorno chiuso nel DXF (serve almeno un profilo esterno chiuso)');
  // esterno = area massima; fori = anelli il cui centroide è dentro l'esterno
  let outer = rings[0], oa = Math.abs(signedArea(rings[0]));
  for (const r of rings) { const a = Math.abs(signedArea(r)); if (a > oa) { oa = a; outer = r; } }
  const holes = rings.filter((r) => r !== outer && pointInRing(centroid(r), outer));
  const bb = ringBBox(outer);
  const span = Math.max(bb[2] - bb[0], bb[3] - bb[1]) || 10;
  const thickness = opts.thickness ?? Math.max(4, Math.min(12, 0.08 * span));
  const g = extrudeRegion(outer, holes, 0, thickness);
  return { positions: g.positions, indices: g.indices, thickness, outerBB: bb, holes: holes.length };
}
