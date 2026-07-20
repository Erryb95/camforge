// @ts-check
// Loader SVG (2D) zero-dipendenze → SceneModel, come il DXF. Parser REGEX-based
// (niente DOMParser: gira anche in Node per i test). Supporta: <path> (M/L/H/V/
// C/S/Q/T/A/Z, assoluti e relativi), <rect> (con rx/ry), <circle>, <ellipse>,
// <line>, <polyline>, <polygon>. L'asse Y dell'SVG punta in BASSO → viene ribaltato
// (y' = maxY − y) così il disegno è orientato come nel CAD. Emette segmenti a 2 punti
// per lato ⇒ contoursFromModel li incatena in contorni chiusi (come il DXF).

import { newBounds, dist3 } from '../../core/model.js';

const TESS = 24;                        // passi di tessellazione per bezier/arco
const UNIT_MM = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 1 };

const numsOf = (s) => (s.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || []).map(Number);
const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag);
  return m ? m[1] : null;
};
const attrNum = (tag, name, def = 0) => { const v = attr(tag, name); const n = v == null ? NaN : parseFloat(v); return Number.isFinite(n) ? n : def; };

// --- bezier / arco → punti ---
function cubic(p0, p1, p2, p3, out) {
  for (let i = 1; i <= TESS; i++) {
    const t = i / TESS, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
}
function quad(p0, p1, p2, out) {
  for (let i = 1; i <= TESS; i++) {
    const t = i / TESS, u = 1 - t;
    out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
  }
}
// arco ellittico SVG (endpoint→centro, da SVG impl. notes) → punti
function svgArc(p0, rx, ry, xrotDeg, large, sweep, p1, out) {
  if (rx === 0 || ry === 0) { out.push(p1); return; }
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = xrotDeg * Math.PI / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2;
  const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
  let lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const sign = large !== sweep ? 1 : -1;
  let num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  num = Math.max(0, num);
  const co = sign * Math.sqrt(num / (rx * rx * y1p * y1p + ry * ry * x1p * x1p) || 0);
  const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
  const cx = cp * cxp - sp * cyp + (p0[0] + p1[0]) / 2, cy = sp * cxp + cp * cyp + (p0[1] + p1[1]) / 2;
  const ang = (ux, uy, vx, vy) => {
    const d = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy)) || 1;
    let a = Math.acos(Math.min(1, Math.max(-1, (ux * vx + uy * vy) / d)));
    if (ux * vy - uy * vx < 0) a = -a; return a;
  };
  const th0 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dth > 0) dth -= 2 * Math.PI;
  if (sweep && dth < 0) dth += 2 * Math.PI;
  const steps = Math.max(2, Math.ceil(Math.abs(dth) / (Math.PI / 12)));
  for (let i = 1; i <= steps; i++) {
    const th = th0 + dth * (i / steps);
    const ex = Math.cos(th) * rx, ey = Math.sin(th) * ry;
    out.push([cp * ex - sp * ey + cx, sp * ex + cp * ey + cy]);
  }
}

