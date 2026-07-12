// @ts-check
// Loader DXF (ASCII) zero-dipendenze -> SceneModel.
// Entità: LINE, CIRCLE, ARC, LWPOLYLINE (bulge), POLYLINE/VERTEX (bulge),
// POINT, ELLIPSE, SPLINE (de Boor o fit points), INSERT (blocchi, ricorsivo).
// I layer diventano "utensili" (colori + toggle nel pannello Info); il pannello
// codice mostra il testo DXF reale, sincronizzato per entità.

import { newBounds, dist3 } from '../../core/model.js';
import { IDENT, mul, apply, arcPoints, bulgePolyline, ellipsePoints, splinePoints } from '../cad/geometry.js';

const MAX_INSERT_DEPTH = 8;

/**
 * @param {string} text
 * @param {string} [fileName]
 * @returns {import('../../core/model.js').SceneModel}
 */
export function parseDXF(text, fileName = '') {
  const rawLines = text.split(/\r\n|\r|\n/);

  /** @type {{code:number, value:string, line:number}[]} */
  const pairs = [];
  for (let i = 0; i + 1 < rawLines.length; i += 2) {
    const code = parseInt(rawLines[i].trim(), 10);
    if (Number.isNaN(code)) continue;
    pairs.push({ code, value: rawLines[i + 1].trim(), line: i + 1 });
  }

  /** @type {import('../../core/model.js').Segment[]} */
  const segments = [];
  /** @type {import('../../core/model.js').DrillPoint[]} */
  const drillPoints = [];
  /** @type {{line:number, msg:string}[]} */
  const warnings = [];
  const warnedOnce = new Set();
  const warn = (line, msg, once = false) => {
    if (once) {
      if (warnedOnce.has(msg)) return;
      warnedOnce.add(msg);
    }
    if (warnings.length < 500) warnings.push({ line, msg });
  };

  // ---------- prima passata: sezioni, header, blocchi, entità ----------
  let unitScale = 1;                 // -> mm
  /** @type {Map<string, {baseX:number, baseY:number, entities:any[]}>} */
  const blocks = new Map();
  /** @type {any[]} */
  const topEntities = [];

  {
    let i = 0;
    let section = '';
    let curBlock = null;
    /** @type {any} */
    let ent = null;

    const closeEnt = () => {
      if (!ent) return;
      const target = curBlock ? curBlock.entities : topEntities;
      target.push(ent);
      ent = null;
    };

    for (; i < pairs.length; i++) {
      const { code, value, line } = pairs[i];
      if (code === 0) {
        if (value === 'SECTION') { closeEnt(); section = ''; continue; }
        if (value === 'ENDSEC') { closeEnt(); section = ''; curBlock = null; continue; }
        if (value === 'BLOCK' && section === 'BLOCKS') {
          closeEnt();
          curBlock = { name: '', baseX: 0, baseY: 0, entities: [] };
          continue;
        }
        if (value === 'ENDBLK') {
          closeEnt();
          if (curBlock && curBlock.name) blocks.set(curBlock.name, curBlock);
          curBlock = null;
          continue;
        }
        closeEnt();
        // solo le entità vere (sezione ENTITIES o dentro un blocco)
        if (section === 'ENTITIES' || curBlock) {
          ent = { type: value, line, data: [] };
        }
        continue;
      }
      if (code === 2 && section === '' ) { section = value; continue; }  // nome sezione
      if (code === 2 && curBlock && !curBlock.name && !ent) { curBlock.name = value; continue; }
      if (code === 9 && section === 'HEADER') {
        // variabile header: leggi $INSUNITS
        if (value === '$INSUNITS' && pairs[i + 1] && pairs[i + 1].code === 70) {
          const u = parseInt(pairs[i + 1].value, 10);
          if (u === 1) unitScale = 25.4;        // pollici
          else if (u === 2) unitScale = 304.8;  // piedi
          else if (u === 5) unitScale = 10;     // cm
          else if (u === 6) unitScale = 1000;   // metri
          else unitScale = 1;                   // mm / senza unità
        }
        continue;
      }
      if (ent) {
        ent.data.push([code, value]);
        continue;
      }
      if (curBlock && code === 10 && !curBlock.entities.length) { curBlock.baseX = parseFloat(value); continue; }
      if (curBlock && code === 20 && !curBlock.entities.length) { curBlock.baseY = parseFloat(value); continue; }
    }
    closeEnt();
  }

  // ---------- layer -> "utensile" ----------
  /** @type {Map<string, number>} */
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
    return /** @type {number} */ (layerTool.get(name));
  };

  // ---------- helper di lettura group-code ----------
  const val = (data, code, def = null) => {
    for (const [c, v] of data) if (c === code) return parseFloat(v);
    return def;
  };
  const str = (data, code, def = '') => {
    for (const [c, v] of data) if (c === code) return v;
    return def;
  };
  const vals = (data, code) => data.filter(([c]) => c === code).map(([, v]) => parseFloat(v));

  /** Emette una polilinea (in coordinate già trasformate, unità disegno). */
  function emitPolyline(pts, layer, line) {
    const tool = toolOf(layer);
    for (let i = 1; i < pts.length; i++) {
      const from = { x: pts[i - 1][0] * unitScale, y: pts[i - 1][1] * unitScale, z: 0 };
      const to = { x: pts[i][0] * unitScale, y: pts[i][1] * unitScale, z: 0 };
      const len = dist3(from, to);
      if (len < 1e-9) continue;
      segments.push({ type: 'feed', from, to, pts: [from, to], line, tool, feed: null, len });
    }
  }

  // arcPoints, bulgePolyline, ellipsePoints, splinePoints: da ../cad/geometry.js

  // ---------- emissione entità ----------
  let entityCount = 0;

  function emitEntity(ent, m, depth) {
    if (val(ent.data, 67, 0) === 1) return;   // spazio carta: non è geometria del pezzo
    const layer = str(ent.data, 8, '0');
    const T = (x, y) => apply(m, x, y);

    switch (ent.type) {
      case 'LINE': {
        entityCount++;
        emitPolyline([T(val(ent.data, 10, 0), val(ent.data, 20, 0)),
                      T(val(ent.data, 11, 0), val(ent.data, 21, 0))], layer, ent.line);
        break;
      }
      case 'CIRCLE':
      case 'ARC': {
        entityCount++;
        const cx = val(ent.data, 10, 0), cy = val(ent.data, 20, 0), r = val(ent.data, 40, 0);
        let a0 = 0, sweep = Math.PI * 2;
        if (ent.type === 'ARC') {
          a0 = (val(ent.data, 50, 0) * Math.PI) / 180;
          let a1 = (val(ent.data, 51, 0) * Math.PI) / 180;
          while (a1 <= a0 + 1e-12) a1 += Math.PI * 2;
          sweep = a1 - a0;
        }
        emitPolyline(arcPoints(cx, cy, r, a0, sweep).map(([x, y]) => T(x, y)), layer, ent.line);
        break;
      }
      case 'LWPOLYLINE': {
        entityCount++;
        const closed = (val(ent.data, 70, 0) & 1) === 1;
        /** @type {{x:number,y:number,bulge:number}[]} */
        const verts = [];
        let cur = null;
        for (const [c, v] of ent.data) {
          if (c === 10) { cur = { x: parseFloat(v), y: 0, bulge: 0 }; verts.push(cur); }
          else if (c === 20 && cur) cur.y = parseFloat(v);
          else if (c === 42 && cur) cur.bulge = parseFloat(v);
        }
        emitPolyline(bulgePolyline(verts, closed).map(([x, y]) => T(x, y)), layer, ent.line);
        break;
      }
      case 'POINT': {
        entityCount++;
        const [x, y] = T(val(ent.data, 10, 0), val(ent.data, 20, 0));
        drillPoints.push({
          at: { x: x * unitScale, y: y * unitScale, z: 0 },
          cycle: 'POINT', line: ent.line, tool: toolOf(layer), afterSeg: segments.length,
        });
        break;
      }
      case 'ELLIPSE': {
        entityCount++;
        const cx = val(ent.data, 10, 0), cy = val(ent.data, 20, 0);
        const mx = val(ent.data, 11, 1), my = val(ent.data, 21, 0);
        const ratio = val(ent.data, 40, 1);
        const p0 = val(ent.data, 41, 0), p1 = val(ent.data, 42, Math.PI * 2);
        emitPolyline(ellipsePoints(cx, cy, mx, my, ratio, p0, p1).map(([x, y]) => T(x, y)), layer, ent.line);
        break;
      }
      case 'SPLINE': {
        entityCount++;
        const degree = Math.round(val(ent.data, 71, 3) ?? 3);
        const fitX = vals(ent.data, 11), fitY = vals(ent.data, 21);
        let pts;
        if (fitX.length > 1) {
          pts = fitX.map((x, i) => [x, fitY[i] ?? 0]);
        } else {
          const cxs = vals(ent.data, 10), cys = vals(ent.data, 20);
          const ctrl = cxs.map((x, i) => [x, cys[i] ?? 0]);
          if (vals(ent.data, 43).length) warn(ent.line, 'SPLINE razionale (pesi 43): approssimata senza pesi', true);
          pts = splinePoints(ctrl, vals(ent.data, 40), degree, (msg) => warn(ent.line, msg));
        }
        emitPolyline(pts.map(([x, y]) => T(x, y)), layer, ent.line);
        break;
      }
      case 'POLYLINE': {
        // vecchio stile: i VERTEX sono entità separate già raccolte in sequenza
        entityCount++;
        break; // gestita da fuori (vedi expandEntities)
      }
      case 'INSERT': {
        entityCount++;
        const name = str(ent.data, 2);
        const block = blocks.get(name);
        if (!block) { warn(ent.line, `INSERT: blocco "${name}" non trovato`); break; }
        if (depth >= MAX_INSERT_DEPTH) { warn(ent.line, 'INSERT: profondità blocchi eccessiva', true); break; }
        const ix = val(ent.data, 10, 0), iy = val(ent.data, 20, 0);
        const sxv = val(ent.data, 41, 1), syv = val(ent.data, 42, 1);
        const rot = ((val(ent.data, 50, 0) || 0) * Math.PI) / 180;
        const cosr = Math.cos(rot), sinr = Math.sin(rot);
        let mLocal = mul(m, [cosr, sinr, -sinr, cosr, ix, iy]);
        mLocal = mul(mLocal, [sxv, 0, 0, syv, 0, 0]);
        mLocal = mul(mLocal, [1, 0, 0, 1, -block.baseX, -block.baseY]);
        expandEntities(block.entities, mLocal, depth + 1);
        break;
      }
      case 'VERTEX':
      case 'SEQEND':
        break; // consumati dal gestore POLYLINE
      default:
        warn(ent.line, `Entità DXF "${ent.type}" non supportata (ignorata)`, true);
    }
  }

  function expandEntities(list, m, depth) {
    for (let i = 0; i < list.length; i++) {
      const ent = list[i];
      if (ent.type === 'POLYLINE') {
        // raccogli i VERTEX fino a SEQEND
        const closed = (val(ent.data, 70, 0) & 1) === 1;
        const verts = [];
        let j = i + 1;
        for (; j < list.length && list[j].type === 'VERTEX'; j++) {
          verts.push({
            x: val(list[j].data, 10, 0),
            y: val(list[j].data, 20, 0),
            bulge: val(list[j].data, 42, 0) || 0,
          });
        }
        emitPolyline(bulgePolyline(verts, closed).map(([x, y]) => apply(m, x, y)),
          str(ent.data, 8, '0'), ent.line);
        entityCount++;
        i = j;
        if (i < list.length && list[i].type === 'SEQEND') { /* consume */ }
        continue;
      }
      emitEntity(ent, m, depth);
    }
  }

  expandEntities(topEntities, IDENT, 0);

  if (entityCount === 0) {
    warn(1, 'Nessuna entità geometrica trovata nella sezione ENTITIES');
  }

  // ---------- statistiche ----------
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
    rawLines,
    meta: { dialect: 'DXF', unitScale },
    toolNames,
    bounds: all.result(),
    boundsFeed: all.result(),
    stats: { feedLen, rapidLen: 0, timeMin: null, tools: toolsSeen },
  };
}
