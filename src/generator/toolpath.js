// @ts-check
// Costruzione del TOOLPATH dal set di contorni 2D: la parte "CAM" del
// generatore. Regole implementate (le stesse dei CAM commerciali, cfr.
// docs/RESEARCH.md — il problema è un TSP generalizzato; qui euristica
// deterministica nearest-neighbor + vincoli):
//   1. contorni INTERNI prima di quelli che li contengono (il pezzo non si
//      muove finché il suo perimetro non è tagliato);
//   2. ogni contorno è UNA passata continua (chiuso, senza riattacchi);
//   3. punto di partenza di ogni contorno ruotato per minimizzare il rapido
//      (endpoint cutting problem);
//   4. lead-in dal lato SFRIDO (dentro il foro / fuori dal perimetro), così
//      il piercing non segna il pezzo.

/**
 * @typedef {{pts:{x:number,y:number}[], closed?:boolean, tag?:string}} Contour2D
 * @typedef {{type:'cut', pts:{x:number,y:number}[], lead:{x:number,y:number}[], tag?:string, depth:number}} CutOp
 */

/** Punto-in-poligono (ray casting). @param {{x,y}} p @param {{x,y}[]} poly */
export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) &&
        p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Centroide (media dei vertici — sufficiente per la direzione del lead-in). */
function centroid(pts) {
  let x = 0, y = 0;
  const n = pts.length - (samePt(pts[0], pts[pts.length - 1]) ? 1 : 0);
  for (let i = 0; i < n; i++) { x += pts[i].x; y += pts[i].y; }
  return { x: x / n, y: y / n };
}
const samePt = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-9;

/**
 * Profondità di contenimento di ogni contorno (0 = più esterno).
 * @param {Contour2D[]} contours
 */
export function containmentDepth(contours) {
  return contours.map((c, i) => {
    const probe = c.pts[0];
    let depth = 0;
    contours.forEach((o, j) => {
      if (i !== j && pointInPoly(probe, o.pts)) depth++;
    });
    return depth;
  });
}

/** Ruota un contorno chiuso perché parta dal vertice più vicino a `from`. */
function rotateStart(pts, from) {
  const closed = samePt(pts[0], pts[pts.length - 1]);
  const core = closed ? pts.slice(0, -1) : pts;
  if (!closed) return pts;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < core.length; i++) {
    const d = Math.hypot(core[i].x - from.x, core[i].y - from.y);
    if (d < bestD) { bestD = d; best = i; }
  }
  const rot = core.slice(best).concat(core.slice(0, best));
  rot.push({ ...rot[0] });
  return rot;
}

/**
 * Sequenzia i contorni: interni prima (profondità decrescente), poi
 * nearest-neighbor sul punto di partenza (che viene anche ruotato).
 * @param {Contour2D[]} contours
 * @param {{x:number,y:number}} [startPos] posizione iniziale della testa
 * @returns {{ordered:Contour2D[], depths:number[]}}
 */
export function orderContours(contours, startPos = { x: 0, y: 0 }) {
  const depths = containmentDepth(contours);
  // gruppi per profondità decrescente: i più interni si tagliano per primi
  const byDepth = new Map();
  contours.forEach((c, i) => {
    const d = depths[i];
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d).push({ c, d });
  });
  const levels = [...byDepth.keys()].sort((a, b) => b - a);

  const ordered = [];
  const outDepths = [];
  let pos = startPos;
  for (const lv of levels) {
    const pool = byDepth.get(lv).slice();
    while (pool.length) {
      // nearest-neighbor: contorno col punto più vicino a pos
      let bi = 0, bd = Infinity, bpts = null;
      for (let i = 0; i < pool.length; i++) {
        const rot = rotateStart(pool[i].c.pts, pos);
        const d = Math.hypot(rot[0].x - pos.x, rot[0].y - pos.y);
        if (d < bd) { bd = d; bi = i; bpts = rot; }
      }
      const { c, d } = pool.splice(bi, 1)[0];
      ordered.push({ ...c, pts: /** @type {any} */(bpts) });
      outDepths.push(d);
      pos = bpts[0];
    }
  }
  return { ordered, depths: outDepths };
}

/**
 * Costruisce il toolpath completo con lead-in dal lato sfrido.
 * @param {Contour2D[]} contours
 * @param {{leadIn?:number, startPos?:{x:number,y:number}}} [opts]
 * @returns {CutOp[]}
 */
export function makeToolpath(contours, opts = {}) {
  const leadLen = opts.leadIn ?? 2;
  const { ordered, depths } = orderContours(contours, opts.startPos);
  return ordered.map((c, i) => {
    const start = c.pts[0];
    const cen = centroid(c.pts);
    let dir = { x: cen.x - start.x, y: cen.y - start.y };
    const L = Math.hypot(dir.x, dir.y) || 1;
    dir = { x: dir.x / L, y: dir.y / L };
    // profondità pari (0,2,…) = perimetro pezzo → sfrido FUORI; dispari = foro → sfrido DENTRO
    const inward = depths[i] % 2 === 1;
    const s = inward ? 1 : -1;
    const lead = leadLen > 0
      ? [{ x: start.x + s * dir.x * leadLen, y: start.y + s * dir.y * leadLen }, { x: start.x, y: start.y }]
      : [];
    return { type: 'cut', pts: c.pts, lead, tag: c.tag, depth: depths[i] };
  });
}
