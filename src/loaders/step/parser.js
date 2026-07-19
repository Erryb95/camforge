// @ts-check
// Loader STEP (fase 3) basato su occt-import-js (OpenCascade in WebAssembly,
// vendorizzato in vendor/occt/ — nessun CDN, tutto locale).
// La mesh triangolata viene ridotta a SPIGOLI CARATTERISTICI (bordi liberi +
// diedri oltre soglia) e mostrata come wireframe nelle viste XY/XZ/YZ.
// Il parse è ASINCRONO: il registry/main gestiscono il Promise.

import { newBounds, dist3 } from '../../core/model.js';
import { sequenceSegments } from '../cad/sequence.js';
import { applyCadTubeUnroll } from '../cad/tubeDetect.js';

const DIHEDRAL_DEG = 25;           // sopra questo angolo lo spigolo si vede
const VERT_PRECISION = 1000;       // dedup vertici a 1/1000 mm

/** @type {Promise<any>|null} */
let occtPromise = null;

async function getOcct() {
  if (occtPromise) return occtPromise;
  occtPromise = (async () => {
    let factory = /** @type {any} */ (globalThis).occtimportjs;
    if (!factory && typeof window !== 'undefined' && typeof document !== 'undefined') {
      // browser: inietta lo script UMD vendorizzato (lazy, solo al primo STEP)
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'vendor/occt/occt-import-js.js';
        s.onload = () => resolve(null);
        s.onerror = () => reject(new Error('vendor/occt/occt-import-js.js non caricabile'));
        document.head.appendChild(s);
      });
      factory = /** @type {any} */ (globalThis).occtimportjs;
    }
    let nodeFileURLToPath = null;
    if (!factory) {
      // Node (test / tools): richiedi l'UMD via createRequire
      const { createRequire } = await import('node:module');
      const { fileURLToPath } = await import('node:url');
      nodeFileURLToPath = fileURLToPath;
      const require = createRequire(import.meta.url);
      factory = require('../../../vendor/occt/occt-import-js.js');
    }
    return factory({
      locateFile: (file) => {
        if (!nodeFileURLToPath) return 'vendor/occt/' + file;
        return nodeFileURLToPath(new URL('../../../vendor/occt/' + file, import.meta.url));
      },
    });
  })();
  return occtPromise;
}

/**
 * Spigoli caratteristici da una mesh triangolata (vertici NON condivisi
 * tra facce: dedup posizionale prima di tutto).
 * @returns {{a:number, b:number}[] } coppie di indici in verts
 */
