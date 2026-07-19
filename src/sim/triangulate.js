// @ts-check
// Triangolazione + estrusione di una regione 2D (contorno esterno + fori) a un
// solido di spessore, per la lamiera/pezzo tagliato al laser. earcut (ISC) fa la
// faccia; le pareti laterali collegano top↔bottom. Output nel contratto renderer.

import earcut from '../../vendor/earcut/earcut.js';

/** Area con segno (shoelace) di un anello. @param {number[][]} ring */
export function signedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return a / 2;
}

/**
 * Estrude la regione {outer, holes} tra due superfici, mappate da `map(x,y,side)`
 * → [X,Y,Z] (side 1 = superficie "alta"/esterna, 0 = "bassa"/interna). Generale:
 * la lamiera usa un piano (z0/z1), il tubo avvolge sulla parete.
 * @param {number[][]} outer @param {number[][][]} holes
 * @param {(x:number,y:number,side:number)=>number[]} map
 */
export function extrudeRegionMapped(outer, holes, map) {
  const clean = (r) => (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r);
  const O = clean(outer);
  const H = holes.map(clean).filter((h) => h.length >= 3);
  if (O.length < 3) return { positions: new Float64Array(0), indices: new Uint32Array(0) };

  /** @type {number[]} */ const flat = [];
  /** @type {number[]} */ const holeIdx = [];
  for (const [x, y] of O) flat.push(x, y);
  for (const h of H) { holeIdx.push(flat.length / 2); for (const [x, y] of h) flat.push(x, y); }
  const tris = earcut(flat, holeIdx, 2);
  const nv = flat.length / 2;

  const positions = new Float64Array(nv * 2 * 3);
  for (let i = 0; i < nv; i++) {
    const t = map(flat[i * 2], flat[i * 2 + 1], 1);      // superficie alta/esterna
    const b = map(flat[i * 2], flat[i * 2 + 1], 0);      // bassa/interna
    positions[i * 3] = t[0]; positions[i * 3 + 1] = t[1]; positions[i * 3 + 2] = t[2];
    positions[(nv + i) * 3] = b[0]; positions[(nv + i) * 3 + 1] = b[1]; positions[(nv + i) * 3 + 2] = b[2];
  }
  /** @type {number[]} */ const idx = [];
  for (let i = 0; i < tris.length; i += 3) {
    idx.push(tris[i], tris[i + 1], tris[i + 2]);
    idx.push(nv + tris[i + 2], nv + tris[i + 1], nv + tris[i]);
  }
  let off = 0;
  const wall = (start, count) => {
    for (let i = 0; i < count; i++) {
      const a = start + i, b = start + (i + 1) % count;
      idx.push(a, b, nv + b, a, nv + b, nv + a);
    }
  };
  wall(0, O.length); off = O.length;
  for (const h of H) { wall(off, h.length); off += h.length; }
  return { positions, indices: new Uint32Array(idx) };
}

/**
 * Estrude la regione {outer, holes} tra z0 e z1 (lamiera piana). @returns {{positions:Float64Array, indices:Uint32Array}}
 * @param {number[][]} outer @param {number[][][]} holes @param {number} z0 @param {number} z1
 */
export function extrudeRegion(outer, holes, z0, z1) {
  return extrudeRegionMapped(outer, holes, (x, y, side) => [x, y, side ? z1 : z0]);
}
