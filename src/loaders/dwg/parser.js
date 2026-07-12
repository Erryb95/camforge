// @ts-check
// Loader DWG (fase 3) basato su libredwg-web (LibreDWG in WebAssembly,
// vendorizzato in vendor/libredwg/ — nessun CDN). Converte il DWG in un
// database tipizzato e mappa le entità sullo stesso SceneModel del DXF,
// riusando la geometria condivisa (archi, bulge, ellissi, spline, blocchi).
// Parse ASINCRONO (registry/main gestiscono il Promise).

import { newBounds, dist3 } from '../../core/model.js';
import { IDENT, mul, apply, arcPoints, bulgePolyline, ellipsePoints, splinePoints } from '../cad/geometry.js';

const MAX_INSERT_DEPTH = 8;
const DEG = Math.PI / 180;

/** @type {Promise<{LibreDwg:any, Dwg_File_Type:any, lib:any}>|null} */
let libPromise = null;

async function getLib() {
  if (libPromise) return libPromise;
  libPromise = (async () => {
    const url = new URL('../../../vendor/libredwg/dist/libredwg-web.js', import.meta.url).href;
    const mod = await import(url);
    const lib = await mod.LibreDwg.create();
    return { LibreDwg: mod.LibreDwg, Dwg_File_Type: mod.Dwg_File_Type, lib };
  })();
  return libPromise;
}

/** INSUNITS AutoCAD → fattore verso mm. */
function unitScaleFromHeader(header) {
  switch (header && header.INSUNITS) {
    case 1: return 25.4;    // pollici
    case 2: return 304.8;   // piedi
    case 5: return 10;      // cm
    case 6: return 1000;    // metri
    default: return 1;      // mm / senza unità
  }
}

/**
 * @param {Uint8Array|ArrayBuffer|string} content
 * @param {string} [fileName]
 * @returns {Promise<import('../../core/model.js').SceneModel>}
 */
