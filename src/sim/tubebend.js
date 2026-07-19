// @ts-check
// PIEGATURA TUBO — ricostruzione 3D dal programma LRA e animazione fold.
// Dalla centerline (lra2xyz) costruisce una centerline ARROTONDATA (archi di raggio
// CLR alle pieghe) e ci fa scorrere sopra una sezione circolare (sweep con trasporto
// parallelo, niente torsione) → mesh tubo. Il fold t∈[0,1] scala gli angoli di piega:
// t=0 barra dritta, t=1 pezzo finito. Zero-dipendenze.
import { lra2xyz } from '../core/bend.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const norm = (v) => { const l = len(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/** Rodrigues: ruota v attorno all'asse (unitario) di angolo θ. */
function rotAxis(v, axis, th) {
  const c = Math.cos(th), s = Math.sin(th);
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
}

/**
 * Centerline arrotondata: sostituisce ogni spigolo con un arco di raggio `clr`
 * tangente ai due tratti (la posizione tangente è già dove lra2xyz mette lo spigolo).
 * @param {number[][]} pts  vertici della centerline (spigoli vivi)
 * @returns {number[][]} polilinea densa con archi alle pieghe
 */
export function roundedCenterline(pts, clr, stepsPerRad = 12) {
  if (pts.length < 3) return pts.map((p) => p.slice());
  const out = [pts[0].slice()];
  for (let i = 1; i < pts.length - 1; i++) {
    const din = norm(sub(pts[i], pts[i - 1]));
    const dout = norm(sub(pts[i + 1], pts[i]));
    const A = Math.acos(Math.max(-1, Math.min(1, dot(din, dout))));   // angolo di piega
    if (A < 1e-3) { out.push(pts[i].slice()); continue; }             // dritto
    const tLen = clr * Math.tan(A / 2);
    const aStart = sub(pts[i], scale(din, tLen));                     // punto tangente in ingresso
    // centro dell'arco: perpendicolare a din verso l'interno della piega
    const n = norm(sub(dout, scale(din, dot(din, dout))));
    const center = add(aStart, scale(n, clr));
    const axis = norm(cross(din, dout));
    const v0 = sub(aStart, center);
    const steps = Math.max(2, Math.round(A * stepsPerRad));
    for (let k = 0; k <= steps; k++) out.push(add(center, rotAxis(v0, axis, (A * k) / steps)));
  }
  out.push(pts[pts.length - 1].slice());
  return out;
}

/**
 * Sweep di una sezione circolare lungo la centerline (trasporto parallelo del frame).
 * @param {number[][]} path  polilinea 3D @param {number} r raggio @param {number} sides lati
 * @returns {{positions:Float64Array, indices:Uint32Array, triTool:Uint32Array}}
 */
export function sweepTube(path, r, sides = 16) {
  const n = path.length;
  // tangenti
  const T = path.map((_, i) => {
    if (i === 0) return norm(sub(path[1], path[0]));
    if (i === n - 1) return norm(sub(path[n - 1], path[n - 2]));
    return norm(sub(path[i + 1], path[i - 1]));
  });
  // frame iniziale: u ⟂ T[0]
  let u = norm(cross(T[0], Math.abs(T[0][2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  const pos = [];
  const rings = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) {                                   // trasporto parallelo: ruota u da T[i-1] a T[i]
      const ax = cross(T[i - 1], T[i]); const s = len(ax);
      if (s > 1e-6) { const a = Math.asin(Math.min(1, s)); u = norm(rotAxis(u, scale(ax, 1 / s), a)); }
      u = norm(sub(u, scale(T[i], dot(u, T[i]))));  // ri-ortogonalizza
    }
    const v = cross(T[i], u);
    const ring = [];
    for (let j = 0; j < sides; j++) {
      const th = (2 * Math.PI * j) / sides;
      const p = add(path[i], add(scale(u, r * Math.cos(th)), scale(v, r * Math.sin(th))));
      ring.push(pos.length / 3); pos.push(p[0], p[1], p[2]);
    }
    rings.push(ring);
  }
  const tri = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const a = rings[i][j], b = rings[i][(j + 1) % sides], c = rings[i + 1][(j + 1) % sides], d = rings[i + 1][j];
      tri.push(a, b, c, a, c, d);
    }
  }
  // tappi
  const cap = (ring, p, flip) => {
    const ci = pos.length / 3; pos.push(p[0], p[1], p[2]);
    for (let j = 0; j < sides; j++) {
      const a = ring[j], b = ring[(j + 1) % sides];
      if (flip) tri.push(ci, b, a); else tri.push(ci, a, b);
    }
  };
  cap(rings[0], path[0], true);
  cap(rings[n - 1], path[n - 1], false);
  return { positions: new Float64Array(pos), indices: new Uint32Array(tri), triTool: new Uint32Array(tri.length / 3) };
}

/**
 * Piega una centerline (spigoli vivi) alla frazione `t`: riduce ogni angolo di piega
 * ad A·t mantenendo le lunghezze dei tratti. t=0 barra dritta, t=1 = centerline originale.
 * Funziona sia per LRA (lra2xyz) sia per XYZ importata; preserva TUTTE le pieghe.
 * @param {number[][]} pts @param {number} t
 */
export function foldCenterline(pts, t) {
  if (pts.length < 3) return pts.map((p) => p.slice());
  t = Math.max(0, Math.min(1, t));
  const out = [pts[0].slice()];
  let dir = norm(sub(pts[1], pts[0]));
  for (let i = 1; i < pts.length; i++) {
    const segLen = len(sub(pts[i], pts[i - 1]));
    out.push(add(out[i - 1], scale(dir, segLen)));
    if (i < pts.length - 1) {
      const din = norm(sub(pts[i], pts[i - 1]));
      const dout = norm(sub(pts[i + 1], pts[i]));
      const A = Math.acos(Math.max(-1, Math.min(1, dot(din, dout))));   // angolo di piega al vertice i
      if (A > 1e-6) dir = norm(rotAxis(dir, norm(cross(din, dout)), A * t));
    }
  }
  return out;
}

/** Mesh del tubo da una CENTERLINE a frazione di piega `t` (0=dritto, 1=finito). */
export function foldMeshFromCenterline(centerline, clr, od, t) {
  return sweepTube(roundedCenterline(foldCenterline(centerline, t), clr), od / 2, 18);
}

/**
 * Mesh del tubo a frazione di piega `t` da programma LRA (comodo per i test).
 * @param {number[][]} lra @param {number} clr @param {number} od @param {number} t
 */
export function foldMeshAt(lra, clr, od, t) {
  return foldMeshFromCenterline(lra2xyz(lra, clr), clr, od, t);
}