function featureEdges(pos, index, verts) {
  /** @type {Map<string, number>} */
  const vmap = new Map();
  /** @type {number[]} */
  const remap = [];
  const nVertsIn = pos.length / 3;
  for (let i = 0; i < nVertsIn; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const key = `${Math.round(x * VERT_PRECISION)},${Math.round(y * VERT_PRECISION)},${Math.round(z * VERT_PRECISION)}`;
    let id = vmap.get(key);
    if (id === undefined) {
      id = verts.length;
      verts.push([x, y, z]);
      vmap.set(key, id);
    }
    remap.push(id);
  }

  // triangoli: normali + baricentri + bounding box (per l'asse del pezzo)
  const nTri = index.length / 3;
  const normals = new Float64Array(nTri * 3);
  const cent = new Float64Array(nTri * 3);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const [x, y, z] of verts) {
    if (x < mn[0]) mn[0] = x; if (x > mx[0]) mx[0] = x;
    if (y < mn[1]) mn[1] = y; if (y > mx[1]) mx[1] = y;
    if (z < mn[2]) mn[2] = z; if (z > mx[2]) mx[2] = z;
  }
  /** @type {Map<string, {tris:number[]}>} */
  const edges = new Map();
  const addEdge = (a, b, t) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    let e = edges.get(key);
    if (!e) { e = { tris: [] }; edges.set(key, e); }
    e.tris.push(t);
  };
  for (let t = 0; t < nTri; t++) {
    const a = remap[index[t * 3]], b = remap[index[t * 3 + 1]], c = remap[index[t * 3 + 2]];
    if (a === b || b === c || a === c) continue;
    const [ax, ay, az] = verts[a], [bx, by, bz] = verts[b], [cx, cy, cz] = verts[c];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    normals[t * 3] = nx / l; normals[t * 3 + 1] = ny / l; normals[t * 3 + 2] = nz / l;
    cent[t * 3] = (ax + bx + cx) / 3; cent[t * 3 + 1] = (ay + by + cy) / 3; cent[t * 3 + 2] = (az + bz + cz) / 3;
    addEdge(a, b, t); addEdge(b, c, t); addEdge(c, a, t);
  }

  // Asse principale REALE del pezzo = componente principale (PCA) della nuvola
  // di vertici: il tubo/profilo è lungo lungo quell'asse, comunque orientato
  // nello spazio (i pezzi NON sono allineati agli assi mondo). Sulla superficie
  // ESTERNA la normale (occt orientata verso l'esterno) punta radialmente in
  // fuori dall'asse (o lungo l'asse per le facce di testa). Le facce INTERNE
  // (parete interna, pareti dei fori) puntano verso l'asse: i loro spigoli sono
  // i duplicati "interni" del taglio e vanno scartati — il laser incide solo
  // la faccia esterna del pezzo.
  const ap = [0, 0, 0];
  for (const v of verts) { ap[0] += v[0]; ap[1] += v[1]; ap[2] += v[2]; }
  ap[0] /= verts.length; ap[1] /= verts.length; ap[2] /= verts.length;
  // matrice di covarianza (simmetrica)
  let cxx = 0, cyy = 0, czz = 0, cxy = 0, cxz = 0, cyz = 0;
  for (const v of verts) {
    const dx = v[0] - ap[0], dy = v[1] - ap[1], dz = v[2] - ap[2];
    cxx += dx * dx; cyy += dy * dy; czz += dz * dz;
    cxy += dx * dy; cxz += dx * dz; cyz += dy * dz;
  }
  // autovettore dominante via power iteration
  let axis = [1, 0, 0];
  for (let it = 0; it < 40; it++) {
    const nx = cxx * axis[0] + cxy * axis[1] + cxz * axis[2];
    const ny = cxy * axis[0] + cyy * axis[1] + cyz * axis[2];
    const nz = cxz * axis[0] + cyz * axis[1] + czz * axis[2];
    const l = Math.hypot(nx, ny, nz) || 1;
    axis = [nx / l, ny / l, nz / l];
  }

  const outer = new Uint8Array(nTri);
  for (let t = 0; t < nTri; t++) {
    const dx = cent[t * 3] - ap[0], dy = cent[t * 3 + 1] - ap[1], dz = cent[t * 3 + 2] - ap[2];
    const along = dx * axis[0] + dy * axis[1] + dz * axis[2];
    let rx = dx - along * axis[0], ry = dy - along * axis[1], rz = dz - along * axis[2];
    const rlen = Math.hypot(rx, ry, rz) || 1;
    rx /= rlen; ry /= rlen; rz /= rlen;
    const nRad = normals[t * 3] * rx + normals[t * 3 + 1] * ry + normals[t * 3 + 2] * rz;
    // esterna se la normale punta radialmente in FUORI dall'asse. Le facce di
    // testa (normale assiale) restano "interne", ma il rim esterno di testa
    // viene comunque tenuto tramite la parete esterna adiacente.
    outer[t] = nRad > 0.15 ? 1 : 0;
  }

  const cosThr = Math.cos((DIHEDRAL_DEG * Math.PI) / 180);
  /** @type {{a:number, b:number}[]} */
  const out = [];
  for (const [key, e] of edges) {
    let keep = false;
    if (e.tris.length === 1) keep = outer[e.tris[0]] === 1;        // bordo libero, solo se esterno
    else if (e.tris.length >= 2) {
      const t0 = e.tris[0], t1 = e.tris[1];
      const dot = normals[t0 * 3] * normals[t1 * 3]
        + normals[t0 * 3 + 1] * normals[t1 * 3 + 1]
        + normals[t0 * 3 + 2] * normals[t1 * 3 + 2];
      // spigolo vivo E almeno una faccia adiacente sulla superficie esterna
      if (dot < cosThr && (outer[t0] === 1 || outer[t1] === 1)) keep = true;
    }
    if (keep) {
      const [a, b] = key.split('_').map(Number);
      out.push({ a, b });
    }
  }
  return out;
}

/**
 * @param {string|Uint8Array} content
 * @param {string} [fileName]
 * @returns {Promise<import('../../core/model.js').SceneModel>}
 */