/** Parsa l'attributo `d` di un <path> in una lista di subpath [{pts:[[x,y]], closed}]. */
export function pathToPolylines(d) {
  const toks = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || [];
  const subs = [];
  let cur = null, cx = 0, cy = 0, sx = 0, sy = 0, pc = null, pcType = '', cmd = '', i = 0;
  const num = () => parseFloat(toks[i++]);
  // flag arco (0/1): può essere compattato senza separatore (es. SVGO "0110") ⇒ leggi UNA cifra
  const flag = () => {
    const t = toks[i];
    if (t === '0' || t === '1') { i++; return +t; }
    if (typeof t === 'string' && (t[0] === '0' || t[0] === '1')) { toks[i] = t.slice(1); return +t[0]; }
    return +num();
  };
  const start = () => { cur = { pts: [], closed: false }; subs.push(cur); };
  while (i < toks.length) {
    const t = toks[i];
    if (/[A-Za-z]/.test(t)) { cmd = t; i++; } // nuovo comando
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'M') {
      const x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0);
      cx = x; cy = y; sx = x; sy = y; start(); cur.pts.push([x, y]); pc = null; cmd = rel ? 'l' : 'L';
    } else if (C === 'L') {
      const x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0); cx = x; cy = y; cur.pts.push([x, y]); pc = null;
    } else if (C === 'H') { const x = num() + (rel ? cx : 0); cx = x; cur.pts.push([x, cy]); pc = null;
    } else if (C === 'V') { const y = num() + (rel ? cy : 0); cy = y; cur.pts.push([cx, y]); pc = null;
    } else if (C === 'C' || C === 'S') {
      let x1, y1;
      // S riflette il controllo SOLO se il comando precedente era C/S (spec SVG)
      if (C === 'C') { x1 = num() + (rel ? cx : 0); y1 = num() + (rel ? cy : 0); }
      else { const rf = pc && pcType === 'C'; x1 = rf ? 2 * cx - pc[0] : cx; y1 = rf ? 2 * cy - pc[1] : cy; }
      const x2 = num() + (rel ? cx : 0), y2 = num() + (rel ? cy : 0);
      const x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0);
      cubic([cx, cy], [x1, y1], [x2, y2], [x, y], cur.pts); pc = [x2, y2]; pcType = 'C'; cx = x; cy = y;
    } else if (C === 'Q' || C === 'T') {
      let x1, y1;
      // T riflette il controllo SOLO se il comando precedente era Q/T (spec SVG)
      if (C === 'Q') { x1 = num() + (rel ? cx : 0); y1 = num() + (rel ? cy : 0); }
      else { const rf = pc && pcType === 'Q'; x1 = rf ? 2 * cx - pc[0] : cx; y1 = rf ? 2 * cy - pc[1] : cy; }
      const x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0);
      quad([cx, cy], [x1, y1], [x, y], cur.pts); pc = [x1, y1]; pcType = 'Q'; cx = x; cy = y;
    } else if (C === 'A') {
      const rx = num(), ry = num(), rot = num(), large = flag(), sweep = flag();   // flag = una cifra 0/1
      const x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0);
      svgArc([cx, cy], rx, ry, rot, large, sweep, [x, y], cur.pts); cx = x; cy = y; pc = null; pcType = '';
    } else if (C === 'Z') {
      if (cur) { cur.closed = true; cur.pts.push([sx, sy]); } cx = sx; cy = sy; pc = null; cmd = '';
      // Z non consuma numeri (il letter è già stato consumato); azzera cmd per evitare loop
    } else { i++; }  // comando ignoto: avanza
  }
  return subs.filter((s) => s.pts.length > 1);
}

// --- forme di base → polilinee ---
function circlePts(cx, cy, r) { const p = []; for (let i = 0; i <= 48; i++) { const a = 2 * Math.PI * i / 48; p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return p; }
function ellipsePts(cx, cy, rx, ry) { const p = []; for (let i = 0; i <= 64; i++) { const a = 2 * Math.PI * i / 64; p.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); } return p; }
function rectPts(x, y, w, h, rx, ry) {
  if (!rx && !ry) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
  rx = rx || ry; ry = ry || rx; rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
  const p = [];
  const corner = (cx, cy, a0) => { for (let i = 0; i <= 8; i++) { const a = a0 + (Math.PI / 2) * i / 8; p.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); } };
  corner(x + w - rx, y + ry, -Math.PI / 2); corner(x + w - rx, y + h - ry, 0);
  corner(x + rx, y + h - ry, Math.PI / 2); corner(x + rx, y + ry, Math.PI);
  p.push([...p[0]]); return p;
}

/**
 * @param {string} text @param {string} [fileName]
 * @returns {import('../../core/model.js').SceneModel}
 */
