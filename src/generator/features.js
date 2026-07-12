// @ts-check
// Converte l'estrazione B-rep (brep.js) nelle FEATURE per il generatore NC:
// sezione (W×H), raggio spigoli, lunghezza, e fori (cilindri con asse radiale).

/**
 * @param {import('../loaders/step/brep.js').extractBrep extends (...a:any)=>Promise<infer R> ? R : any} brep
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

  // fori = cilindri con asse RADIALE (perpendicolare all'asse tubo X)
  const holeCyls = brep.cylinders.filter((c) => Math.abs(c.dir.x) < 0.3);
  // dedup: stesso foro può dare 2 semicilindri → raggruppa per (x,y,r) arrotondati
  /** @type {Map<string,{xStep:number,yStep:number,r:number,faceZ:number}>} */
  const holes = new Map();
  for (const c of holeCyls) {
    const key = `${c.c.x.toFixed(1)}_${c.c.y.toFixed(1)}_${c.r.toFixed(1)}`;
    if (!holes.has(key)) {
      holes.set(key, { xStep: +c.c.x.toFixed(3), yStep: +c.c.y.toFixed(3), r: +c.r.toFixed(3), faceZ: c.c.z > 0 ? 1 : -1 });
    }
  }

  return { sectionW, sectionH, cornerR, length, holes: [...holes.values()] };
}
