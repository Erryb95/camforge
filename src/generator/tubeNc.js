// @ts-check
// Generatore NC per taglio laser tubo (dialetto Cutlite/.cn), a partire dalle
// feature estratte dal B-rep (sezione, fori, tagli di testa).
//
// Mapping ricavato dalle coppie STEP↔NC (docs/REVERSE_ENGINEERING.md):
//   X_NC = −X_STEP − trim      (barra lavorata dall'estremità libera)
//   Y,Z  = coordinate di sezione 1:1
//   C    = atan2(normale_Y, normale_Z) in gradi  (angolo della normale esterna)
//   EI/EJ/EK = normale esterna nel punto (EI=0 sui tagli radiali)
// La struttura di ogni operazione: setup G510/G650/G806 → posizionamento
// G180/G1000/G2310 → attacco G800/G10 → contorno G832/G1…/G834 (;M821 lead-in,
// ;M831 lead-out) → il taglio termina e parte l'operazione successiva.

const f3 = (v) => (Math.abs(v) < 5e-4 ? '0' : (+v.toFixed(3)).toString());
const f5 = (v) => v.toFixed(5);
const norm360 = (deg) => ((deg % 360) + 360) % 360;

/**
 * Outline della sezione (rett w×h con spigoli raccordati r), nel piano Y-Z,
 * partenza dal centro della faccia superiore (Z=+h/2) verso +Y, senso orario.
 * @returns {{y:number,z:number,ny:number,nz:number}[]}
 */
export function sectionPath(w, h, r, arcSteps = 6) {
  const a = w / 2, b = h / 2;
  const pts = [];
  // segmenti: [faccia dritta] poi [arco spigolo]. 4 lati.
  // definizione lati (dal centro faccia sup, orario): top(+Z)→right(+Y)→bottom(-Z)→left(-Y)
  const push = (y, z, ny, nz) => pts.push({ y, z, ny, nz });
  const arc = (cy, cz, a0, a1) => {
    for (let i = 0; i <= arcSteps; i++) {
      const t = a0 + (a1 - a0) * (i / arcSteps);
      push(cy + r * Math.cos(t), cz + r * Math.sin(t), Math.cos(t), Math.sin(t));
    }
  };
  // top face da y=0 a y=a-r (normale +Z)
  push(0, b, 0, 1);
  push(a - r, b, 0, 1);
  arc(a - r, b - r, Math.PI / 2, 0);              // spigolo TR: normale +Z→+Y
  push(a, -(b - r), 1, 0);                          // faccia destra (normale +Y)
  arc(a - r, -(b - r), 0, -Math.PI / 2);          // spigolo BR: +Y→-Z
  push(-(a - r), -b, 0, -1);                        // faccia inferiore (normale -Z)
  arc(-(a - r), -(b - r), -Math.PI / 2, -Math.PI); // spigolo BL: -Z→-Y
  push(-a, b - r, -1, 0);                           // faccia sinistra (normale -Y)
  arc(-(a - r), b - r, Math.PI, Math.PI / 2);      // spigolo TL: -Y→+Z
  push(0, b, 0, 1);                                 // ritorno al centro faccia sup
  return pts;
}

/** Un blocco operazione (setup + contorno). @param {string[]} out */
function emitOp(out, n, label, xCut, points, feedVar = 'feed1') {
  out.push(`N${n}`);
  out.push(`;${label}`);
  out.push(`G510 A1 V-2200 W330 M2 L${f3(xCut)} P0`);
  out.push('G650 T3 W1');
  out.push('G806 A11 T3 N1 H1 D1 E1 S(workpiece_safe_dist)');
  out.push('G153 G0 Z(optimized_lift)');
  const p0 = points[0];
  out.push(`G180 X${f3(xCut)} Y${f3(p0.y)} Z${f3(p0.z)} B0 C${f3(p0.c)}`);
  out.push('G1000 G0 X(kine_x) Y(kine_y) B(kine_b) C(kine_c) U(0)');
  out.push(`G2310 X${f3(xCut)}`);
  out.push(`G2312 X${f3(xCut)}`);
  out.push(`G800 D1 G10 X${f3(xCut)} Y${f3(p0.y)} Z${f3(p0.z)} H0 C${f3(p0.c)} U0 V0 W1 F(${feedVar}) T1 P1 R1`);
  out.push('G832');
  out.push(';M821');
  out.push('G834 W4');
  out.push(`F(${feedVar})`);
  for (const p of points) {
    out.push(`G1 X${f3(p.x)} Y${f3(p.y)} Z${f3(p.z)} C${f3(p.c)} B0 EI0.00000 EJ${f5(p.ej)} EK${f5(p.ek)}`);
  }
  out.push(';M831');
  out.push('G840');
}

/**
 * Genera il programma NC tubo dalle feature.
 * @param {{
 *   sectionW:number, sectionH:number, cornerR:number, length:number,
 *   holes:{xStep:number, yStep:number, r:number, faceZ:number}[]
 * }} feat
 * @param {{trim?:number, barLength?:number, arcSteps?:number}} [setup]
 */
export function generateTubeNc(feat, setup = {}) {
  const trim = setup.trim ?? 4.95;
  const bar = setup.barLength ?? 6000;
  const W = feat.sectionW, H = feat.sectionH, R = feat.cornerR;
  const xOf = (xStep) => -xStep - trim;               // mapping asse

  /** @type {string[]} */
  const out = [];
  out.push('% .cn');
  out.push(`G2292 Y${f3(-H / 2)} V${f3(H / 2)} Z${f3(-W / 2)} W${f3(W / 2)} I3 X0 U-${bar}`);
  out.push('G168', '', '?%LsIso0 = 35', 'M1000', 'JMPF(start_track)', 'N0', '');

  let n = 1;
  const outline = sectionPath(W, H, R, setup.arcSteps ?? 6);

  // N1: taglio di testa anteriore (perimetro sezione a X = -trim)
  const front = outline.map((p) => ({
    x: xOf(0), y: p.y, z: p.z,
    c: norm360(Math.atan2(p.ny, p.nz) * 180 / Math.PI), ej: p.ny, ek: p.nz,
  }));
  emitOp(out, n++, 'W_T_Master_J2_B2', xOf(0), front);

  // fori (cerchi sulla faccia superiore, C=0)
  for (const h of feat.holes) {
    const cx = xOf(h.xStep), cy = h.yStep, z = H / 2;
    const N = 48;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const t = (2 * Math.PI * i) / N;
      pts.push({ x: cx + h.r * Math.cos(t), y: cy + h.r * Math.sin(t), z, c: 0, ej: 0, ek: 1 });
    }
    emitOp(out, n++, 'W_T_Hole_B2', cx, pts);
  }

  // N ultimo: taglio di testa posteriore (perimetro sezione a X = -(length+trim))
  const back = outline.map((p) => ({
    x: xOf(feat.length), y: p.y, z: p.z,
    c: norm360(Math.atan2(p.ny, p.nz) * 180 / Math.PI), ej: p.ny, ek: p.nz,
  }));
  emitOp(out, n++, 'W_T_Master_J_B2', xOf(feat.length), back);

  out.push('M30', '');
  return out.join('\n');
}
