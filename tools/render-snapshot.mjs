// Renderer headless: file NC/CN -> PNG dello sviluppo (o di una vista piana).
// Zero dipendenze: PNG scritto a mano con zlib di Node.
// Uso:  node tools/render-snapshot.mjs <input> <output.png> [vista] [larghezza] [altezza]
//       vista: DEV (default) | XY | XZ | YZ
import { readFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import '../src/loaders/nc/index.js';
import '../src/loaders/alma/index.js';
import '../src/loaders/dxf/index.js';
import '../src/loaders/step/index.js';
import '../src/loaders/dwg/index.js';
import '../src/loaders/atd/index.js';
import '../src/loaders/lra/index.js';
import '../src/loaders/stl/loader.js';
import { parseFile, isBinaryExt } from '../src/core/registry.js';
import { foldToStrip } from '../src/core/unroll.js';

const [, , input, output, view = 'DEV', W = '1200', H = '700'] = process.argv;
if (!input || !output) {
  console.error('uso: node tools/render-snapshot.mjs <input> <output.png> [DEV|XY|XZ|YZ] [w] [h]');
  process.exit(1);
}
const w = parseInt(W, 10), h = parseInt(H, 10);

const baseName = input.split(/[\\/]/).pop();
const content = isBinaryExt(baseName)
  ? new Uint8Array(await readFile(input))
  : await readFile(input, 'utf8');
const res = parseFile(baseName, content);
const model = await Promise.resolve(res.model);

// FOLD=<t>: PIEGATURA tubo (file .lra/.ybc) — mesh del tubo alla frazione di piega t (0=dritto,1=finito)
if (process.env.FOLD != null && process.env.FOLD !== '' && model.meta && model.meta.bend && view === '3D') {
  const { foldMeshFromCenterline } = await import('../src/sim/tubebend.js');
  const b = model.meta.bend;
  model.mesh = foldMeshFromCenterline(b.centerline, b.clr, b.od, Number(process.env.FOLD));
  console.error(`piega: ${b.nBends} pieghe (${b.format}), OD ${b.od}, CLR ${b.clr}, t=${process.env.FOLD}, ${model.mesh.indices.length / 3} tri`);
}
// STOCK=1: simula l'asportazione del materiale (Z-map) e usa lo stock come mesh
// (CARVE=<mm> per fermarsi a metà; default = programma intero)
if (process.env.STOCK && view === '3D') {
  const { MaterialSim } = await import('../src/sim/materialsim.js');
  const sim = new MaterialSim(model);
  if (sim.ok) {
    sim.carveTo(process.env.CARVE ? Number(process.env.CARVE) : null);
    model.mesh = { positions: sim.mesh().positions, indices: sim.mesh().indices };
    console.error(`stock: ${sim.hm.nx}x${sim.hm.ny} celle, utensile ${sim.tool.type} Ø${sim.tool.diameter}, volume asportato ${sim.hm.removedVolume().toFixed(0)} mm³`);
  }
}
// LASER=1: taglio LAMIERA — kerf attraverso lo spessore + separazione pezzi (CARVE=mm)
if (process.env.LASER && view === '3D') {
  const { LaserSheetSim } = await import('../src/sim/lasercut.js');
  const sim = new LaserSheetSim(model, { thickness: Number(process.env.THICK) || 3, kerf: Number(process.env.KERF) || 0.4 });
  if (sim.ok) {
    await sim.precompute();
    const carve = process.env.CARVE ? Number(process.env.CARVE) : null;
    let mesh = sim.meshAt(carve);
    // HEAD=1: aggiungi la testa laser posizionata al punto di taglio (headless, readFile)
    if (process.env.HEAD && carve != null) {
      const { parseSTL, mergeMeshes, meshBounds } = await import('../src/loaders/stl/index.js');
      const head = parseSTL(new Uint8Array(await readFile('samples/laserhead/LaserHead2.stl')), 3);
      const holder = parseSTL(new Uint8Array(await readFile('samples/laserhead/LaserHeadHolder2.stl')), 4);
      const hm = mergeMeshes([head, holder]);
      const hb = meshBounds(head);
      const tip = [(hb.min[0] + hb.max[0]) / 2, (hb.min[1] + hb.max[1]) / 2, hb.min[2]];
      const scale = (0.8 * Math.max(model.bounds.max.x - model.bounds.min.x, model.bounds.max.y - model.bounds.min.y)) / (hb.size[2] || 1);
      // punto di taglio a `carve`
      let acc = 0, cut = null;
      for (const s of model.segments) { const sl = s.len || 0; if (acc + sl >= carve) { const pts = s.pts; let rem = carve - acc, cum = 0; for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z); if (cum + d >= rem) { const t = (rem - cum) / (d || 1); cut = { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t }; break; } cum += d; } break; } acc += sl; }
      if (cut) {
        const hp = new Float64Array(hm.positions.length);
        for (let i = 0; i < hm.positions.length; i += 3) { hp[i] = cut.x + (hm.positions[i] - tip[0]) * scale; hp[i + 1] = cut.y + (hm.positions[i + 1] - tip[1]) * scale; hp[i + 2] = sim.thickness + 2 + (hm.positions[i + 2] - tip[2]) * scale; }
        const merged = mergeMeshes([{ positions: mesh.positions, indices: mesh.indices, triTool: mesh.triTool }, { positions: hp, indices: hm.indices, triTool: hm.triTool }]);
        mesh = merged;
      }
    }
    model.mesh = mesh;
    console.error(`laser: ${sim.contours.length} contorni, ${sim.regions.filter((r) => !r.isFrame).length} pezzi, ${model.mesh.indices.length / 3} tri`);
  }
}
// LASERTUBE=1: taglio LASER TUBO (kerf sullo svolto + troncatura=stacco assiale)
if (process.env.LASERTUBE && view === '3D') {
  const { LaserTubeSim, outwardNormalAt } = await import('../src/sim/lasertube.js');
  const sim = new LaserTubeSim(model, { wall: Number(process.env.WALL) || 2 });
  if (sim.ok) {
    await sim.precompute();
    const carve = process.env.CARVE ? Number(process.env.CARVE) : null;
    let mesh = sim.meshAt(carve);
    if (process.env.HEAD && carve != null) {
      const { parseSTL, mergeMeshes, meshBounds } = await import('../src/loaders/stl/index.js');
      const head = parseSTL(new Uint8Array(await readFile('samples/laserhead/LaserHead2.stl')), 3);
      const holder = parseSTL(new Uint8Array(await readFile('samples/laserhead/LaserHeadHolder2.stl')), 4);
      const hm = mergeMeshes([head, holder]); const hb = meshBounds(head);
      const tip = [(hb.min[0] + hb.max[0]) / 2, (hb.min[1] + hb.max[1]) / 2, hb.min[2]];
      const p = sim.profile; const sm = p.type === 'round' ? 2 * p.r : Math.max(p.w, p.h);
      const scale = 1.3 * sm / (hb.size[2] || 1);
      // punto di taglio a `carve`
      let acc = 0, cut = null; for (const s of model.segments) { const sl = s.len || 0; if (acc + sl >= carve) { const pts = s.pts; let rem = carve - acc, cum = 0; for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z); if (cum + d >= rem) { const t = (rem - cum) / (d || 1); cut = { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t, z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t }; break; } cum += d; } break; } acc += sl; }
      if (cut) {
        const n = outwardNormalAt(cut.y, cut.z, p);
        const nd = [0, -n[0], -n[1]]; const up = [0, n[0], n[1]];   // Z-locale verso esterno
        const ref = [1, 0, 0]; let ex = [ref[1] * up[2] - ref[2] * up[1], ref[2] * up[0] - ref[0] * up[2], ref[0] * up[1] - ref[1] * up[0]]; const exl = Math.hypot(...ex) || 1; ex = ex.map((v) => v / exl);
        const ey = [up[1] * ex[2] - up[2] * ex[1], up[2] * ex[0] - up[0] * ex[2], up[0] * ex[1] - up[1] * ex[0]];
        const tp = [cut.x, cut.y + n[0] * 3, cut.z + n[1] * 3];
        const hp = new Float64Array(hm.positions.length);
        for (let i = 0; i < hm.positions.length; i += 3) { const lx = (hm.positions[i] - tip[0]) * scale, ly = (hm.positions[i + 1] - tip[1]) * scale, lz = (hm.positions[i + 2] - tip[2]) * scale; hp[i] = tp[0] + ex[0] * lx + ey[0] * ly + up[0] * lz; hp[i + 1] = tp[1] + ex[1] * lx + ey[1] * ly + up[1] * lz; hp[i + 2] = tp[2] + ex[2] * lx + ey[2] * ly + up[2] * lz; }
        mesh = mergeMeshes([mesh, { positions: hp, indices: hm.indices, triTool: hm.triTool }]);
      }
    }
    model.mesh = mesh;
    console.error(`laser-tubo: ${sim.contours.length} contorni, ${sim.axials.length} assiali, ${sim.slugs.length} slug, ${model.mesh.indices.length / 3} tri`);
  }
}
// TRIDEXEL=1: come STOCK ma col motore tri-dexel (4/5 assi, undercut/pareti nette)
if (process.env.TRIDEXEL && view === '3D') {
  const { MaterialSim5 } = await import('../src/sim/materialsim5.js');
  const sim = new MaterialSim5(model, { cellsTarget: Number(process.env.CELLS) || 90, fiveAxis: !!process.env.FIVEAXIS });
  if (sim.ok) {
    const carve = process.env.CARVE ? Number(process.env.CARVE) : null;
    sim.carveTo(carve);
    const m = sim.mesh();
    let mesh = { positions: m.positions, indices: m.indices };
    if (process.env.HEAD && carve != null) {   // punta fresa al punto utensile
      const { parseSTL, meshBounds, mergeMeshes } = await import('../src/loaders/stl/index.js');
      const g = parseSTL(new Uint8Array(await readFile('samples/millhead/bit.stl')), 5);
      const b = meshBounds(g); const tip = [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2];
      const dia = Math.min(b.size[0], b.size[2]); const scale = (sim.tool.r * 2) / (dia || 1);
      let acc = 0, cut = null; for (const s of model.segments) { const sl = s.len || 0; if (acc + sl >= carve) { const pts = s.pts; let rem = carve - acc, cum = 0; for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z); if (cum + d >= rem) { const t = (rem - cum) / (d || 1); cut = { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t, z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t }; break; } cum += d; } break; } acc += sl; }
      if (cut) {
        const rt = [tip[0], -tip[2], tip[1]]; const hp = new Float64Array(g.positions.length);
        for (let i = 0; i < g.positions.length; i += 3) { hp[i] = cut.x + (g.positions[i] - rt[0]) * scale; hp[i + 1] = cut.y + (-g.positions[i + 2] - rt[1]) * scale; hp[i + 2] = cut.z + (g.positions[i + 1] - rt[2]) * scale; }
        mesh = mergeMeshes([{ ...mesh, triTool: new Uint32Array(mesh.indices.length / 3) }, { positions: hp, indices: g.indices, triTool: g.triTool }]);
      }
    }
    model.mesh = mesh;
    console.error(`tri-dexel: carve=${carve == null ? 'tutto' : carve}, volume solido ${sim.td.solidVolume().toFixed(0)} mm³, ${model.mesh.indices.length / 3} tri`);
  }
}

