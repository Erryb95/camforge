// @ts-check
// Loader STEP (fase 3) basato su occt-import-js (OpenCascade in WebAssembly,
// vendorizzato in vendor/occt/ — nessun CDN, tutto locale).
// La mesh triangolata viene ridotta a SPIGOLI CARATTERISTICI (bordi liberi +
// diedri oltre soglia) e mostrata come wireframe nelle viste XY/XZ/YZ.
// Il parse è ASINCRONO: il registry/main gestiscono il Promise.

import { newBounds, dist3 } from '../../core/model.js';

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

  // triangoli + normali
  const nTri = index.length / 3;
  const normals = new Float64Array(nTri * 3);
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
    addEdge(a, b, t); addEdge(b, c, t); addEdge(c, a, t);
  }

  const cosThr = Math.cos((DIHEDRAL_DEG * Math.PI) / 180);
  /** @type {{a:number, b:number}[]} */
  const out = [];
  for (const [key, e] of edges) {
    let keep = false;
    if (e.tris.length === 1) keep = true;              // bordo libero
    else if (e.tris.length >= 2) {
      const t0 = e.tris[0], t1 = e.tris[1];
      const dot = normals[t0 * 3] * normals[t1 * 3]
        + normals[t0 * 3 + 1] * normals[t1 * 3 + 1]
        + normals[t0 * 3 + 2] * normals[t1 * 3 + 2];
      if (dot < cosThr) keep = true;                   // spigolo vivo
    }
    if (keep) {
      const [a, b] = key.split('_').map(Number);
      out.push({ a, b });
    }
  }
  return out;
}

/**
 * @param {string} text
 * @param {string} [fileName]
 * @returns {Promise<import('../../core/model.js').SceneModel>}
 */
export async function parseStep(text, fileName = '') {
  const occt = await getOcct();
  const buffer = new TextEncoder().encode(text);
  const result = occt.ReadStepFile(buffer, null);

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

  if (!result || !result.success) {
    warnings.push({ line: 1, msg: 'OpenCascade non è riuscito a leggere il file STEP' });
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
    /** @type {number[][]} */
    const verts = [];
    const edges = featureEdges(pos, idx, verts);
    listing.push(`Solido ${tool} — ${name} · ${Math.round(idx.length / 3)} triangoli · ${edges.length} spigoli`);
    for (const { a, b } of edges) {
      const from = { x: verts[a][0], y: verts[a][1], z: verts[a][2] };
      const to = { x: verts[b][0], y: verts[b][1], z: verts[b][2] };
      const len = dist3(from, to);
      if (len < 1e-9) continue;
      segments.push({
        type: 'feed', from, to, pts: [from, to],
        line: mi + 1, tool, feed: null, len,
      });
    }
  });

  if (meshes.length === 0 && result && result.success) {
    warnings.push({ line: 1, msg: 'Il file STEP non contiene solidi tessellabili' });
  }

  const all = newBounds();
  let feedLen = 0;
  for (const s of segments) { all.add(s.from); all.add(s.to); feedLen += s.len; }

  return {
    name: fileName,
    program: null,
    units: 'mm',
    segments,
    drillPoints: [],
    warnings,
    rawLines: listing.length ? listing : ['(nessun solido)'],
    meta: { dialect: 'STEP', solidi: meshes.length },
    toolNames,
    bounds: all.result(),
    boundsFeed: all.result(),
    stats: { feedLen, rapidLen: 0, timeMin: null, tools: toolsSeen },
  };
}