export function parseSVG(text, fileName = '') {
  const rawLines = text.split(/\r\n|\r|\n/);
  const svgTag = /<svg\b[^>]*>/i.exec(text);
  const st = svgTag ? svgTag[0] : '';
  const vb = attr(st, 'viewBox');
  const viewBox = vb ? numsOf(vb) : null;   // [minx,miny,w,h]
  // scala user-unit → mm (solo se width ha unità fisiche + viewBox)
  let scale = 1;
  const wAttr = attr(st, 'width');
  const wm = wAttr && /([a-z%]+)\s*$/i.exec(wAttr);
  const wUnit = wm ? wm[1].toLowerCase() : '';
  if (viewBox && viewBox[2] > 0 && (wUnit === 'mm' || wUnit === 'cm' || wUnit === 'in')) {
    scale = (parseFloat(wAttr) * (UNIT_MM[wUnit] || 1)) / viewBox[2];
  }

  /** @type {[number,number][][]} */
  const polylines = [];
  const lineOf = (idx) => { let n = 0; for (let k = 0; k <= idx && k < text.length; k++) if (text[k] === '\n') n++; return n + 1; };
  /** @type {{poly:[number,number][], line:number}[]} */
  const items = [];
  const push = (pts, at) => { if (pts && pts.length > 1) items.push({ poly: pts, line: lineOf(at) }); };

  let m;
  const reTag = /<(path|rect|circle|ellipse|line|polyline|polygon)\b([^>]*)>/gi;
  while ((m = reTag.exec(text))) {
    const [tag, kind, body] = [m[0], m[1].toLowerCase(), m[2]];
    const at = m.index;
    if (kind === 'path') { const d = attr(tag, 'd'); if (d) for (const s of pathToPolylines(d)) push(s.pts, at); }
    else if (kind === 'rect') push(rectPts(attrNum(tag, 'x'), attrNum(tag, 'y'), attrNum(tag, 'width'), attrNum(tag, 'height'), attrNum(tag, 'rx'), attrNum(tag, 'ry')), at);
    else if (kind === 'circle') push(circlePts(attrNum(tag, 'cx'), attrNum(tag, 'cy'), attrNum(tag, 'r')), at);
    else if (kind === 'ellipse') push(ellipsePts(attrNum(tag, 'cx'), attrNum(tag, 'cy'), attrNum(tag, 'rx'), attrNum(tag, 'ry')), at);
    else if (kind === 'line') push([[attrNum(tag, 'x1'), attrNum(tag, 'y1')], [attrNum(tag, 'x2'), attrNum(tag, 'y2')]], at);
    else if (kind === 'polyline' || kind === 'polygon') {
      const n = numsOf(attr(tag, 'points') || ''); const p = [];
      for (let k = 0; k + 1 < n.length; k += 2) p.push([n[k], n[k + 1]]);
      if (kind === 'polygon' && p.length) p.push([...p[0]]);
      push(p, at);
    }
  }

  // ribalta Y (SVG y-down → CAD y-up) attorno al maxY, e applica la scala
  let maxY = -Infinity;
  for (const it of items) for (const p of it.poly) if (p[1] > maxY) maxY = p[1];
  if (!isFinite(maxY)) maxY = 0;

  /** @type {import('../../core/model.js').Segment[]} */
  const segments = [];
  for (const it of items) {
    const pts = it.poly.map(([x, y]) => [x * scale, (maxY - y) * scale]);
    for (let i = 1; i < pts.length; i++) {
      const from = { x: pts[i - 1][0], y: pts[i - 1][1], z: 0 };
      const to = { x: pts[i][0], y: pts[i][1], z: 0 };
      if (!isFinite(from.x) || !isFinite(from.y) || !isFinite(to.x) || !isFinite(to.y)) continue;
      const len = dist3(from, to);
      if (len < 1e-9) continue;
      segments.push({ type: 'feed', from, to, pts: [from, to], line: it.line, tool: 1, feed: null, len });
    }
  }

  const all = newBounds();
  let feedLen = 0;
  for (const s of segments) { all.add(s.from); all.add(s.to); feedLen += s.len; }
  const warnings = segments.length ? [] : [{ line: 1, msg: 'Nessuna forma SVG riconosciuta (path/rect/circle/ellipse/line/poly)' }];

  return {
    name: fileName, program: null, units: 'mm',
    segments, drillPoints: [], warnings, rawLines,
    meta: { dialect: 'SVG', unitScale: scale },
    toolNames: { 1: 'svg' },
    bounds: all.result(), boundsFeed: all.result(),
    stats: { feedLen, rapidLen: 0, timeMin: null, tools: segments.length ? [1] : [] },
  };
}