// --- proiezione ---
// orbita 3D fissa (stessa formula del viewer): az/el via env AZ/EL (gradi)
const az = (Number(process.env.AZ) || -46) * Math.PI / 180;
const el = (Number(process.env.EL) || 29) * Math.PI / 180;
const p3d = (p) => [
  p.x * Math.sin(az) - p.y * Math.cos(az),
  -p.x * Math.sin(el) * Math.cos(az) - p.y * Math.sin(el) * Math.sin(az) + p.z * Math.cos(el),
];
const PLANES = {
  XY: (p) => [p.x, p.y],
  XZ: (p) => [p.x, p.z],
  YZ: (p) => [p.y, p.z],
  '3D': p3d,
};
/** @type {{type:string, pts:number[][]}[]} */
const polys = [];
const per = model.meta && model.meta.perimeter;
for (const seg of model.segments) {
  let pts;
  let breaks = null;
  if (view === 'DEV') {
    if (!seg.uv) continue;
    // ripiega su UNA sezione [-per/2, per/2) e segna dove attraversa la cucitura
    let prevV = 0;
    pts = seg.uv.map((q, i) => {
      const v = per ? foldToStrip(q.v, per) : q.v;
      if (per && i > 0 && Math.abs(v - prevV) > per / 2) (breaks ||= new Set()).add(i);
      prevV = v;
      return [q.u, v];
    });
  } else if (view === '3D') {
    pts = (seg.tubePts || seg.pts).map(p3d);   // tubi: contorni avvolti sul solido
  } else {
    pts = seg.pts.map(PLANES[view]);
  }
  polys.push({ type: seg.type, pts, breaks });
}
// modello SOLO-MESH (STL/STEP senza percorso): fit dalle 8 corner del bbox mesh
if (!polys.length && view === '3D' && model.mesh && model.mesh.positions.length) {
  const P = model.mesh.positions;
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { if (P[i + k] < bb[k]) bb[k] = P[i + k]; if (P[i + k] > bb[k + 3]) bb[k + 3] = P[i + k]; }
  const corners = [];
  for (const x of [bb[0], bb[3]]) for (const y of [bb[1], bb[4]]) for (const z of [bb[2], bb[5]]) corners.push(p3d({ x, y, z }));
  polys.push({ type: 'feed', pts: corners, breaks: null });
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
// includi i bordi facce nella scala verticale: la vista mostra sempre la sezione intera
if (view === 'DEV' && model.meta && model.meta.unrollGuides) {
  for (const g of model.meta.unrollGuides) { if (g < minV) minV = g; if (g > maxV) maxV = g; }
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
// --- solido ombreggiato (vista 3D, SOLID=1) ---
if (view === '3D' && model.mesh && process.env.SOLID) {
  const P = model.mesh.positions, I = model.mesh.indices;
  const nTri = I.length / 3;
  const [dx, dy, dz] = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
  let lx = dx, ly = dy, lz = dz + 0.65; const ll = Math.hypot(lx, ly, lz); lx /= ll; ly /= ll; lz /= ll;
  const order = [...Array(nTri).keys()].sort((s, t) => {
    const cd = (k) => { const a = I[k * 3] * 3, b = I[k * 3 + 1] * 3, c = I[k * 3 + 2] * 3;
      return ((P[a] + P[b] + P[c]) * dx + (P[a + 1] + P[b + 1] + P[c + 1]) * dy + (P[a + 2] + P[b + 2] + P[c + 2]) * dz) / 3; };
    return cd(s) - cd(t);
  });
  const fillTri = (ax, ay, bx, by, cxp, cyp, r, g, b) => {
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cyp)));
    const maxY = Math.min(h - 1, Math.ceil(Math.max(ay, by, cyp)));
    const area = (bx - ax) * (cyp - ay) - (cxp - ax) * (by - ay);
    if (Math.abs(area) < 1e-6) return;
    for (let y = minY; y <= maxY; y++) {
      const minX = Math.max(0, Math.floor(Math.min(ax, bx, cxp)));
      const maxX = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cxp)));
      for (let x = minX; x <= maxX; x++) {
        const w0 = ((bx - ax) * (y + 0.5 - ay) - (by - ay) * (x + 0.5 - ax)) / area;
        const w1 = ((cxp - bx) * (y + 0.5 - by) - (cyp - by) * (x + 0.5 - bx)) / area;
        const w2 = ((ax - cxp) * (y + 0.5 - cyp) - (ay - cyp) * (x + 0.5 - cxp)) / area;
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) put(x, y, r, g, b);
      }
    }
  };
  for (const t of order) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const sh = 0.32 + 0.68 * Math.abs(nx * lx + ny * ly + nz * lz);
    const [pa, pb, pc] = [[P[a], P[a + 1], P[a + 2]], [P[b], P[b + 1], P[b + 2]], [P[c], P[c + 1], P[c + 2]]];
    const [ua, va] = p3d({ x: pa[0], y: pa[1], z: pa[2] });
    const [ub, vb] = p3d({ x: pb[0], y: pb[1], z: pb[2] });
    const [uc, vc] = p3d({ x: pc[0], y: pc[1], z: pc[2] });
    fillTri(sx(ua), sy(va), sx(ub), sy(vb), sx(uc), sy(vc),
      (0x4c * sh) | 0, (0xc9 * sh) | 0, (0xf0 * sh) | 0);
  }
}

