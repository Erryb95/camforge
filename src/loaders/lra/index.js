// @ts-check
// Loader PIEGATUBO — programma bender LRA/YBC oppure centerline XYZ.
//  · LRA/YBC: una riga per piega  L R A  (Length · Rotation piano · Angle piega).
//  · XYZ:     una riga per nodo   x y z  (centerline del tubo, es. export CAD/misura).
// Ricostruisce la centerline 3D + la mesh del tubo piegato + info per il fold.
import { registerLoader } from '../../core/registry.js';
import { newBounds } from '../../core/model.js';
import { lra2xyz } from '../../core/bend.js';
import { foldMeshFromCenterline } from '../../sim/tubebend.js';

function metaNum(line, keys) {
  for (const k of keys) {
    const m = line.match(new RegExp('\\b' + k + '\\b[^0-9-]*(-?[\\d.]+)', 'i'));
    if (m) return parseFloat(m[1]);
  }
  return null;
}
const V = { sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], len: (v) => Math.hypot(v[0], v[1], v[2]) };
const polyLen = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += V.len(V.sub(pts[i], pts[i - 1])); return L; };

export function parseLRA(text, fileName = '') {
  const rawLines = String(text).split(/\r?\n/);
  /** @type {number[][]} */
  const rows = [];
  const warnings = [];
  let od = 0, clr = 0, wt = 0;

  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (!line) continue;
    const vOD = metaNum(line, ['OD', 'diameter', 'dia']); if (vOD != null && !od) od = vOD;
    const vCLR = metaNum(line, ['CLR', 'radius', 'bendradius']); if (vCLR != null && !clr) clr = vCLR;
    const vWT = metaNum(line, ['WT', 'wall', 'thickness']); if (vWT != null && !wt) wt = vWT;
    if (/^[;#(*'/]/.test(line)) continue;                                          // commento
    const toks = line.split(/[\s,;]+/).filter(Boolean);
    if (toks.some((t) => /[a-zA-Z]/.test(t.replace(/[eE][-+]?\d+$/, '')))) continue; // header/testo
    const nums = toks.map(Number);
    if (nums.length >= 3 && nums.slice(0, 3).every(Number.isFinite)) rows.push(nums.slice(0, 3));
  }
  if (!od) od = 30;
  if (!clr) clr = 2.5 * od;
  if (!wt) wt = Math.max(1, od * 0.08);

  // Rileva XYZ vs LRA: XYZ se la 1ª riga è l'origine o se col2/col3 (che in LRA sono
  // gradi ≤360) superano 360 → sono coordinate.
  let isXYZ = false;
  if (rows.length >= 3) {
    const firstZero = rows[0].every((v) => Math.abs(v) < 1e-6);
    const maxDeg = Math.max(...rows.map((r) => Math.max(Math.abs(r[1]), Math.abs(r[2]))));
    isXYZ = firstZero || maxDeg > 360;
  }

  const bb = newBounds();
  const segments = [];
  let mesh = null, foldOk = false, centerline = [];
  if (rows.length >= 2) {
    centerline = isXYZ ? rows.map((r) => [r[0], r[1], r[2]]) : lra2xyz(rows, clr);
    const pts = centerline.map(([x, y, z]) => ({ x, y, z }));
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      bb.add(a); bb.add(b);
      segments.push({ type: 'feed', from: a, to: b, pts: [a, b], len: Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), tool: 0, feed: null, line: 0 });
    }
    try { mesh = foldMeshFromCenterline(centerline, clr, od, 1); foldOk = true; }
    catch (e) { warnings.push({ line: 0, msg: 'mesh piega non generata: ' + (e && e.message) }); }
  } else {
    warnings.push({ line: 0, msg: 'Nessun dato di piega (L R A) o nodo (x y z) riconosciuto' });
  }

  // conteggio pieghe (vertici interni con angolo > 5°) e sviluppo (lunghezza centerline)
  let nBends = 0;
  for (let i = 1; i < centerline.length - 1; i++) {
    const din = V.sub(centerline[i], centerline[i - 1]), dout = V.sub(centerline[i + 1], centerline[i]);
    const d = (din[0] * dout[0] + din[1] * dout[1] + din[2] * dout[2]) / ((V.len(din) * V.len(dout)) || 1);
    if (Math.acos(Math.max(-1, Math.min(1, d))) > 0.087) nBends++;   // >5°
  }
  const dev = polyLen(centerline);

  const feedLen = segments.reduce((a, s) => a + s.len, 0);
  return {
    name: fileName, program: null, units: /** @type {'mm'} */ ('mm'),
    segments, drillPoints: [], warnings, rawLines,
    bounds: bb.result(), boundsFeed: bb.result(),
    mesh,
    meta: { bend: { centerline, clr, od, wt, nBends, dev, format: isXYZ ? 'XYZ' : 'LRA' }, foldAvailable: foldOk, tube: true },
    stats: { feedLen, rapidLen: 0, timeMin: null, tools: [] },
  };
}

registerLoader(['lra', 'ybc', 'bnd', 'xyz'], { name: 'Piegatubo (LRA/YBC/XYZ)', parse: parseLRA });