export async function parseDwg(content, fileName = '') {
  let bytes;
  if (typeof content === 'string') bytes = new TextEncoder().encode(content);
  else if (content instanceof ArrayBuffer) bytes = new Uint8Array(content);
  else bytes = content;

  const { lib, Dwg_File_Type } = await getLib();
  // rilevamento formato: i DWG iniziano con "AC10.."; tutto il resto → DXF
  const isDwg = bytes[0] === 0x41 && bytes[1] === 0x43; // "AC"
  const dwg = lib.dwg_read_data(bytes, isDwg ? Dwg_File_Type.DWG : Dwg_File_Type.DXF);
  const db = lib.convert(dwg);

  /** @type {import('../../core/model.js').Segment[]} */
  const segments = [];
  /** @type {import('../../core/model.js').DrillPoint[]} */
  const drillPoints = [];
  /** @type {{line:number, msg:string}[]} */
  const warnings = [];
  const warnedOnce = new Set();
  const warn = (line, msg, once = false) => {
    if (once) { if (warnedOnce.has(msg)) return; warnedOnce.add(msg); }
    if (warnings.length < 500) warnings.push({ line, msg });
  };

  const unitScale = unitScaleFromHeader(db.header);
  let has3d = false;

  // layer → "utensile"
  const layerTool = new Map();
  /** @type {Record<number, string>} */
  const toolNames = {};
  /** @type {number[]} */
  const toolsSeen = [];
  const toolOf = (layer) => {
    const name = layer || '0';
    if (!layerTool.has(name)) {
      const t = layerTool.size + 1;
      layerTool.set(name, t);
      toolNames[t] = name;
      toolsSeen.push(t);
    }
    return layerTool.get(name);
  };

  // mappa blocchi (per INSERT): nome → entità
  /** @type {Map<string, any[]>} */
  const blocks = new Map();
  const brEntries = (db.tables && db.tables.BLOCK_RECORD && db.tables.BLOCK_RECORD.entries) || [];
  for (const br of brEntries) {
    if (br && br.name && Array.isArray(br.entities)) blocks.set(br.name, br.entities);
  }

  let line = 0;   // le entità DWG non hanno righe sorgente: numerazione progressiva

  /** Emette una polilinea 2D (coordinate disegno, trasformate). */
  function emitPath2(pts, layer) {
    const tool = toolOf(layer);
    for (let i = 1; i < pts.length; i++) {
      const from = { x: pts[i - 1][0] * unitScale, y: pts[i - 1][1] * unitScale, z: 0 };
      const to = { x: pts[i][0] * unitScale, y: pts[i][1] * unitScale, z: 0 };
      const len = dist3(from, to);
      if (len < 1e-9) continue;
      segments.push({ type: 'feed', from, to, pts: [from, to], line, tool, feed: null, len });
    }
  }

  /** Emette una polilinea 3D (coordinate mondo con z). */
  function emitPath3(pts3, layer) {
    const tool = toolOf(layer);
    for (let i = 1; i < pts3.length; i++) {
      const from = { x: pts3[i - 1].x * unitScale, y: pts3[i - 1].y * unitScale, z: pts3[i - 1].z * unitScale };
      const to = { x: pts3[i].x * unitScale, y: pts3[i].y * unitScale, z: pts3[i].z * unitScale };
      const len = dist3(from, to);
      if (len < 1e-9) continue;
      if (Math.abs(from.z) > 1e-9 || Math.abs(to.z) > 1e-9) has3d = true;
      segments.push({ type: 'feed', from, to, pts: [from, to], line, tool, feed: null, len });
    }
  }

  let entityCount = 0;

  function emitEntity(e, m, depth) {
    if (!e || !e.type) return;
    if (e.isInPaperSpace) return;
    const layer = e.layer || '0';
    const T = (x, y) => apply(m, x, y);
    line++;

    switch (e.type) {
      case 'LINE': {
        entityCount++;
        const a = e.startPoint || {}, b = e.endPoint || {};
        if ((a.z || b.z) && depth === 0) { has3d = has3d || !!(a.z || b.z); }
        emitPath2([T(a.x || 0, a.y || 0), T(b.x || 0, b.y || 0)], layer);
        if (a.z || b.z) {
          // linea con quota: rimpiazza l'ultimo segmento con versione 3D
          segments.pop();
          emitPath3([{ x: a.x || 0, y: a.y || 0, z: a.z || 0 }, { x: b.x || 0, y: b.y || 0, z: b.z || 0 }], layer);
        }
        break;
      }
      case 'CIRCLE':
      case 'ARC': {
        entityCount++;
        const c = e.center || {};
        const r = e.radius || 0;
        let a0 = 0, sweep = Math.PI * 2;
        if (e.type === 'ARC') {
          a0 = (e.startAngle || 0) * DEG;
          let a1 = (e.endAngle || 0) * DEG;
          while (a1 <= a0 + 1e-12) a1 += Math.PI * 2;
          sweep = a1 - a0;
        }
        emitPath2(arcPoints(c.x || 0, c.y || 0, r, a0, sweep).map(([x, y]) => T(x, y)), layer);
        break;
      }
      case 'LWPOLYLINE': {
        entityCount++;
        const closed = ((e.flag || 0) & 1) === 1;
        const verts = (e.vertices || []).map((v) => ({ x: v.x || 0, y: v.y || 0, bulge: v.bulge || 0 }));
        emitPath2(bulgePolyline(verts, closed).map(([x, y]) => T(x, y)), layer);
        break;
      }
      case 'POLYLINE':
      case 'POLYLINE2D':
      case 'POLYLINE3D': {
        entityCount++;
        const closed = ((e.flag || 0) & 1) === 1;
        const vs = e.vertices || [];
        if (e.type === 'POLYLINE3D' || vs.some((v) => v.z)) {
          const pts3 = vs.map((v) => ({ x: v.x || 0, y: v.y || 0, z: v.z || 0 }));
          if (closed && pts3.length) pts3.push(pts3[0]);
          // applica solo traslazione/rotazione XY della matrice, Z invariata
          emitPath3(pts3.map((p) => { const [x, y] = T(p.x, p.y); return { x, y, z: p.z }; }), layer);
        } else {
          const verts = vs.map((v) => ({ x: v.x || 0, y: v.y || 0, bulge: v.bulge || 0 }));
          emitPath2(bulgePolyline(verts, closed).map(([x, y]) => T(x, y)), layer);
        }
        break;
      }
      case 'POINT': {
        entityCount++;
        const p = e.position || {};
        const [x, y] = T(p.x || 0, p.y || 0);
        drillPoints.push({
          at: { x: x * unitScale, y: y * unitScale, z: (p.z || 0) * unitScale },
          cycle: 'POINT', line, tool: toolOf(layer), afterSeg: segments.length,
        });
        break;
      }
      case 'ELLIPSE': {
        entityCount++;
        const c = e.center || {}, ax = e.majorAxisEndPoint || {};
        const ratio = e.axisRatio != null ? e.axisRatio : 1;
        const p0 = e.startAngle || 0, p1 = (e.endAngle != null ? e.endAngle : Math.PI * 2);
        emitPath2(ellipsePoints(c.x || 0, c.y || 0, ax.x || 1, ax.y || 0, ratio, p0, p1).map(([x, y]) => T(x, y)), layer);
        break;
      }
      case 'SPLINE': {
        entityCount++;
        const degree = e.degree || 3;
        const fit = e.fitPoints || [];
        let pts;
        if (fit.length > 1) {
          pts = fit.map((p) => [p.x || 0, p.y || 0]);
        } else {
          const ctrl = (e.controlPoints || []).map((p) => [p.x || 0, p.y || 0]);
          pts = splinePoints(ctrl, e.knots || [], degree, (msg) => warn(line, msg));
        }
        emitPath2(pts.map(([x, y]) => T(x, y)), layer);
        break;
      }
      case 'INSERT': {
        entityCount++;
        const ents = blocks.get(e.name);
        if (!ents) { warn(line, `INSERT: blocco "${e.name}" non trovato`, true); break; }
        if (depth >= MAX_INSERT_DEPTH) { warn(line, 'INSERT: profondità blocchi eccessiva', true); break; }
        const ip = e.insertionPoint || {};
        const rot = (e.rotation || 0);   // libredwg espone radianti
        const cosr = Math.cos(rot), sinr = Math.sin(rot);
        let mLocal = mul(m, [cosr, sinr, -sinr, cosr, ip.x || 0, ip.y || 0]);
        mLocal = mul(mLocal, [e.xScale || 1, 0, 0, e.yScale || 1, 0, 0]);
        for (const child of ents) emitEntity(child, mLocal, depth + 1);
        break;
      }
      case 'ATTRIB':
      case 'ATTDEF':
      case 'MTEXT':
      case 'TEXT':
      case 'DIMENSION':
      case 'HATCH':
        break; // non geometria di percorso: ignorati in silenzio
      default:
        warn(line, `Entità DWG "${e.type}" non supportata (ignorata)`, true);
    }
  }

  for (const e of db.entities || []) emitEntity(e, IDENT, 0);

  if (entityCount === 0) {
    warn(1, isDwg ? 'Nessuna entità disegnabile nel DWG' : 'Nessuna entità disegnabile');
  }

  lib.dwg_free(dwg);

  const all = newBounds();
  let feedLen = 0;
  for (const s of segments) { all.add(s.from); all.add(s.to); feedLen += s.len; }
  for (const d of drillPoints) all.add(d.at);

  return {
    name: fileName,
    program: null,
    units: 'mm',
    segments,
    drillPoints,
    warnings,
    rawLines: [`DWG — ${db.entities ? db.entities.length : 0} entità, ${toolsSeen.length} layer`],
    meta: { dialect: has3d ? 'DWG3D' : 'DWG', unitScale },
    toolNames,
    bounds: all.result(),
    boundsFeed: all.result(),
    stats: { feedLen, rapidLen: 0, timeMin: null, tools: toolsSeen },
  };
}