export async function parseStep(content, fileName = '') {
  const occt = await getOcct();
  const buffer = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const fmt = ext === 'igs' || ext === 'iges' ? 'IGES' : ext === 'brep' ? 'BREP' : 'STEP';
  const read = fmt === 'IGES' ? occt.ReadIgesFile : fmt === 'BREP' ? occt.ReadBrepFile : occt.ReadStepFile;
  const result = read.call(occt, buffer, null);

  /** @type {import('../../core/model.js').Segment[]} */
  const segments = [];
  /** @type {{line:number, msg:string}[]} */
  const warnings = [];
  /** @type {string[]} */
  const listing = [];
  /** @type {Record<number, string>} */
  const toolNames = {};
  /** @type {number[]} */
  const toolsSeen = [];

  // mesh solida accumulata (per il rendering "Solido"): vertici + triangoli + utensile per faccia
  /** @type {number[]} */ const meshPos = [];
  /** @type {number[]} */ const meshIdx = [];
  /** @type {number[]} */ const meshTri = [];   // utensile per triangolo

  if (!result || !result.success) {
    warnings.push({ line: 1, msg: `OpenCascade non è riuscito a leggere il file ${fmt}` });
  }

  const meshes = (result && result.meshes) || [];
  meshes.forEach((mesh, mi) => {
    const tool = mi + 1;
    const name = (mesh.name || '').trim() || `Solido ${tool}`;
    toolNames[tool] = name;
    toolsSeen.push(tool);

    const pos = mesh.attributes && mesh.attributes.position && mesh.attributes.position.array;
    const idx = mesh.index && mesh.index.array;
    if (!pos || !idx) {
      listing.push(`Solido ${tool} — ${name}: senza mesh`);
      return;
    }
    // accumula la mesh solida (offset dei vertici)
    const base = meshPos.length / 3;
    for (let i = 0; i < pos.length; i++) meshPos.push(pos[i]);
    for (let i = 0; i < idx.length; i += 3) {
      meshIdx.push(base + idx[i], base + idx[i + 1], base + idx[i + 2]);
      meshTri.push(tool);
    }
    // spigoli caratteristici (filiforme), concatenati e ordinati per solido
    /** @type {number[][]} */
    const verts = [];
    const edges = featureEdges(pos, idx, verts);
    listing.push(`Solido ${tool} — ${name} · ${Math.round(idx.length / 3)} triangoli · ${edges.length} spigoli`);
    /** @type {import('../../core/model.js').Segment[]} */
    const solidSegs = [];
    for (const { a, b } of edges) {
      const from = { x: verts[a][0], y: verts[a][1], z: verts[a][2] };
      const to = { x: verts[b][0], y: verts[b][1], z: verts[b][2] };
      const len = dist3(from, to);
      if (len < 1e-9) continue;
      solidSegs.push({ type: 'feed', from, to, pts: [from, to], line: tool, tool, feed: null, len });
    }
    // sequenza di taglio ordinata (da un'estremità, poi per prossimità)
    for (const s of sequenceSegments(solidSegs)) segments.push(s);
  });

  if (meshes.length === 0 && result && result.success) {
    warnings.push({ line: 1, msg: `Il file ${fmt} non contiene solidi tessellabili` });
  }

  const all = newBounds();
  let feedLen = 0;
  for (const s of segments) { all.add(s.from); all.add(s.to); feedLen += s.len; }

  const mesh = meshIdx.length
    ? { positions: new Float64Array(meshPos), indices: new Uint32Array(meshIdx), triTool: new Uint32Array(meshTri) }
    : null;

  /** @type {Record<string, any>} */
  const meta = { dialect: fmt === 'STEP' ? 'STEP' : fmt, solidi: meshes.length };
  // se il solido è un tubo, calcola lo sviluppo → vista "Svolto" come per gli NC
  if (applyCadTubeUnroll(segments, meta)) {
    listing.push(`Tubo rilevato: ${meta.tubeDiameter ? `Ø${meta.tubeDiameter}` : `${meta.tubeWidth}×${meta.tubeHeight}`} L${meta.tubeLength}`);
  }

  return {
    name: fileName,
    program: null,
    units: 'mm',
    segments,
    drillPoints: [],
    warnings,
    rawLines: listing.length ? listing : ['(nessun solido)'],
    meta,
    toolNames,
    mesh,
    bounds: all.result(),
    boundsFeed: all.result(),
    stats: { feedLen, rapidLen: 0, timeMin: null, tools: toolsSeen },
  };
}
