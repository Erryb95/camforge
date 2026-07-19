// @ts-check
// Rilevamento TUBO da una nuvola di segmenti 3D (STEP/IGES/BREP) e calcolo
// dello sviluppo (seg.uv) come per i file NC: così la vista "Svolto" — con
// ripiegatura a UNA sezione e stacco alla cucitura (foldToStrip nei renderer,
// stessi miglioramenti del tracciato NC) — funziona anche sui file CAD 3D.
//
// Metodo: asse principale (PCA, i pezzi non sono axis-aligned), sezione dai
// punti proiettati nel piano trasversale (tonda se raggio ~costante,
// rettangolare altrimenti), poi u = ascissa assiale, v = perimeterParam.

import { perimeterParam, profileFromMeta, guidesFor, makeUnwrapper } from '../../core/unroll.js';

/** Autovettore dominante della covarianza (power iteration). */
function principalAxis(pts) {
  const c = [0, 0, 0];
  for (const p of pts) { c[0] += p.x; c[1] += p.y; c[2] += p.z; }
  c[0] /= pts.length; c[1] /= pts.length; c[2] /= pts.length;
  let cxx = 0, cyy = 0, czz = 0, cxy = 0, cxz = 0, cyz = 0;
  for (const p of pts) {
    const dx = p.x - c[0], dy = p.y - c[1], dz = p.z - c[2];
    cxx += dx * dx; cyy += dy * dy; czz += dz * dz;
    cxy += dx * dy; cxz += dx * dz; cyz += dy * dz;
  }
  let a = [1, 0.001, 0.002];
  for (let i = 0; i < 60; i++) {
    const nx = cxx * a[0] + cxy * a[1] + cxz * a[2];
    const ny = cxy * a[0] + cyy * a[1] + cyz * a[2];
    const nz = cxz * a[0] + cyz * a[1] + czz * a[2];
    const l = Math.hypot(nx, ny, nz) || 1;
    a = [nx / l, ny / l, nz / l];
  }
  return { centroid: { x: c[0], y: c[1], z: c[2] }, axis: { x: a[0], y: a[1], z: a[2] } };
}

/**
 * Rileva il tubo e applica lo sviluppo ai segmenti (in-place: seg.uv).
 * @param {import('../../core/model.js').Segment[]} segments
 * @param {Record<string, any>} meta  riceve tubeWidth/Height|Diameter, perimeter, unrollGuides, unrollAvailable
 * @returns {boolean} true se il modello è stato riconosciuto come tubo
 */
export function applyCadTubeUnroll(segments, meta) {
  /** @type {{x:number,y:number,z:number}[]} */
  const pts = [];
  for (const s of segments) for (const p of s.pts) pts.push(p);
  if (pts.length < 40) return false;

  const { centroid, axis } = principalAxis(pts);

  // base ortonormale del piano trasversale: e1 = direzione di massima
  // estensione trasversale (PCA 2D), e2 = axis × e1
  let ref = Math.abs(axis.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  let e1 = {
    x: ref.y * axis.z - ref.z * axis.y,
    y: ref.z * axis.x - ref.x * axis.z,
    z: ref.x * axis.y - ref.y * axis.x,
  };
  let l1 = Math.hypot(e1.x, e1.y, e1.z); e1 = { x: e1.x / l1, y: e1.y / l1, z: e1.z / l1 };
  let e2 = {
    x: axis.y * e1.z - axis.z * e1.y,
    y: axis.z * e1.x - axis.x * e1.z,
    z: axis.x * e1.y - axis.y * e1.x,
  };

  // proiezioni: u lungo l'asse, (a,b) nel piano sezione
  const proj = pts.map((p) => {
    const dx = p.x - centroid.x, dy = p.y - centroid.y, dz = p.z - centroid.z;
    return {
      u: dx * axis.x + dy * axis.y + dz * axis.z,
      a: dx * e1.x + dy * e1.y + dz * e1.z,
      b: dx * e2.x + dy * e2.y + dz * e2.z,
    };
  });
  let uMin = Infinity, uMax = -Infinity;
  for (const q of proj) { if (q.u < uMin) uMin = q.u; if (q.u > uMax) uMax = q.u; }
  const length = uMax - uMin;

  // PCA 2D nel piano sezione per allineare e1/e2 alle facce del profilo
  let saa = 0, sbb = 0, sab = 0;
  for (const q of proj) { saa += q.a * q.a; sbb += q.b * q.b; sab += q.a * q.b; }
  const theta = 0.5 * Math.atan2(2 * sab, saa - sbb);
  const ct = Math.cos(theta), st = Math.sin(theta);
  let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
  const radii = [];
  for (const q of proj) {
    const a2 = q.a * ct + q.b * st;
    const b2 = -q.a * st + q.b * ct;
    q.a = a2; q.b = b2;
    if (a2 < aMin) aMin = a2; if (a2 > aMax) aMax = a2;
    if (b2 < bMin) bMin = b2; if (b2 > bMax) bMax = b2;
    radii.push(Math.hypot(a2, b2));
  }
  const w = aMax - aMin, h = bMax - bMin;
  const sectionMax = Math.max(w, h);
  if (!(length > 2.2 * sectionMax) || sectionMax < 1) return false;   // non è un tubo

  // tonda se il raggio è ~costante (parete sottile inclusa)
  radii.sort((x, y) => x - y);
  const p05 = radii[Math.floor(radii.length * 0.05)];
  const p95 = radii[Math.floor(radii.length * 0.95)];
  const round = (p95 - p05) / (p95 || 1) < 0.22 && Math.abs(w - h) / sectionMax < 0.12;

  if (round) {
    meta.tubeDiameter = +(2 * p95).toFixed(2);
    delete meta.tubeWidth; delete meta.tubeHeight;
  } else {
    meta.tubeWidth = +w.toFixed(2);
    meta.tubeHeight = +h.toFixed(2);
    delete meta.tubeDiameter;
  }
  const profile = profileFromMeta(meta);
  if (!profile) return false;

  // centro sezione: gli estremi sono simmetrici rispetto al centro vero
  const ca = (aMin + aMax) / 2, cb = (bMin + bMax) / 2;

  // sviluppo per segmento: u dal fondo, v continuo NEL segmento (la
  // ripiegatura a una sezione la fanno i renderer con foldToStrip)
  let k = 0;
  for (const s of segments) {
    const unwrap = makeUnwrapper(profile.per);
    s.uv = s.pts.map((p, i) => {
      const q = proj[k + i];
      return { u: q.u - uMin, v: unwrap.next(perimeterParam(q.a - ca, q.b - cb, profile)) };
    });
    k += s.pts.length;
  }

  meta.unrollAvailable = true;
  meta.perimeter = profile.per;
  meta.unrollGuides = guidesFor(profile);
  meta.tubeLength = +length.toFixed(1);
  return true;
}
