// @ts-check
// FRESATURA da PEZZO 3D (part-based): data la mesh del pezzo genera un percorso di
// fresatura 3-assi (finitura raster top-down). Dato in pasto al tri-dexel scava il
// blocco di partenza fino a rivelare il pezzo. Il blocco di partenza è il SOLIDO
// MINIMO = bounding box del pezzo + sovrametallo. Zero-dipendenze.

/** Bounding box della mesh. */
export function meshBBox(mesh) {
  const P = mesh.positions;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return { x0, x1, y0, y1, z0, z1 };
}

/**
 * Heightmap top-down: per ogni cella (i,j) il z MASSIMO della mesh (superficie
 * superiore vista da +Z). NaN dove il pezzo non copre la cella.
 * @returns {Float64Array} H[j*nx+i]
 */
export function heightmap(mesh, box, nx, ny) {
  const P = mesh.positions, I = mesh.indices;
  const H = new Float64Array(nx * ny).fill(NaN);
  const dx = (box.x1 - box.x0) / nx, dy = (box.y1 - box.y0) / ny;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ax = P[a], ay = P[a + 1], az = P[a + 2];
    const bx = P[b], by = P[b + 1], bz = P[b + 2];
    const cx = P[c], cy = P[c + 1], cz = P[c + 2];
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-12) continue;                       // triangolo verticale/degenere
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - box.x0) / dx));
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - box.x0) / dx));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - box.y0) / dy));
    const j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by, cy) - box.y0) / dy));
    for (let j = j0; j <= j1; j++) {
      const py = box.y0 + (j + 0.5) * dy;
      for (let i = i0; i <= i1; i++) {
        const px = box.x0 + (i + 0.5) * dx;
        const w0 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / area;
        const w1 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 >= -1e-9 && w1 >= -1e-9 && w2 >= -1e-9) {
          const z = w0 * az + w1 * bz + w2 * cz;
          const k = j * nx + i;
          if (Number.isNaN(H[k]) || z > H[k]) H[k] = z;
        }
      }
    }
  }
  return H;
}

/**
 * Orienta il pezzo per la fresatura 3-assi: mette l'asse PIÙ CORTO in verticale (Z),
 * così il pezzo "sdraiato" espone la faccia più grande alla fresa (più materiale da
 * rivelare dall'alto). Rotazione propria (permutazione ciclica degli assi).
 */
export function reorientForMilling(mesh) {
  const bb = meshBBox(mesh);
  const dims = [bb.x1 - bb.x0, bb.y1 - bb.y0, bb.z1 - bb.z0];
  const s = dims.indexOf(Math.min(...dims));
  if (s === 2) return mesh;                          // già sdraiato (Z è il più corto)
  const P = mesh.positions, Q = new Float64Array(P.length);
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    if (s === 0) { Q[i] = y; Q[i + 1] = z; Q[i + 2] = x; }   // X→Z (ciclica, det +1)
    else { Q[i] = z; Q[i + 1] = x; Q[i + 2] = y; }           // Y→Z
  }
  return { positions: Q, indices: mesh.indices };
}

/**
 * Solido MINIMO di partenza = bbox pezzo + sovrametallo (allowance) sopra e margine
 * laterale. Restituisce {lo:[x,y,z], hi:[x,y,z]}.
 */
export function minStock(bbox, { allowance = 2, sideMargin = 0 } = {}) {
  return {
    lo: [bbox.x0 - sideMargin, bbox.y0 - sideMargin, bbox.z0],
    hi: [bbox.x1 + sideMargin, bbox.y1 + sideMargin, bbox.z1 + allowance],
  };
}

/**
 * Genera G-code di finitura raster 3-assi dalla mesh del pezzo.
 * @param {{positions:Float64Array, indices:Uint32Array}} mesh
 * @param {{toolDia?:number, stepover?:number, feed?:number, allowance?:number, maxCells?:number}} [opts]
 * @returns {{gcode:string, bbox:object, stock:{lo:number[],hi:number[]}, moves:number, nx:number, ny:number}}
 */
export function partToMillGcode(rawMesh, opts = {}) {
  const mesh = opts.reorient === false ? rawMesh : reorientForMilling(rawMesh);
  const bbox = meshBBox(mesh);
  const w = bbox.x1 - bbox.x0, h = bbox.y1 - bbox.y0, d = bbox.z1 - bbox.z0;
  const toolDia = opts.toolDia ?? Math.max(2, Math.min(10, 0.06 * Math.max(w, h)));
  const stepover = opts.stepover ?? toolDia * 0.4;
  const feed = opts.feed ?? 800;
  const allowance = opts.allowance ?? Math.max(1, 0.08 * d);
  const maxCells = opts.maxCells ?? 220;
  const nx = Math.max(2, Math.min(maxCells, Math.ceil(w / stepover)));
  const ny = Math.max(2, Math.min(maxCells, Math.ceil(h / stepover)));
  const dx = w / nx, dy = h / ny;
  const H = heightmap(mesh, bbox, nx, ny);
  const floor = bbox.z0;                                        // fuori pezzo → scava fino al fondo
  const safeZ = bbox.z1 + allowance + Math.max(2, 0.1 * d);
  const zAt = (i, j) => { const v = H[j * nx + i]; return Number.isNaN(v) ? floor : v; };
  const fx = (i) => (bbox.x0 + (i + 0.5) * dx).toFixed(3);
  const fy = (j) => (bbox.y0 + (j + 0.5) * dy).toFixed(3);

  const L = ['%', '(FRESATURA generata da pezzo 3D - finitura raster 3 assi)',
    `(pezzo ${w.toFixed(0)}x${h.toFixed(0)}x${d.toFixed(0)} - fresa D${toolDia.toFixed(1)} - passo ${stepover.toFixed(2)})`,
    'G21 G90 G17 G40', 'T1 M6', 'S12000 M3', `G0 Z${safeZ.toFixed(3)}`];
  let moves = 0;
  for (let j = 0; j < ny; j++) {
    const seq = j % 2 === 0 ? Array.from({ length: nx }, (_, i) => i) : Array.from({ length: nx }, (_, i) => nx - 1 - i);
    const i0 = seq[0];
    L.push(`G0 X${fx(i0)} Y${fy(j)}`);
    L.push(`G1 Z${zAt(i0, j).toFixed(3)} F${feed}`);
    for (const i of seq) { L.push(`G1 X${fx(i)} Y${fy(j)} Z${zAt(i, j).toFixed(3)}`); moves++; }
    L.push(`G0 Z${safeZ.toFixed(3)}`);
  }
  L.push('M5', 'M30', '%');
  return { gcode: L.join('\n'), orientedMesh: mesh, bbox, stock: minStock(bbox, { allowance }), moves, nx, ny, toolDia };
}
