// @ts-check
// Z-map (campo di altezza a valore singolo Z(x,y)) — rappresentazione ESATTA e
// sufficiente dello stock per il 3-assi (nessun undercut: l'asse utensile è +Z).
// Le quote sono ai NODI (angoli cella): triangolare i quad usa direttamente i
// vertici. Carve = min per nodo sotto l'impronta utensile → monotono decrescente,
// quindi intrinsecamente incrementale e forward-only (riavvolgere = reset+recarve).

import { footprint } from './tool.js';

export class Heightmap {
  /**
   * @param {number} x0 @param {number} y0 origine (angolo min)
   * @param {number} dx @param {number} dy passo cella (mm)
   * @param {number} nx @param {number} ny numero di CELLE per lato
   * @param {number} zTop @param {number} zBottom quote stock
   */
  constructor(x0, y0, dx, dy, nx, ny, zTop, zBottom) {
    this.x0 = x0; this.y0 = y0; this.dx = dx; this.dy = dy;
    this.nx = nx; this.ny = ny;
    this.nnx = nx + 1; this.nny = ny + 1;          // nodi per lato
    this.zTop = zTop; this.zBottom = zBottom;
    this.z = new Float64Array(this.nnx * this.nny);
    this.z.fill(zTop);
    this.resetDirty();
  }

  /** Riporta lo stock intero (per lo scrub all'indietro). */
  reset() { this.z.fill(this.zTop); this.resetDirty(); }

  resetDirty() { this.dMinI = Infinity; this.dMaxI = -Infinity; this.dMinJ = Infinity; this.dMaxJ = -Infinity; }
  get dirty() { return this.dMaxI >= this.dMinI; }

  /**
   * Imprime l'impronta dell'utensile con punta a (cx,cy,zTip): abbassa i nodi
   * nella finestra [cx±R, cy±R]. Aggiorna la bounding box "dirty" delle celle
   * modificate (per re-triangolazione parziale e highlight "appena tagliato").
   * @param {import('./tool.js').Tool} tool
   */
  stamp(tool, cx, cy, zTip) {
    const R = tool.r;
    let i0 = Math.floor((cx - R - this.x0) / this.dx);
    let i1 = Math.ceil((cx + R - this.x0) / this.dx);
    let j0 = Math.floor((cy - R - this.y0) / this.dy);
    let j1 = Math.ceil((cy + R - this.y0) / this.dy);
    if (i0 < 0) i0 = 0; if (i1 > this.nnx - 1) i1 = this.nnx - 1;
    if (j0 < 0) j0 = 0; if (j1 > this.nny - 1) j1 = this.nny - 1;
    const zB = this.zBottom;
    for (let j = j0; j <= j1; j++) {
      const py = this.y0 + j * this.dy;
      const row = j * this.nnx;
      for (let i = i0; i <= i1; i++) {
        const px = this.x0 + i * this.dx;
        const d = Math.hypot(px - cx, py - cy);
        const fp = footprint(tool, d);
        if (fp === Infinity) continue;
        let z = zTip + fp;
        if (z < zB) z = zB;                 // non oltre il fondo dello stock
        const k = row + i;
        if (z < this.z[k]) {
          this.z[k] = z;
          if (i < this.dMinI) this.dMinI = i; if (i > this.dMaxI) this.dMaxI = i;
          if (j < this.dMinJ) this.dMinJ = j; if (j > this.dMaxJ) this.dMaxJ = j;
        }
      }
    }
  }

  /** Volume asportato rispetto allo stock pieno (somma per cella, quote medie ai 4 nodi). */
  removedVolume() {
    let v = 0;
    const cellA = this.dx * this.dy;
    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++) {
        const a = j * this.nnx + i;
        const zAvg = (this.z[a] + this.z[a + 1] + this.z[a + this.nnx] + this.z[a + this.nnx + 1]) / 4;
        v += (this.zTop - zAvg) * cellA;
      }
    }
    return v;
  }
}