// assi u=0 / v=0
if (view !== '3D' || !process.env.SOLID) {
  line(sx(0), 0, sx(0), h - 1, 0x26, 0x2e, 0x3b);
  line(0, sy(0), w - 1, sy(0), 0x26, 0x2e, 0x3b);
}

// in simulazione asportazione (stock/tri-dexel/laser) il pezzo È il solido scavato:
// mostrare tutto il percorso lo farebbe sembrare già finito → disegno solo la SCIA
// già percorsa (fino a CARVE), niente rapidi, tinta tenue. (allineato al viewer)
const stockSim = view === '3D' && !!process.env.SOLID &&
  !!(process.env.STOCK || process.env.TRIDEXEL || process.env.LASER || process.env.LASERTUBE);
const carveEnv = process.env.CARVE != null && process.env.CARVE !== '' ? Number(process.env.CARVE) : null;
let cumEnd = null;
if (stockSim) { cumEnd = []; let acc = 0; for (const seg of model.segments) { acc += seg.len || 0; cumEnd.push(acc); } }

for (let pi = 0; pi < polys.length; pi++) {
  const p = polys[pi];
  const rapid = p.type === 'rapid';
  if (stockSim) {
    if (rapid) continue;                                       // niente rapidi sul solido
    const start = (cumEnd[pi] || 0) - (model.segments[pi] ? model.segments[pi].len || 0 : 0);
    if (carveEnv != null && start >= carveEnv) continue;       // percorso ancora da tagliare
  }
  const [r, g, b] = stockSim ? [0x2a, 0x6b, 0x82] : (rapid ? [0x8a, 0x55, 0x60] : [0x4c, 0xc9, 0xf0]);
  for (let i = 1; i < p.pts.length; i++) {
    if (p.breaks && p.breaks.has(i)) continue;   // salta la cucitura
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
