// @ts-check
// NESTING lamiera: replica un pezzo (contorni (u,v)=(x,y)) su un foglio con packing
// a BOUNDING-BOX a griglia — come l'auto-nesting di SheetCam (che NON ha true-shape
// nativo). Sceglie l'orientamento (0°/90°) che ne fa stare di più per foglio, lascia
// un `gap` tra i pezzi (per kerf + sfrido) e riporta l'utilizzo del foglio.
// (True-shape nesting = differenziatore futuro; qui la parità: griglia + rotazione.)

/**
 * @typedef {{pts:{u:number,v:number}[], tag?:string}} Contour
 */

/** Bounding box su un set di contorni (u,v). @param {Contour[]} contours */
export function boundingBox(contours) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of contours) for (const p of c.pts) {
    if (p.u < minX) minX = p.u; if (p.u > maxX) maxX = p.u;
    if (p.v < minY) minY = p.v; if (p.v > maxY) maxY = p.v;
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 };
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** Trasla i contorni di (dx,dy). @param {Contour[]} contours */
export function translateContours(contours, dx, dy) {
  return contours.map((c) => ({ ...c, pts: c.pts.map((p) => ({ u: p.u + dx, v: p.v + dy })) }));
}

/** Ruota i contorni di `deg` gradi attorno all'origine. @param {Contour[]} contours */
export function rotateContours(contours, deg) {
  const a = deg * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
  return contours.map((c) => ({ ...c, pts: c.pts.map((p) => ({ u: p.u * cs - p.v * sn, v: p.u * sn + p.v * cs })) }));
}

/**
 * Dispone `count` copie del pezzo su un foglio sheetW×sheetH, packing a griglia
 * con `gap` tra i pezzi e `margin` dal bordo. Sceglie 0° o 90° per massimizzare.
 * @param {Contour[]} part  contorni del singolo pezzo (perimetro + eventuali fori)
 * @param {{count?:number, sheetW?:number, sheetH?:number, gap?:number, margin?:number, allowRotate?:boolean}} [opts]
 */
export function nestGrid(part, opts = {}) {
  const gap = opts.gap ?? 6;
  const margin = opts.margin ?? 6;
  const count = Math.max(1, Math.round(opts.count ?? 1));
  const sheetW = opts.sheetW ?? 1220;     // foglio standard ~4×8 ft (1220×2440 mm)
  const sheetH = opts.sheetH ?? 2440;
  const allowRotate = opts.allowRotate ?? true;

  const bb = boundingBox(part);
  const capacity = (pw, ph) => {
    const cols = Math.max(0, Math.floor((sheetW - 2 * margin + gap) / (pw + gap)));
    const rows = Math.max(0, Math.floor((sheetH - 2 * margin + gap) / (ph + gap)));
    return { cols, rows, cap: cols * rows };
  };
  const cap0 = capacity(bb.w, bb.h), cap90 = capacity(bb.h, bb.w);
  const rot = allowRotate && cap90.cap > cap0.cap;
  const { cols, rows } = rot ? cap90 : cap0;

  const partR = rot ? rotateContours(part, 90) : part;
  const bbR = boundingBox(partR);
  const pw = bbR.w, ph = bbR.h;

  /** @type {Contour[][]} */ const placements = [];
  let n = 0;
  for (let r = 0; r < rows && n < count; r++) {
    for (let c = 0; c < cols && n < count; c++) {
      const dx = margin + c * (pw + gap) - bbR.minX;   // normalizza il min a margin+cella
      const dy = margin + r * (ph + gap) - bbR.minY;
      placements.push(translateContours(partR, dx, dy));
      n++;
    }
  }

  const contours = placements.flat();
  const partArea = Math.abs(bb.w * bb.h);
  const sheetArea = sheetW * sheetH;
  const util = sheetArea > 0 ? (n * partArea) / sheetArea : 0;
  return {
    contours, placements, cols, rows, placed: n, requested: count,
    capacity: cols * rows, rot, sheetW, sheetH, util, partW: bb.w, partH: bb.h,
  };
}
