// @ts-check
// Geometria CAD condivisa (pura, senza stato) usata dai loader DXF e DWG:
// tessellazione di archi, bulge, ellissi, B-spline (de Boor) e matrici 2D
// per i blocchi INSERT. Nessuna dipendenza dal formato file.

export const ARC_STEP = Math.PI / 90;   // ~2° per passo di tessellazione

// ---- matrici affini 2D  [a,b,c,d,e,f]: x' = a·x + c·y + e ; y' = b·x + d·y + f
export const IDENT = [1, 0, 0, 1, 0, 0];
export const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
export const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/**
 * Punti di un arco (coordinate locali). @returns {number[][]}
 * @param {number} cx @param {number} cy @param {number} r
 * @param {number} a0 angolo iniziale (rad) @param {number} sweep angolo spazzato (rad, con segno)
 */
export function arcPoints(cx, cy, r, a0, sweep) {
  const steps = Math.max(2, Math.min(720, Math.ceil(Math.abs(sweep) / ARC_STEP)));
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (sweep * i) / steps;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/**
 * Espande una polilinea con "bulge" (archi tra vertici, formato DXF/DWG).
 * @param {{x:number,y:number,bulge:number}[]} verts
 * @param {boolean} closed
 * @returns {number[][]}
 */
export function bulgePolyline(verts, closed) {
  /** @type {number[][]} */
  const out = [];
  const n = verts.length;
  if (!n) return out;
  out.push([verts[0].x, verts[0].y]);
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    if (!a.bulge) { out.push([b.x, b.y]); continue; }
    const theta = 4 * Math.atan(a.bulge);
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-12) continue;
    const r = d / (2 * Math.sin(Math.abs(theta) / 2));
    const phi = Math.atan2(dy, dx);
    const cAng = phi + (Math.PI / 2) * Math.sign(theta) - theta / 2;
    const cx = a.x + r * Math.cos(cAng);
    const cy = a.y + r * Math.sin(cAng);
    const a0 = Math.atan2(a.y - cy, a.x - cx);
    const pts = arcPoints(cx, cy, r, a0, theta);
    for (let k = 1; k < pts.length; k++) out.push(pts[k]);
    out[out.length - 1] = [b.x, b.y];   // chiudi esatto
  }
  return out;
}

/**
 * Punti di un'ellisse/arco ellittico.
 * @param {number} cx @param {number} cy       centro
 * @param {number} mx @param {number} my       vettore semiasse maggiore (da centro)
 * @param {number} ratio                         rapporto semiasse minore/maggiore
 * @param {number} p0 @param {number} p1        angoli parametrici iniziale/finale (rad)
 * @returns {number[][]}
 */
export function ellipsePoints(cx, cy, mx, my, ratio, p0, p1) {
  const nx = -my * ratio, ny = mx * ratio;   // vettore semiasse minore
  const span = p1 > p0 ? p1 - p0 : p1 + Math.PI * 2 - p0;
  const steps = Math.max(8, Math.min(360, Math.ceil(Math.abs(span) / ARC_STEP)));
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = p0 + (span * i) / steps;
    out.push([cx + mx * Math.cos(t) + nx * Math.sin(t),
              cy + my * Math.cos(t) + ny * Math.sin(t)]);
  }
  return out;
}

/**
 * Valuta una B-spline con l'algoritmo di de Boor.
 * @param {number[][]} ctrl punti di controllo [[x,y],...]
 * @param {number[]} knots
 * @param {number} degree
 * @param {(msg:string)=>void} [onWarn]
 * @returns {number[][]}
 */
export function splinePoints(ctrl, knots, degree, onWarn) {
  if (ctrl.length < 2) return ctrl.map((p) => [p[0], p[1]]);
  if (!knots || knots.length !== ctrl.length + degree + 1) {
    if (onWarn) onWarn('SPLINE: nodi incoerenti, approssimata con il poligono di controllo');
    return ctrl.map((p) => [p[0], p[1]]);
  }
  const nSamp = Math.min(600, Math.max(32, ctrl.length * 8));
  const t0 = knots[degree];
  const t1 = knots[knots.length - 1 - degree];
  const out = [];
  for (let s = 0; s <= nSamp; s++) {
    const t = t0 + ((t1 - t0) * s) / nSamp;
    let k = degree;
    for (let j = degree; j < knots.length - 1 - degree; j++) {
      if (t >= knots[j] && t <= knots[j + 1]) { k = j; break; }
    }
    const d = [];
    for (let j = 0; j <= degree; j++) d[j] = [...ctrl[k - degree + j]];
    for (let r = 1; r <= degree; r++) {
      for (let j = degree; j >= r; j--) {
        const i2 = k - degree + j;
        const den = knots[i2 + degree - r + 1] - knots[i2];
        const alpha = den < 1e-12 ? 0 : (t - knots[i2]) / den;
        d[j][0] = (1 - alpha) * d[j - 1][0] + alpha * d[j][0];
        d[j][1] = (1 - alpha) * d[j - 1][1] + alpha * d[j][1];
      }
    }
    out.push([d[degree][0], d[degree][1]]);
  }
  return out;
}
