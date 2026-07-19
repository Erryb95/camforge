// @ts-check
// Loader STL zero-dep (binario + ASCII) → {positions:Float64Array, indices:Uint32Array,
// triTool:Uint32Array}. Usato per i modelli di CONTESTO (testa laser + supporto)
// mostrati e animati attorno al pezzo. Solo geometria (nessun materiale).

/**
 * @param {Uint8Array|ArrayBuffer} buf
 * @param {number} [tool]  indice "utensile" per la colorazione (default 0)
 * @returns {{positions:Float64Array, indices:Uint32Array, triTool:Uint32Array}}
 */
export function parseSTL(buf, tool = 0) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const binary = u8.length >= 84 && 84 + 50 * dv.getUint32(80, true) === u8.length;
  /** @type {number[]} */ let V;
  if (binary) {
    const n = dv.getUint32(80, true);
    V = new Array(n * 9);
    let o = 84;
    for (let i = 0; i < n; i++) {
      o += 12;                                   // salta la normale della faccia
      for (let v = 0; v < 9; v++) { V[i * 9 + v] = dv.getFloat32(o, true); o += 4; }
      o += 2;                                    // attribute byte count
    }
  } else {
    const text = new TextDecoder().decode(u8);
    V = [];
    const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
    let m;
    while ((m = re.exec(text))) V.push(+m[1], +m[2], +m[3]);
  }
  const nTri = V.length / 9;
  const indices = new Uint32Array(nTri * 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;   // STL = triangle soup
  const triTool = new Uint32Array(nTri).fill(tool);
  return { positions: new Float64Array(V), indices, triTool };
}

/** Unisce più mesh {positions,indices,triTool} in un unico buffer. */
export function mergeMeshes(meshes) {
  let np = 0, ni = 0;
  for (const m of meshes) { np += m.positions.length; ni += m.indices.length; }
  const positions = new Float64Array(np), indices = new Uint32Array(ni);
  const triTool = new Uint32Array(ni / 3);
  let po = 0, io = 0, to = 0;
  for (const m of meshes) {
    const base = po / 3;
    positions.set(m.positions, po);
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + base;
    if (m.triTool) triTool.set(m.triTool, to);
    po += m.positions.length; io += m.indices.length; to += m.indices.length / 3;
  }
  return { positions, indices, triTool };
}

/** Bounding box di una geometria {positions}. */
export function meshBounds(g) {
  const P = g.positions;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) {
    const v = P[i + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v;
  }
  return { min: mn, max: mx, size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]], center: [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2] };
}
