// @ts-check
// Converte l'estrazione B-rep (brep.js) nelle FEATURE per il generatore NC:
// sezione (W×H), raggio spigoli, lunghezza, e i TAGLI della superficie:
//  - dai faceLoops (wire interni delle facce esterne): fori (fit cerchio)
//    e ASOLE/contorni generici — percorso ESATTO, una passata continua;
//  - fallback storico dai cilindri (asse radiale) se i loop non ci sono.

/**
 * Fit di cerchio di un loop: centroide + raggio medio; è un cerchio se la
 * deviazione massima dal raggio medio è piccola.
 * @param {{x:number,y:number,z:number}[]} pts
 */
function circleFit(pts) {
  const n = pts.length - 1;   // ultimo punto = primo (loop chiuso)
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += pts[i].x; cy += pts[i].y; cz += pts[i].z; }
  cx /= n; cy /= n; cz /= n;
  let rSum = 0, rMax = 0, rMin = Infinity;
  for (let i = 0; i < n; i++) {
    const r = Math.hypot(pts[i].x - cx, pts[i].y - cy, pts[i].z - cz);
    rSum += r; if (r > rMax) rMax = r; if (r < rMin) rMin = r;
  }
  const r = rSum / n;
  return { c: { x: cx, y: cy, z: cz }, r, isCircle: (rMax - rMin) / (r || 1) < 0.02 };
}

/**
 * @param {Awaited<ReturnType<import('../loaders/step/brep.js').extractBrep>>} brep
 */
export function featuresFromBrep(brep) {
  const b = brep.bbox;
  const sectionW = +(b.max.y - b.min.y).toFixed(3);   // Y = larghezza sezione
  const sectionH = +(b.max.z - b.min.z).toFixed(3);   // Z = altezza sezione
  const length = +(b.max.x - b.min.x).toFixed(3);     // X = lunghezza pezzo

  // raggio spigoli = raggio dei cilindri PICCOLI con asse ASSIALE (lungo X)
  const fillets = brep.cylinders.filter((c) => Math.abs(c.dir.x) > 0.9 && c.r < Math.min(sectionW, sectionH) / 4);
  let cornerR = 0;
  if (fillets.length) {
    // il più frequente (moda) tra i raccordi
    const freq = {};
    for (const c of fillets) { const k = c.r.toFixed(2); freq[k] = (freq[k] || 0) + 1; }
    cornerR = +Object.entries(freq).sort((a, b2) => b2[1] - a[1])[0][0];
  }

  /** @type {{xStep:number,yStep:number,r:number,faceZ:number}[]} */
  const holes = [];
  /** @type {{pts:{x:number,y:number,z:number}[], n:{x:number,y:number,z:number}}[]} */
  const slots = [];

  // 1) percorso esatto dai wire delle facce ESTERNE (|d| ≈ semialtezza/semilarghezza)
  const half = (n) => (Math.abs(n.z) > 0.7 ? sectionH / 2 : sectionW / 2);
  for (const fl of brep.faceLoops || []) {
    if (Math.abs(Math.abs(fl.d) - half(fl.n)) > 0.1) continue;   // faccia interna: salta
    for (const pts of fl.loops) {
      const fit = circleFit(pts);
      if (fit.isCircle) {
        holes.push({ xStep: +fit.c.x.toFixed(3), yStep: +fit.c.y.toFixed(3), r: +fit.r.toFixed(3), faceZ: fl.n.z >= 0 ? 1 : -1 });
      } else {
        slots.push({ pts, n: fl.n });
      }
    }
  }

  // 2) fallback: cilindri con asse RADIALE (quando i loop non sono estraibili)
  if (!holes.length && !slots.length) {
    const holeCyls = brep.cylinders.filter((c) => Math.abs(c.dir.x) < 0.3);
    /** @type {Map<string,{xStep:number,yStep:number,r:number,faceZ:number}>} */
    const dedup = new Map();
    for (const c of holeCyls) {
      const key = `${c.c.x.toFixed(1)}_${c.c.y.toFixed(1)}_${c.r.toFixed(1)}`;
      if (!dedup.has(key)) {
        dedup.set(key, { xStep: +c.c.x.toFixed(3), yStep: +c.c.y.toFixed(3), r: +c.r.toFixed(3), faceZ: c.c.z > 0 ? 1 : -1 });
      }
    }
    holes.push(...dedup.values());
  }

  return { sectionW, sectionH, cornerR, length, holes, slots };
}
