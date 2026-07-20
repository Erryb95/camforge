// @ts-check
// COPING / NOTCHING tubo-tubo (fish-mouth): profilo di intaglio per un tubo BRANCH
// (raggio r) che si innesta su un tubo MAIN (raggio R), così che l'estremità del
// branch combaci con la superficie cilindrica del main. Si calcola il profilo di
// intersezione, lo si SVILUPPA (unwrap) in (u = assiale mm, v = circonferenziale mm)
// e lo si AVVOLGE sull'asse A → G-code QtPlasmaC (via tubeWrap.postRotaryPlasmaC).
//
// GEOMETRIA (assi che si intersecano nell'origine, nessun offset laterale):
//   main axis lungo X, superficie y²+z²=R² ; branch axis nel piano X-Z a angolo θ
//   dall'asse X (θ=90° = perpendicolare). Punto sulla superficie del branch a angolo
//   circonferenziale φ e distanza assiale t dal punto di incrocio:
//     x = t·cosθ − r·cosφ·sinθ ;  y = r·sinφ ;  z = t·sinθ + r·cosφ·cosθ
//   imponendo y²+z²=R² → quadratica in t:
//     A·t² + B·t + C = 0 ,  A = sin²θ , B = r·sin(2θ)·cosφ , C = r²(sin²φ+cos²φ·cos²θ) − R²
//   Il discriminante si semplifica: B²−4AC = 4·sin²θ·(R²−r²·sin²φ), da cui la FORMA CHIUSA
//   (radice near-side), che usiamo qui perché stabile e identica ai riferimenti pubblicati:
//     t(φ) = [ √(R² − r²·sin²φ) − r·cosφ·cosθ ] / sinθ
//   θ=90°  ⇒  t(φ) = √(R² − r²·sin²φ)  (cope perpendicolare, = Steinmetz curve, da manuale)
//   r=R,θ=90° ⇒ t(φ) = R·|cosφ|  (solido di Steinmetz: due cilindri uguali → due ellissi)
//   Riferimenti: Steinmetz curve/solid (Wikipedia/MathWorld); tube-coping calculators
//   calculator.city e weldfabworld (stessa forma chiusa, datum diverso). Verifica in test.
//   Sviluppo: v = r·φ (arco) ,  u = t(φ). La correttezza è verificata contro queste
//   forme chiuse nei test (tests/coping.test.mjs) — nessun taglio reale necessario.

import { wrapContoursToRotary } from './tubeWrap.js';
import { materialNumber } from './plasmacMaterial.js';
import { cutParamsFor, materialEntries } from './rotaryCut.js';

const TAU = Math.PI * 2;

/**
 * Profilo di coping SVILUPPATO del tubo BRANCH (u = assiale mm, v = circonferenziale mm).
 * @param {{branchDiameter:number, mainDiameter:number, angleDeg?:number, points?:number}} o
 * @returns {{ pts:{u:number,v:number}[], circumference:number, notchDepth:number, tMin:number, tMax:number, warning?:string }}
 */
export function copeProfile(o) {
  const r = o.branchDiameter / 2, R = o.mainDiameter / 2;
  const th = (o.angleDeg ?? 90) * Math.PI / 180;
  const n = Math.max(24, Math.round(o.points ?? 180));
  const sinT = Math.sin(th), cosT = Math.cos(th);
  let warning;
  // forma chiusa (radice near-side): t(φ) = [√(R²−r²·sin²φ) − r·cosφ·cosθ] / sinθ.
  const degenerate = sinT < 1e-9;                    // θ→0 o 180: assi (quasi) paralleli
  if (degenerate) warning = 'angolo troppo piccolo (assi quasi paralleli): coping non definito';
  const tOf = (phi) => {
    if (degenerate) return NaN;
    const cph = Math.cos(phi), sph = Math.sin(phi);
    let rad = R * R - r * r * sph * sph;             // = (B²−4AC)/(4sin²θ)
    if (rad < 0) { rad = 0; warning = 'branch troppo grande per il main (Ø branch > Ø main): intaglio troncato'; }
    return (Math.sqrt(rad) - r * cph * cosT) / sinT;
  };
  const pts = [];
  let tMin = Infinity, tMax = -Infinity;
  for (let i = 0; i <= n; i++) {
    const phi = (TAU * i) / n;
    const t = tOf(phi);
    pts.push({ u: t, v: r * phi });
    if (Number.isFinite(t)) { if (t < tMin) tMin = t; if (t > tMax) tMax = t; }   // ignora i NaN (angolo degenere)
  }
  if (!Number.isFinite(tMin) || !Number.isFinite(tMax)) { tMin = 0; tMax = 0; }   // niente −Infinity/NaN a valle
  return { pts, circumference: TAU * r, notchDepth: tMax - tMin, tMin, tMax, warning };
}

