// @ts-check
// Utensile e formula dell'IMPRONTA per la simulazione di asportazione a 3 assi.
// footprint(tool, d) = sottoquota (>=0) della superficie inferiore dell'utensile
// a distanza radiale d dall'asse, con la PUNTA a quota 0. Per una punta a quota
// zTip la quota inferiore è zTip + footprint(tool, d). Oltre il raggio: +Infinity
// (fuori impronta, nessun taglio). Formule standard (cfr. tri-dexel / CutViewer).

/** @typedef {{type:'flat'|'ball'|'bull', r:number, corner:number, diameter:number}} Tool */

const TYPES = ['flat', 'ball', 'bull'];

/**
 * @param {{type?:string, diameter?:number, cornerR?:number}} [opts]
 * @returns {Tool}
 */
export function makeTool(opts = {}) {
  const type = /** @type {any} */ (TYPES.includes(/** @type {any} */(opts.type)) ? opts.type : 'flat');
  const diameter = opts.diameter && opts.diameter > 0 ? opts.diameter : 6;
  const r = diameter / 2;
  const corner = type === 'ball' ? r
    : type === 'bull' ? Math.min(Math.max(0, opts.cornerR ?? r / 4), r)
    : 0;
  return { type, r, corner, diameter };
}

/**
 * Sottoquota dell'utensile a distanza radiale d (punta a 0). +Infinity oltre R.
 * @param {Tool} tool @param {number} d
 */
export function footprint(tool, d) {
  const R = tool.r;
  if (d >= R) return Infinity;
  if (tool.type === 'flat') return 0;
  if (tool.type === 'ball') return R - Math.sqrt(R * R - d * d);
  // bull / torus: piatto fino a R-corner, poi raccordo di raggio corner
  const flat = R - tool.corner;
  if (d <= flat) return 0;
  const t = d - flat;
  return tool.corner - Math.sqrt(tool.corner * tool.corner - t * t);
}
