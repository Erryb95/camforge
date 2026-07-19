// @ts-check
// Orchestratore della simulazione di asportazione: percorre i segmenti del
// programma con un cursore in mm (allineato all'avanzamento della simulazione
// del viewer, rapidi INCLUSI nel conteggio ma non nel taglio) e imprime
// l'impronta dell'utensile sulla Z-map. Forward-only; scrub all'indietro = reset
// e re-carve dallo zero. Espone la mesh {positions,indices,fresh} per il renderer.

import { makeTool } from './tool.js';
import { stockFromModel } from './stock.js';
import { heightmapToMesh } from './mesh.js';

/** Euristica utensile dai commenti del file (fallback: flat Ø6). @param {any} model */
export function detectTool(model) {
  const head = (model.rawLines || []).slice(0, 150).join('\n');
  let m = head.match(/(\d+(?:\.\d+)?)\s*mm\s*ball/i) || head.match(/ball[\s-]*nose[^0-9]*(\d+(?:\.\d+)?)/i);
  if (m) return { type: 'ball', diameter: +m[1] };
  if (/ball[\s-]*(nose|end|mill)/i.test(head)) return { type: 'ball', diameter: 6 };
  m = head.match(/(?:cutter|tool|end\s*mill|endmill|diameter|dia|Ø|D)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*mm/i);
  if (m) return { type: 'flat', diameter: +m[1] };
  return { type: 'flat', diameter: 6 };
}

/** Lunghezze cumulate 3D della polilinea di un segmento. */
function cumLen(pts) {
  const c = [0];
  for (let i = 1; i < pts.length; i++) {
    c.push(c[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z));
  }
  return c;
}

/** Punto alla ascissa curvilinea s (mm) lungo la polilinea (cum precalcolato). */
function pointAt(pts, cum, s) {
  const total = cum[cum.length - 1];
  if (s <= 0 || total <= 1e-12) return pts[0];
  if (s >= total) return pts[pts.length - 1];
  let i = 1;
  while (i < cum.length && cum[i] < s) i++;
  const t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
  const a = pts[i - 1], b = pts[i];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

export class MaterialSim {
  /**
   * @param {import('../core/model.js').SceneModel} model
   * @param {{tool?:any, stock?:any}} [opts]
   */
  constructor(model, opts = {}) {
    this.model = model;
    this.tool = makeTool(opts.tool || detectTool(model));
    this.hm = stockFromModel(model, opts.stock);
    this.ok = !!this.hm;
    this._total = model.segments.reduce((a, s) => a + (s.len || 0), 0);
    this._mesh = null;
    this._meshDirty = true;
    this._resetCursor();
  }

  _resetCursor() { this.cursor = 0; this.segIdx = 0; this.segPos = 0; }
  reset() { if (this.hm) this.hm.reset(); this._resetCursor(); this._meshDirty = true; }
  get total() { return this._total; }

  /**
   * Carve fino alla lunghezza percorsa `lenMm` (null/undefined = tutto).
   * @returns {boolean} true se qualcosa è stato asportato (mesh da ricostruire)
   */
  carveTo(lenMm) {
    if (!this.hm) return false;
    const target = lenMm == null ? this._total : lenMm;
    if (target < this.cursor - 1e-9) this.reset();
    const segs = this.model.segments;
    const spacing = Math.min(this.hm.dx, this.hm.dy) / 2;
    let changed = false;
    let guard = 0;
    while (this.cursor < target - 1e-9 && this.segIdx < segs.length && guard++ < 1e7) {
      const seg = segs[this.segIdx];
      const segLen = seg.len || 0;
      const remain = segLen - this.segPos;
      const step = Math.min(remain, target - this.cursor);
      if (seg.type !== 'rapid' && segLen > 1e-9 && step > 1e-9) {
        const pts = seg.pts && seg.pts.length >= 2 ? seg.pts : [seg.from, seg.to];
        const cum = cumLen(pts);
        const scale = (cum[cum.length - 1] || segLen) / segLen;   // len polilinea vs seg.len
        const a = this.segPos, b = this.segPos + step;
        const n = Math.max(1, Math.ceil((b - a) / spacing));
        for (let k = 0; k <= n; k++) {
          const s = a + ((b - a) * k) / n;
          const p = pointAt(pts, cum, s * scale);
          this.hm.stamp(this.tool, p.x, p.y, p.z);
        }
        changed = true;
      }
      this.cursor += step;
      this.segPos += step;
      if (this.segPos >= segLen - 1e-9) { this.segIdx++; this.segPos = 0; }
    }
    this.cursor = target;
    if (changed) this._meshDirty = true;
    return changed;
  }

  /** Mesh corrente (ricostruita se serve); azzera la dirty-box dopo la build. */
  mesh() {
    if (!this.hm) return null;
    if (this._meshDirty || !this._mesh) {
      this._mesh = heightmapToMesh(this.hm);
      this.hm.resetDirty();
      this._meshDirty = false;
    }
    return this._mesh;
  }
}