/**
 * Coping completo: profilo → contorno avvolto sul tubo branch → G-code QtPlasmaC-nativo
 * + modello 3D avvolto (per la simulazione). Il taglio è UN passaggio continuo che
 * ruota A da 0 a 360° seguendo l'intaglio (torcia a standoff fisso). Lead-in dal lato
 * di scarto (sotto la linea d'intaglio al punto d'attacco).
 * @param {{branchDiameter?:number, mainDiameter?:number, angleDeg?:number, thickness?:number,
 *   material?:string, feed?:number, points?:number, stub?:number, body?:number, leadIn?:number, name?:string}} [o]
 */
export function copeToRotary(o = {}) {
  const branchDiameter = o.branchDiameter ?? 50;
  const mainDiameter = o.mainDiameter ?? 60;
  const angleDeg = o.angleDeg ?? 90;
  const thickness = o.thickness ?? 2;
  const materialKey = o.material ?? 'mild_steel';
  const prof = copeProfile({ branchDiameter, mainDiameter, angleDeg, points: o.points ?? 180 });
  // angolo/diametri degeneri → niente NGC con NaN/lunghezza negativa: errore chiaro
  if (!Number.isFinite(prof.tMax) || prof.tMax <= prof.tMin) {
    throw new Error(prof.warning || 'coping: geometria degenere — controlla angolo (15–90°) e diametri');
  }

  // Posiziona l'intaglio sul tubo: valle (u minimo) a `stub` mm dall'origine (moncone
  // di scarto verso l'estremità), corpo tubo KEPT oltre le corna. u_cut = (t − tMin) + stub.
  const stub = o.stub ?? 15;
  const body = o.body ?? 60;
  const contourPts = prof.pts.map((p) => ({ u: (p.u - prof.tMin) + stub, v: p.v }));
  const length = prof.notchDepth + stub + body;
  const tube = { shape: 'round', diameter: branchDiameter, length };

  // lead-in dal lato di scarto: pierce leadLen mm SOTTO la linea al punto d'attacco
  const leadLen = o.leadIn ?? 4;
  const p0 = contourPts[0];
  const lead = leadLen > 0 ? [{ u: Math.max(0, p0.u - leadLen), v: p0.v }, { u: p0.u, v: p0.v }] : undefined;
  const contour = { pts: contourPts, lead, tag: `coping Ø${branchDiameter}→Ø${mainDiameter} @${angleDeg}°` };

  const preset = cutParamsFor(thickness, materialEntries(materialKey));
  const feed = o.feed ?? preset.feed;
  const material = materialNumber(materialKey, thickness);
  const name = o.name || `cope-${branchDiameter}on${mainDiameter}-${angleDeg}deg.ngc`;

  const r = wrapContoursToRotary([contour], tube, { feed, thickness, material, name });
  const warn = prof.warning ? ` · ⚠ ${prof.warning}` : '';
  const info = `coping branch Ø${branchDiameter} su main Ø${mainDiameter} @ ${angleDeg}° · `
    + `intaglio prof. ${prof.notchDepth.toFixed(1)} mm · tubo L${length.toFixed(0)} mm · ${materialKey} ${thickness} mm · feed ${feed} mm/min${warn}`;
  return { ...r, info, profile: prof };
}
