// @ts-check
// Z-map → mesh solida chiusa nel formato del renderer esistente
// {positions:Float64Array, indices:Uint32Array, ...}: superficie superiore
// (2 triangoli per cella), pareti perimetrali (skirt) fino a zBottom e fondo.
// `fresh` (Uint8Array per triangolo) marca i triangoli della top-surface toccati
// nell'ultimo carve → il renderer li evidenzia come "appena tagliato".
// L'illuminazione del renderer è a due facce, quindi il verso dei triangoli è
// irrilevante per l'ombreggiatura.

/**
 * @param {import('./heightmap.js').Heightmap} hm
 * @returns {{positions:Float64Array, indices:Uint32Array, fresh:Uint8Array, nTop:number}}
 */
export function heightmapToMesh(hm) {
  const { nnx, nny, nx, ny, x0, y0, dx, dy, z, zBottom } = hm;
  /** @type {number[]} */ const pos = [];
  /** @type {number[]} */ const idx = [];
  /** @type {number[]} */ const fresh = [];

  // --- superficie superiore: un vertice per nodo ---
  for (let j = 0; j < nny; j++) {
    const py = y0 + j * dy;
    for (let i = 0; i < nnx; i++) pos.push(x0 + i * dx, py, z[j * nnx + i]);
  }
  const hasDirty = hm.dirty;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * nnx + i, b = a + 1, c = a + nnx, d = c + 1;
      idx.push(a, c, b, b, c, d);
      // "appena tagliato" se una cella cade nella dirty-box dell'ultimo carve
      const f = hasDirty && i >= hm.dMinI - 1 && i <= hm.dMaxI && j >= hm.dMinJ - 1 && j <= hm.dMaxJ ? 1 : 0;
      fresh.push(f, f);
    }
  }
  const nTop = idx.length / 3;

  // --- pareti (skirt) + fondo: chiudono il solido per l'ombreggiatura ---
  const wall = (ax, ay, az, bx, by, bz) => {
    const v = pos.length / 3;
    pos.push(ax, ay, az, bx, by, bz, ax, ay, zBottom, bx, by, zBottom);
    idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    fresh.push(0, 0);
  };
  const nodeZ = (i, j) => z[j * nnx + i];
  for (let i = 0; i < nx; i++) {
    const xa = x0 + i * dx, xb = x0 + (i + 1) * dx;
    wall(xa, y0, nodeZ(i, 0), xb, y0, nodeZ(i + 1, 0));                          // bordo j=0
    const yT = y0 + ny * dy;
    wall(xa, yT, nodeZ(i, ny), xb, yT, nodeZ(i + 1, ny));                        // bordo j=ny
  }
  for (let j = 0; j < ny; j++) {
    const ya = y0 + j * dy, yb = y0 + (j + 1) * dy;
    wall(x0, ya, nodeZ(0, j), x0, yb, nodeZ(0, j + 1));                          // bordo i=0
    const xR = x0 + nx * dx;
    wall(xR, ya, nodeZ(nx, j), xR, yb, nodeZ(nx, j + 1));                        // bordo i=nx
  }
  // fondo (piano a zBottom)
  const vb = pos.length / 3;
  const xR = x0 + nx * dx, yT = y0 + ny * dy;
  pos.push(x0, y0, zBottom, xR, y0, zBottom, x0, yT, zBottom, xR, yT, zBottom);
  idx.push(vb, vb + 1, vb + 2, vb + 2, vb + 1, vb + 3);
  fresh.push(0, 0);

  return {
    positions: new Float64Array(pos),
    indices: new Uint32Array(idx),
    fresh: new Uint8Array(fresh),
    nTop,
  };
}
