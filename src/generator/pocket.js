// @ts-check
// POCKET / area clearing: svuota un'area chiusa con passate CONCENTRICHE
// (contour-parallel), RIUSANDO l'offset Clipper già vendorizzato (offsetClosed) —
// nessuna dipendenza nuova. Offsetta il boundary verso l'interno a passi di
// `stepover` finché la soluzione è vuota; Clipper gestisce da solo split/merge
// delle isole ed è robusto. (Medial-axis/HSM: inutile e fragile qui.)

import { offsetClosed } from '../loaders/cad/offset.js';

/**
 * Anelli concentrici che riempiono l'area dei contorni, dall'esterno verso l'interno.
 * @param {{pts:{u:number,v:number}[]}[]} contours  boundary (+ eventuali isole passate come path)
 * @param {{tool:number, stepover?:number, finish?:number, maxRings?:number}} opts
 * @returns {Promise<{u:number,v:number}[][]>}
 */
export async function pocketRings(contours, opts) {
  const tool = opts.tool || 1;
  const stepover = opts.stepover ?? tool * 0.6;     // sovrapposizione ~40%
  const finish = opts.finish ?? tool / 2;           // primo inset dall'orlo (mezzo utensile)
  const maxRings = opts.maxRings ?? 2000;
  const paths = contours.map((c) => c.pts.map((p) => [p.u, p.v]));

  /** @type {{u:number,v:number}[][]} */
  const rings = [];
  let delta = -finish;
  let guard = 0;
  // offsetta SEMPRE il boundary originale di un delta crescente (niente accumulo d'errore)
  for (let cur = await offsetClosed(paths, delta, { join: 'round' });
       cur.length && guard < maxRings;
       cur = await offsetClosed(paths, delta, { join: 'round' })) {
    for (const r of cur) if (r.length >= 3) rings.push(r.map(([u, v]) => ({ u, v })));
    delta -= stepover;
    guard++;
  }
  return rings;
}
