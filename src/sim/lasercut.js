// @ts-check
// Motore di visualizzazione TAGLIO LASER LAMIERA (asportazione = kerf attraverso
// lo spessore + separazione dei pezzi a contorno chiuso). NON è volume rimosso da
// utensile (quello è la fresatura): il laser incide una fessura sottile e i pezzi/
// fori racchiusi si STACCANO. Riusa Clipper (offsetOpen/cutRegions) + earcut.
//
//   1. contorni dal G-code (polilinee XY, chiuse se end≈start), con startLen/endLen;
//   2. kerf swath = offsetOpen(contorno, kerf/2) → bande da sottrarre;
//   3. cutRegions(blank, swaths) → materiale residuo (telaio sfrido + pezzo + slug);
//   4. ogni regione separata (non-telaio) si stacca al separatingDist = endLen del
//      contorno che la delimita (drop/fade in fase di render).

import { offsetOpen, cutRegions } from '../loaders/cad/offset.js';
import { extrudeRegion } from './triangulate.js';

const EPS_CLOSE = 0.2;   // mm: soglia chiusura contorno (tolleranza lead-in/tessellazione)

function centroid(ring) {
  let x = 0, y = 0;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / ring.length, y / ring.length];
}
function bbox(ring) {
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (const [x, y] of ring) { if (x < mnx) mnx = x; if (y < mny) mny = y; if (x > mxx) mxx = x; if (y > mxy) mxy = y; }
  return [mnx, mny, mxx, mxy];
}
function ringArea(ring) {   // area assoluta (shoelace)
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return Math.abs(a / 2);
}

/**
 * Estrae i contorni di taglio (polilinee 2D) dai segmenti, con lunghezze cumulate
 * (3D, per l'avanzamento). Un contorno è "chiuso" se il punto finale ritorna vicino
 * a uno precedente (i rapidi spezzano i contorni). `ptOf(seg)` estrae i punti 2D:
 * default = (x,y) del pezzo; per il tubo = (u,v) dello svolto.
 * @param {import('../core/model.js').SceneModel} model
 * @param {(seg:any)=>number[][]} [ptOf]
 */
export function extractContours(model, ptOf) {
  const get = ptOf || ((seg) => (seg.pts && seg.pts.length >= 2 ? seg.pts : [seg.from, seg.to]).map((p) => [p.x, p.y]));
  /** @type {{pts:number[][], closed:boolean, startLen:number, endLen:number}[]} */
  const contours = [];
  let cur = null, len = 0;
  const flush = () => {
    if (cur && cur.pts.length >= 2) {
      // il punto finale ritorna vicino a un punto precedente = inizio del LOOP di
      // taglio; tutto ciò che precede è lead-in/trasferimento (laser spento)
      const last = cur.pts[cur.pts.length - 1];
      let closed = false, loopStart = 0;
      for (let i = 0; i < cur.pts.length - 2; i++) {
        if (Math.hypot(cur.pts[i][0] - last[0], cur.pts[i][1] - last[1]) < EPS_CLOSE) { closed = true; loopStart = i; break; }
      }
      cur.closed = closed;
      cur.loopStart = loopStart;
      cur.endLen = len;
      contours.push(cur);
    }
    cur = null;
  };
  for (const seg of model.segments) {
    if (seg.type === 'rapid') { flush(); len += seg.len || 0; continue; }
    const pp = get(seg);
    if (pp.length >= 1) {
      // il cambio di BLOCCO operazione (N, dialetto tubo) chiude il contorno:
      // separa troncature/fori quando il percorso è continuo (senza rapidi)
      if (cur && cur.block !== undefined && seg.block !== undefined && seg.block !== cur.block) flush();
      if (!cur) cur = { pts: [pp[0]], closed: false, startLen: len, endLen: len, block: seg.block };
      for (let i = 1; i < pp.length; i++) cur.pts.push(pp[i]);
    }
    len += seg.len || 0;
  }
  flush();
  return { contours, total: len };
}

export class LaserSheetSim {
  /**
   * @param {import('../core/model.js').SceneModel} model
   * @param {{kerf?:number, thickness?:number, margin?:number}} [opts]
   */
  constructor(model, opts = {}) {
    this.model = model;
    this.kerf = opts.kerf ?? 0.2;               // larghezza kerf (mm)
    this.thickness = opts.thickness ?? 2;
    this.margin = opts.margin ?? 10;            // sfrido attorno al pezzo (telaio)
    const ex = extractContours(model);
    this.contours = ex.contours;
    this.total = ex.total;
    this.ready = false;
    /** @type {{mesh:any, sep:number, isFrame:boolean, cen:number[]}[]} */
    this.regions = [];
    this.ok = this.contours.length > 0 && !!model.bounds;
  }

