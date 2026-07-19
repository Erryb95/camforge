// @ts-check
// Driver di simulazione asportazione a base TRI-DEXEL (4/5 assi): stesso schema
// di MaterialSim (cursore in mm lungo il percorso, forward-only, scrub=reset) ma
// carve del solido utensile ORIENTATO nei tre fasci di dexel. L'asse utensile è
// per ora +Z costante (3-assi corretto con undercut/pareti nette); per il 5-assi
// basterà fornire `toolAxis` per campione (da B/C o vettori IJK del G-code).

import { detectTool } from './materialsim.js';
import { TriDexel } from './tridexel.js';

/** Bounding box dei soli segmenti di taglio (fallback: tutti). @returns {{lo:number[],hi:number[]}|null} */
function cutBounds(model) {
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  const add = (p) => { for (let a = 0; a < 3; a++) { const v = [p.x, p.y, p.z][a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; } };
  let any = false;
  for (const s of model.segments) { if (s.type === 'rapid') continue; any = true; for (const p of (s.pts && s.pts.length ? s.pts : [s.from, s.to])) add(p); }
  if (!any) for (const s of model.segments) for (const p of (s.pts && s.pts.length ? s.pts : [s.from, s.to])) add(p);
  return mn[0] === Infinity ? null : { lo: mn, hi: mx };
}

function cumLen(pts) {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z));
  return c;
}
function pointAt(pts, cum, s) {
  const total = cum[cum.length - 1];
  if (s <= 0 || total <= 1e-12) return pts[0];
  if (s >= total) return pts[pts.length - 1];
  let i = 1; while (i < cum.length && cum[i] < s) i++;
  const t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
  const a = pts[i - 1], b = pts[i];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

export class MaterialSim5 {
  /**
   * @param {import('../core/model.js').SceneModel} model
   * @param {{tool?:any, cell?:number, cellsTarget?:number, margin?:number, allowance?:number, toolAxis?:number[]}} [opts]
   */
  constructor(model, opts = {}) {
    this.model = model;
    const t = opts.tool || detectTool(model);
    this.tool = { r: (t.diameter > 0 ? t.diameter : 6) / 2, type: t.type === 'ball' ? 'ball' : 'flat' };
    const b = cutBounds(model);
    if (!b) { this.ok = false; return; }
    const w = b.hi[0] - b.lo[0], h = b.hi[1] - b.lo[1];
    const margin = opts.margin ?? Math.max(2, 0.05 * Math.max(w, h));
    const allowance = opts.allowance ?? 1;
    this._box = {
      lo: [b.lo[0] - margin, b.lo[1] - margin, b.lo[2] - 0.5],
      hi: [b.hi[0] + margin, b.hi[1] + margin, b.hi[2] + allowance],
    };
    const maxDim = Math.max(this._box.hi[0] - this._box.lo[0], this._box.hi[1] - this._box.lo[1]);
    this._cell = opts.cell ?? maxDim / (opts.cellsTarget ?? 90);
    this.td = new TriDexel(this._box, this._cell);
    this.ok = true;
    this.toolAxis = opts.toolAxis || [0, 0, 1];
    this.fiveAxis = !!opts.fiveAxis;         // true = usa l'asse utensile per-segmento (4/5 assi)
    this._total = model.segments.reduce((a, s) => a + (s.len || 0), 0);
    this._mesh = null; this._dirty = true;
    this._resetCursor();
  }

  _resetCursor() { this.cursor = 0; this.segIdx = 0; this.segPos = 0; }
  reset() { this.td = new TriDexel(this._box, this._cell); this._resetCursor(); this._dirty = true; }
  get total() { return this._total; }

  /** Carve fino alla lunghezza percorsa `lenMm` (null = tutto). @returns {boolean} cambiato */
  carveTo(lenMm) {
    if (!this.ok) return false;
    const target = lenMm == null ? this._total : lenMm;
    if (target < this.cursor - 1e-9) this.reset();
    const segs = this.model.segments;
    const spacing = Math.min(this.td.d[0], this.td.d[1], this.td.d[2]) / 2;
    let changed = false, guard = 0;
    while (this.cursor < target - 1e-9 && this.segIdx < segs.length && guard++ < 1e7) {
      const seg = segs[this.segIdx];
      // 4/5 assi: asse utensile dal G-code (seg.toolAxis); altrimenti +Z (3 assi)
      const U = (this.fiveAxis && seg.toolAxis) ? seg.toolAxis : this.toolAxis;
      const segLen = seg.len || 0;
      const step = Math.min(segLen - this.segPos, target - this.cursor);
      if (seg.type !== 'rapid' && segLen > 1e-9 && step > 1e-9) {
        const pts = seg.pts && seg.pts.length >= 2 ? seg.pts : [seg.from, seg.to];
        const cum = cumLen(pts);
        const scale = (cum[cum.length - 1] || segLen) / segLen;
        const a = this.segPos, b = this.segPos + step;
        const n = Math.max(1, Math.ceil((b - a) / spacing));
        for (let k = 0; k <= n; k++) {
          const p = pointAt(pts, cum, (a + ((b - a) * k) / n) * scale);
          this.td.carve([p.x, p.y, p.z], U, this.tool);
        }
        changed = true;
      }
      this.cursor += step; this.segPos += step;
      if (this.segPos >= segLen - 1e-9) { this.segIdx++; this.segPos = 0; }
    }
    this.cursor = target;
    if (changed) this._dirty = true;
    return changed;
  }

  mesh() {
    if (!this.ok) return null;
    if (this._dirty || !this._mesh) { this._mesh = this.td.toMesh(); this._dirty = false; }
    return this._mesh;
  }
}
