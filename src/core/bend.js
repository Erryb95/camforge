// @ts-check
// PIEGATURA (bend) — matematica di sviluppo (flat-pattern) per LAMIERA e TUBO.
// Generalizza l'idea del nostro svolto (unroll.js): sostituire l'arco di piega con
// la sua ascissa curvilinea sull'asse neutro. Zero-dipendenze, JS puro.
//
// Riferimenti REALI portati (vendor/reference/bend/):
//  - LAMIERA: FreeCAD SheetMetal `calc-unfold.py` (LGPL) — bend allowance, OSSB,
//    flange. Golden verificato: r=1.64,T=2,K=0.38,ML=50,90° → BA=3.77, flangia 51.76.
//  - TUBO: Tetrees/xyz-lra-converter `convertX2L.py` — LRA (Length-Rotation-Angle,
//    = YBC) ↔ centerline XYZ, con correzione tangente CLR·tan(A/2).

const D2R = Math.PI / 180;

// ---------- LAMIERA (press brake) ----------

/** Bend allowance: arco dell'asse neutro. r=raggio interno, T=spessore, K=k-factor. */
export function bendAllowance(angleDeg, r, T, K) {
  return 2 * Math.PI * (r + K * T) * (angleDeg / 360);
}

/** Outside setback (generale): SB = (r+T)·tan(angolo/2). A 90° = r+T. */
export function setback(angleDeg, r, T) {
  return (r + T) * Math.tan(angleDeg * D2R / 2);
}

/** Bend deduction: BD = 2·SB − BA (quanto togliere alle quote mould-line). */
export function bendDeduction(angleDeg, r, T, K) {
  return 2 * setback(angleDeg, r, T) - bendAllowance(angleDeg, r, T, K);
}

/**
 * Sviluppo di UNA piega, convenzione FreeCAD calc-unfold.py (OSSB = r+T).
 * @param {{r:number,T:number,K:number,ML:number,angleDeg:number}} p  ML=mould-line distance
 */
export function unfoldSingleBend({ r, T, K, ML, angleDeg }) {
  const BA = bendAllowance(angleDeg, r, T, K);
  const ossb = r + T;                       // outside setback (calc-unfold usa r+T)
  const legLength = ML - BA / 2;
  return { BA, ossb, outerRadius: r + T, legLength, flangeLength: ossb + legLength, flangeDiff: ossb - BA / 2 };
}

/**
 * Lunghezza sviluppata di una catena di pieghe.
 * @param {number[]} moldLines  lunghezze dei tratti misurati agli spigoli (mould-line)
 * @param {{angleDeg:number,r:number,T:number,K:number}[]} bends
 * @returns {number} L_flat = Σ mould-line − Σ bend-deduction
 */
export function developedLength(moldLines, bends) {
  const sumML = moldLines.reduce((a, b) => a + b, 0);
  const sumBD = bends.reduce((a, b) => a + bendDeduction(b.angleDeg, b.r, b.T, b.K), 0);
  return sumML - sumBD;
}

// ---------- TUBO (piegatubi CNC): LRA ↔ centerline XYZ ----------
// LRA = [Length, Rotation, Angle] per piega. clr = center-line radius.

const mul3 = (A, B) => A.map((row, i) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
const mv3 = (M, v) => M.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
const eye3 = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function angleVecDeg(a, b) {
  const c = dot(a, b) / (norm(a) * norm(b) || 1);
  return Math.acos(Math.max(-1, Math.min(1, c))) / D2R;
}

/** Rx(B)ᵀ · Ry(C)ᵀ (B=rotazione piano, C=angolo piega, gradi) — port di getRotMatrix. */
function rotMatrix(Bdeg, Cdeg) {
  const Br = Bdeg * D2R, Cr = Cdeg * D2R;
  const cB = Math.cos(Br), sB = Math.sin(Br), cC = Math.cos(Cr), sC = Math.sin(Cr);
  const RxT = [[1, 0, 0], [0, cB, -sB], [0, sB, cB]];   // Rx(B)ᵀ
  const RyT = [[cC, 0, sC], [0, 1, 0], [-sC, 0, cC]];   // Ry(C)ᵀ
  return mul3(RxT, RyT);
}

/**
 * LRA → centerline XYZ (port di convertX2L.lra2xyz).
 * @param {[number,number,number][]} lra  [[L,R,A], …]
 * @param {number} clr  center-line radius
 * @returns {[number,number,number][]} punti della centerline (n+1 punti)
 */
export function lra2xyz(lra, clr) {
  let B = 0, C = 0, dxStart = 0, rotM = eye3();
  const xyz = [[0, 0, 0]];
  for (let i = 0; i < lra.length; i++) {
    rotM = mul3(rotM, rotMatrix(B, C));
    const A = lra[i][2];
    const dxEnd = clr * Math.tan(A * Math.PI / 360);
    const straight = dxStart + dxEnd + lra[i][0];
    dxStart = dxEnd;
    const p = mv3(rotM, [straight, 0, 0]);
    xyz.push([xyz[i][0] + p[0], xyz[i][1] + p[1], xyz[i][2] + p[2]]);
    B = lra[i][1]; C = lra[i][2];
  }
  return /** @type {[number,number,number][]} */ (xyz);
}

/**
 * centerline XYZ → LRA (port di convertX2L.xyz2lra).
 * @param {[number,number,number][]} xyz
 * @param {number} clr
 * @returns {[number,number,number][]} [[L,R,A], …]
 */
export function xyz2lra(xyz, clr) {
  const lra = [];
  let dxStart = 0, R = 0;
  for (let i = 0; i < xyz.length - 2; i++) {
    const v1 = sub(xyz[i + 1], xyz[i]);
    const v2 = sub(xyz[i + 2], xyz[i + 1]);
    const A = angleVecDeg(v1, v2);
    if (i > 0) {
      const v0 = sub(xyz[i], xyz[i - 1]);
      R = angleVecDeg(cross(v0, v1), cross(v1, v2));
    }
    const dxEnd = clr * Math.tan(A * Math.PI / 360);
    const L = norm(v1) - dxStart - dxEnd;
    dxStart = dxEnd;
    lra.push([L, R, A]);
  }
  return /** @type {[number,number,number][]} */ (lra);
}

/** Lunghezza sviluppata (barra dritta) del tubo: Σ tratti dritti + Σ archi di piega. */
export function tubeDevelopedLength(lra, clr) {
  let dev = 0, dxStart = 0;
  for (const [L, , A] of lra) {
    const dxEnd = clr * Math.tan(A * Math.PI / 360);
    dev += dxStart + dxEnd + L + clr * A * D2R;   // tratto dritto (tangente-a-tangente) + arco
    dxStart = dxEnd;
  }
  return dev;
}