  /** Precalcolo asincrono (Clipper): blank − kerf → regioni estruse + separatingDist. */
  async precompute() {
    if (!this.ok) return this;
    const b = this.model.bounds;
    const m = this.margin;
    const blank = [[[b.min.x - m, b.min.y - m], [b.max.x + m, b.min.y - m], [b.max.x + m, b.max.y + m], [b.min.x - m, b.max.y + m]]];
    // swath di ogni contorno (chiusi e aperti: il kerf incide comunque)
    const swaths = [];
    for (const c of this.contours) {
      const s = await offsetOpen([c.pts], this.kerf / 2, { cap: 'round', join: 'round' });
      for (const poly of s) swaths.push(poly);
    }
    const regions = await cutRegions(blank, swaths);
    const blankBB = [b.min.x - m, b.min.y - m, b.max.x + m, b.max.y + m];
    const diag = Math.hypot(blankBB[2] - blankBB[0], blankBB[3] - blankBB[1]) || 1;
    // contorni chiusi = quelli che delimitano una regione; con centroide+area per il match
    const closed = this.contours.filter((c) => c.closed).map((c) => ({ endLen: c.endLen, cen: centroid(c.pts), area: ringArea(c.pts) }));
    this.regions = regions.map((r) => {
      const bb = bbox(r.outer);
      const isFrame = Math.abs(bb[0] - blankBB[0]) < 1 && Math.abs(bb[2] - blankBB[2]) < 1 && Math.abs(bb[1] - blankBB[1]) < 1;
      const cen = centroid(r.outer);
      // separatingDist = endLen del contorno che forma il BORDO ESTERNO della regione:
      // match per AREA (distingue pezzo Ø grande dal foro piccolo) + centroide
      let sep = Infinity;
      if (!isFrame && closed.length) {
        const areaR = ringArea(r.outer);
        let best = Infinity;
        for (const c of closed) {
          const da = Math.abs(c.area - areaR) / Math.max(c.area, areaR, 1);
          const dc = Math.hypot(c.cen[0] - cen[0], c.cen[1] - cen[1]) / diag;
          const score = da + dc;
          if (score < best) { best = score; sep = c.endLen; }
        }
      }
      const mesh = extrudeRegion(r.outer, r.holes, 0, this.thickness);
      return { mesh, sep, isFrame, cen };
    });
    this.ready = true;
    return this;
  }

  /**
   * Mesh combinata allo stato `progress` (mm): i pezzi separati (sep ≤ progress)
   * cadono lungo −Z con fade. triTool: 1 = materiale, 2 = pezzo staccato.
   * @param {number|null} progress
   */
  meshAt(progress) {
    const prog = progress == null ? this.total + 1e6 : progress;   // fine = pezzi staccati (vista finale)
    const DROP = 25, MAXZ = 60;   // mm: rampa e caduta
    const parts = [];
    for (const reg of this.regions) {
      const rel = reg.isFrame ? -1 : (prog - reg.sep);
      const separated = rel >= 0;
      const drop = separated ? Math.min(1, rel / DROP) : 0;
      parts.push({ mesh: reg.mesh, dz: -drop * MAXZ, tool: separated ? 2 : 1 });
    }
    // fondi in un unico buffer
    let np = 0, ni = 0;
    for (const p of parts) { np += p.mesh.positions.length; ni += p.mesh.indices.length; }
    const positions = new Float64Array(np), indices = new Uint32Array(ni), triTool = new Uint32Array(ni / 3);
    let po = 0, io = 0, to = 0;
    for (const p of parts) {
      const base = po / 3;
      for (let i = 0; i < p.mesh.positions.length; i += 3) {
        positions[po + i] = p.mesh.positions[i];
        positions[po + i + 1] = p.mesh.positions[i + 1];
        positions[po + i + 2] = p.mesh.positions[i + 2] + p.dz;
      }
      for (let i = 0; i < p.mesh.indices.length; i++) indices[io + i] = p.mesh.indices[i] + base;
      for (let i = 0; i < p.mesh.indices.length / 3; i++) triTool[to + i] = p.tool;
      po += p.mesh.positions.length; io += p.mesh.indices.length; to += p.mesh.indices.length / 3;
    }
    return { positions, indices, triTool };
  }
}
