// @ts-check
// Offset di poligoni (compensazione KERF) tramite Clipper (vendor/clipper,
// Boost SW License). Primitiva fondante del futuro generatore .cn/NC:
// il percorso di taglio reale è il contorno offsettato di ±kerf/2
// (esterno verso l'esterno, fori verso l'interno). Clipper lavora su interi:
// scaliamo di SCALE per la precisione sub-mm.

const SCALE = 1000;   // 1 unità Clipper = 1/1000 mm

/** @type {any} */
let CL = null;

/** Carica ClipperLib (lazy): browser via <script>, Node via require. */
async function getClipper() {
  if (CL) return CL;
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    if (!(/** @type {any} */ (window).ClipperLib)) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'vendor/clipper/clipper.js';
        s.onload = () => resolve(null);
        s.onerror = () => reject(new Error('vendor/clipper/clipper.js non caricabile'));
        document.head.appendChild(s);
      });
    }
    CL = /** @type {any} */ (window).ClipperLib;
  } else {
    const { createRequire } = await import('node:module');
    CL = createRequire(import.meta.url)('../../../vendor/clipper/clipper.js');
  }
  return CL;
}

/**
 * Offsetta contorni chiusi di `delta` mm (positivo = espande, negativo = restringe).
 * @param {number[][][]} paths  contorni chiusi: [[[x,y],...], ...] (mm)
 * @param {number} delta        offset in mm
 * @param {{join?: 'round'|'miter'|'square', arcTol?: number}} [opts]
 * @returns {Promise<number[][][]>}  contorni offsettati (mm)
 */
export async function offsetClosed(paths, delta, opts = {}) {
  const lib = await getClipper();
  const co = new lib.ClipperOffset(2, (opts.arcTol ?? 0.02) * SCALE);
  const join = opts.join === 'miter' ? lib.JoinType.jtMiter
    : opts.join === 'square' ? lib.JoinType.jtSquare : lib.JoinType.jtRound;
  for (const path of paths) {
    const p = path.map(([x, y]) => new lib.IntPoint(Math.round(x * SCALE), Math.round(y * SCALE)));
    co.AddPath(p, join, lib.EndType.etClosedPolygon);
  }
  /** @type {any[]} */
  const solution = [];
  co.Execute(solution, delta * SCALE);
  return solution.map((p) => p.map((pt) => [pt.X / SCALE, pt.Y / SCALE]));
}

/** Area con segno di un contorno (mm²). @param {number[][]} path */
export async function pathArea(path) {
  const lib = await getClipper();
  const p = path.map(([x, y]) => new lib.IntPoint(Math.round(x * SCALE), Math.round(y * SCALE)));
  return lib.Clipper.Area(p) / (SCALE * SCALE);
}

/**
 * Offsetta polilinee APERTE di `halfKerf` mm per lato (kerf laser = banda attorno
 * al percorso). Estremi squadrati (etOpenButt) di default. @returns {Promise<number[][][]>}
 * @param {number[][][]} polylines  [[[x,y],...], ...] (mm)
 * @param {number} halfKerf         mm per lato (delta = kerf/2)
 * @param {{cap?:'butt'|'round'|'square', join?:'round'|'miter'|'square', arcTol?:number}} [opts]
 */
export async function offsetOpen(polylines, halfKerf, opts = {}) {
  const lib = await getClipper();
  const co = new lib.ClipperOffset(2, (opts.arcTol ?? 0.02) * SCALE);
  const cap = opts.cap === 'round' ? lib.EndType.etOpenRound : opts.cap === 'square' ? lib.EndType.etOpenSquare : lib.EndType.etOpenButt;
  const join = opts.join === 'miter' ? lib.JoinType.jtMiter : opts.join === 'square' ? lib.JoinType.jtSquare : lib.JoinType.jtRound;
  for (const pl of polylines) {
    if (pl.length < 2) continue;
    co.AddPath(pl.map(([x, y]) => new lib.IntPoint(Math.round(x * SCALE), Math.round(y * SCALE))), join, cap);
  }
  /** @type {any[]} */ const sol = [];
  co.Execute(sol, halfKerf * SCALE);
  return sol.map((p) => p.map((pt) => [pt.X / SCALE, pt.Y / SCALE]));
}

/**
 * Materiale residuo dopo il taglio: `blank` meno l'unione degli `swaths` (kerf).
 * Restituisce regioni con fori (dal PolyTree: outer non-hole + suoi fori; le isole
 * dentro i fori diventano nuove regioni). @returns {Promise<{outer:number[][], holes:number[][][]}[]>}
 * @param {number[][][]} blank   contorni pieni (subject)
 * @param {number[][][]} swaths  bande di kerf da sottrarre (clip)
 */
export async function cutRegions(blank, swaths) {
  const lib = await getClipper();
  const toInt = (path) => path.map(([x, y]) => new lib.IntPoint(Math.round(x * SCALE), Math.round(y * SCALE)));
  const back = (path) => path.map((pt) => [pt.X / SCALE, pt.Y / SCALE]);
  const c = new lib.Clipper();
  c.AddPaths(blank.map(toInt), lib.PolyType.ptSubject, true);
  if (swaths.length) c.AddPaths(swaths.map(toInt), lib.PolyType.ptClip, true);
  const tree = new lib.PolyTree();
  c.Execute(lib.ClipType.ctDifference, tree, lib.PolyFillType.pftNonZero, lib.PolyFillType.pftNonZero);
  /** @type {{outer:number[][], holes:number[][][]}[]} */
  const regions = [];
  const walk = (node) => {
    const childs = node.Childs();
    regions.push({ outer: back(node.Contour()), holes: childs.map((h) => back(h.Contour())) });
    for (const h of childs) for (const island of h.Childs()) walk(island);   // isole nei fori
  };
  for (const top of tree.Childs()) walk(top);
  return regions;
}
