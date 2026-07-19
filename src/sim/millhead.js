// @ts-check
// Punta/utensile di FRESATURA 3D che segue l'utensile lungo il percorso (modulo
// fresatura, stile NCSIMUL). La geometria è GENERATA (src/sim/bitgen.js) così da
// avere una fresa REALE DIVERSA per ogni materiale (n. taglienti / elica / tip),
// non un unico modello ricolorato. Asse lungo Y, punta all'estremo Y-min; qui la
// ri-orientiamo con l'asse verticale (Z), tagliente in basso sul punto utensile.

import { makeEndmill } from './bitgen.js';

let cached = /** @type {{positions:Float64Array, indices:Uint32Array, triTool:Uint32Array, tip:number[], dia:number, len:number}|null} */ (null);

/** Genera/aggiorna la punta attiva dalla specifica materiale (flutes/tip/helixDeg). */
export function setMillBit(spec = {}) { cached = makeEndmill(spec); return cached; }

/** Prepara la punta attiva (async per compatibilità coi call-site esistenti). */
export async function loadMillBit(spec) {
  return setMillBit(spec || { dia: 6, flutes: 2, tip: 'flat' });
}

// matrice (row-major 3x3) che ruota +Z=(0,0,1) sul versore `u` (Rodrigues)
function axisRot(u) {
  let ux = u[0], uy = u[1], uz = u[2];
  const L = Math.hypot(ux, uy, uz) || 1; ux /= L; uy /= L; uz /= L;
  if (uz > 0.99999) return [1, 0, 0, 0, 1, 0, 0, 0, 1];        // già verticale
  if (uz < -0.99999) return [1, 0, 0, 0, -1, 0, 0, 0, -1];     // capovolta
  const k = 1 / (1 + uz);
  return [
    uz + uy * uy * k, -ux * uy * k, ux,
    -ux * uy * k, uz + ux * ux * k, uy,
    -ux, -uy, uz,
  ];
}

/**
 * Punta col tagliente in `toolPos`, scalata a diametro `diaMm` (0 = nativa) e
 * ORIENTATA lungo `axis` (versore, default +Z verticale). In 4/5 assi si passa
 * l'asse utensile letto dal G-code → la punta si inclina come nella macchina.
 * Modello nativo con asse Y (tagliente Y-min): prima Y→Z, poi rotazione su `axis`.
 * @param {number[]} toolPos @param {number} diaMm @param {number[]} [axis]
 */
export function placeMillBit(toolPos, diaMm, axis) {
  if (!cached) return null;
  const s = diaMm > 0 && cached.dia > 0 ? diaMm / cached.dia : 1;
  const P = cached.positions, tip = cached.tip;
  const rt = [tip[0], -tip[2], tip[1]];             // punta dopo la rotazione Y→Z
  const R = axisRot(axis || [0, 0, 1]);             // orienta lungo l'asse utensile
  const out = new Float64Array(P.length);
  for (let i = 0; i < P.length; i += 3) {
    // punto nel frame utensile (asse +Z, tagliente all'origine), scalato
    const lx = (P[i] - rt[0]) * s;
    const ly = (-P[i + 2] - rt[1]) * s;
    const lz = (P[i + 1] - rt[2]) * s;
    out[i] = toolPos[0] + R[0] * lx + R[1] * ly + R[2] * lz;
    out[i + 1] = toolPos[1] + R[3] * lx + R[4] * ly + R[5] * lz;
    out[i + 2] = toolPos[2] + R[6] * lx + R[7] * ly + R[8] * lz;
  }
  return { positions: out, indices: cached.indices, triTool: cached.triTool };
}
