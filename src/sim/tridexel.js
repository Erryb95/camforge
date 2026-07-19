// @ts-check
// Motore TRI-DEXEL per asportazione materiale 4/5 assi (undercut, utensile
// orientato). Adattato da bernhardmgruber/tridexel (BSL-1.0): lì il tri-dexel è
// una RICOSTRUZIONE di superficie da un oracolo di raycast; qui i tre fasci di
// dexel SONO la rappresentazione dello stock, e la rimozione è una sottrazione
// di intervalli lungo ciascun fascio.
//
//   Campo a ∈ {0=X,1=Y,2=Z}: raggi paralleli all'asse a su una griglia dei due
//   assi perpendicolari; ogni raggio è una lista ORDINATA di intervalli solidi
//   [s0,e0, s1,e1, …] (coord mondo lungo a). Undercut/pareti verticali sono
//   rappresentati esattamente (intervalli multipli / campi ⟂). Celle ~cubiche
//   (risoluzione per-asse). Ricostruzione: surface nets (mesh {positions,indices}).

/** Sottrae l'intervallo [a,b] dalla lista ordinata `iv` ([s0,e0,...]). */
export function subtractInterval(iv, a, b) {
  if (b <= a) return iv;
  const out = [];
  for (let k = 0; k < iv.length; k += 2) {
    const s = iv[k], e = iv[k + 1];
    if (b <= s || a >= e) { out.push(s, e); continue; }
    if (a > s) out.push(s, a);
    if (b < e) out.push(b, e);
  }
  return out;
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Intervallo del raggio (origine O, direzione = +asse `axisA`) dentro il solido
 * utensile (semi-infinito verso +U). Restituisce [dLo,dHi] in coordinata mondo
 * lungo axisA, oppure null.
 * @param {number[]} O @param {number} axisA @param {number[]} tip @param {number[]} U
 * @param {{r:number, type:'flat'|'ball'}} tool
 */
export function rayToolInterval(O, axisA, tip, U, tool) {
  const W = [O[0] - tip[0], O[1] - tip[1], O[2] - tip[2]];
  const D = [0, 0, 0]; D[axisA] = 1;
  const hu = dot(D, U), h0 = dot(W, U);
  const Wp = [W[0] - h0 * U[0], W[1] - h0 * U[1], W[2] - h0 * U[2]];
  const Dp = [D[0] - hu * U[0], D[1] - hu * U[1], D[2] - hu * U[2]];
  const R = tool.r;
  const A = dot(Dp, Dp), B = 2 * dot(Wp, Dp), Cc = dot(Wp, Wp) - R * R;
  let tc1 = -Infinity, tc2 = Infinity;
  if (A > 1e-12) {
    const disc = B * B - 4 * A * Cc;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    tc1 = (-B - sq) / (2 * A); tc2 = (-B + sq) / (2 * A);
  } else if (dot(Wp, Wp) > R * R) {
    return null;
  }
  const emit = (lo, hi) => (hi > lo ? [O[axisA] + lo, O[axisA] + hi] : null);

  if (tool.type === 'flat') {
    let th1 = -Infinity, th2 = Infinity;
    if (Math.abs(hu) > 1e-12) { const th = -h0 / hu; if (hu > 0) th1 = th; else th2 = th; }
    else if (h0 < 0) return null;
    return emit(Math.max(tc1, th1), Math.min(tc2, th2));
  }
  // ball: sfera(C = tip + R·U, R)  ∪  cilindro con h ≥ R
  const C = [tip[0] + R * U[0], tip[1] + R * U[1], tip[2] + R * U[2]];
  const Wc = [O[0] - C[0], O[1] - C[1], O[2] - C[2]];
  const b2 = 2 * dot(Wc, D), c2 = dot(Wc, Wc) - R * R;
  let sLo = Infinity, sHi = -Infinity;
  const disc2 = b2 * b2 - 4 * c2;
  if (disc2 >= 0) { const s = Math.sqrt(disc2); sLo = (-b2 - s) / 2; sHi = (-b2 + s) / 2; }
  let ch1 = tc1, ch2 = tc2;
  if (Math.abs(hu) > 1e-12) { const th = (R - h0) / hu; if (hu > 0) ch1 = Math.max(ch1, th); else ch2 = Math.min(ch2, th); }
  else if (h0 < R) { ch1 = Infinity; ch2 = -Infinity; }
  let lo = Infinity, hi = -Infinity;
  if (sHi > sLo) { lo = Math.min(lo, sLo); hi = Math.max(hi, sHi); }
  if (ch2 > ch1) { lo = Math.min(lo, ch1); hi = Math.max(hi, ch2); }
  return emit(lo, hi);
}

export class TriDexel {
  /**
   * @param {{lo:number[], hi:number[]}} box  (lo/hi = [x,y,z])
   * @param {number} cell  dimensione cella target (mm) → risoluzione per-asse (celle ~cubiche)
   */
  constructor(box, cell) {
    // bordi del SOLIDO (stock). La griglia è più grande di 1 cella per lato: serve un
    // anello di nodi VUOTI attorno al blocco, altrimenti un blocco pieno che tocca la
    // griglia non genera facce di confine (surface nets) → grezzo INVISIBILE.
    const blo = box.lo.slice(), bhi = box.hi.slice();
    this.blo = blo; this.bhi = bhi;
    this.lo = [0, 1, 2].map((a) => blo[a] - cell);
    this.hi = [0, 1, 2].map((a) => bhi[a] + cell);
    // nodi per asse (≥2); celle = N-1
    this.Nn = [0, 1, 2].map((a) => Math.max(2, Math.round((this.hi[a] - this.lo[a]) / cell) + 1));
    this.d = [0, 1, 2].map((a) => (this.hi[a] - this.lo[a]) / (this.Nn[a] - 1));
    // 3 campi: fields[a] = griglia Nn[a1]×Nn[a2] di intervalli, raggi ∥ asse a.
    // Ogni raggio parte pieno = [blo[a],bhi[a]] SOLO se la sua posizione perpendicolare
    // cade dentro la sezione del blocco; i raggi dell'anello di padding partono VUOTI.
    this.fields = [0, 1, 2].map((a) => {
      const a1 = (a + 1) % 3, a2 = (a + 2) % 3;
      const arr = new Array(this.Nn[a1] * this.Nn[a2]);
      for (let v = 0; v < this.Nn[a2]; v++) {
        for (let u = 0; u < this.Nn[a1]; u++) {
          const p1 = this.lo[a1] + u * this.d[a1], p2 = this.lo[a2] + v * this.d[a2];
          const inside = p1 >= blo[a1] - 1e-9 && p1 <= bhi[a1] + 1e-9 && p2 >= blo[a2] - 1e-9 && p2 <= bhi[a2] + 1e-9;
          arr[v * this.Nn[a1] + u] = inside ? [blo[a], bhi[a]] : [];
        }
      }
      return arr;
    });
  }

  _idx(a, u, v) { return v * this.Nn[(a + 1) % 3] + u; }

  _origin(a, u, v) {
    const a1 = (a + 1) % 3, a2 = (a + 2) % 3;
    const O = [0, 0, 0];
    O[a] = this.lo[a];
    O[a1] = this.lo[a1] + u * this.d[a1];
    O[a2] = this.lo[a2] + v * this.d[a2];
    return O;
  }

  /**
   * Asporta il solido utensile in posa (tip, U). Sottrae ray∩tool dai tre campi.
   * @param {number[]} tip @param {number[]} U (unità) @param {{r:number,type:'flat'|'ball'}} tool
   */
  carve(tip, U, tool) {
    const reach = tool.r * 1.02;
    for (let a = 0; a < 3; a++) {
      const a1 = (a + 1) % 3, a2 = (a + 2) % 3;
      // bbox perp dei raggi: disco di raggio R attorno alla punta, ESTESO lungo la
      // proiezione dell'asse utensile (semi-infinito verso +U → arriva al bordo box)
      const rng = (c) => {
        let cmin = tip[c] - reach, cmax = tip[c] + reach;
        if (U[c] > 1e-6) cmax = this.hi[c];
        else if (U[c] < -1e-6) cmin = this.lo[c];
        return [
          Math.max(0, Math.floor((cmin - this.lo[c]) / this.d[c])),
          Math.min(this.Nn[c] - 1, Math.ceil((cmax - this.lo[c]) / this.d[c])),
        ];
      };
      const [u0, u1] = rng(a1);
      const [v0, v1] = rng(a2);
      const F = this.fields[a];
      for (let v = v0; v <= v1; v++) {
        for (let u = u0; u <= u1; u++) {
          const cut = rayToolInterval(this._origin(a, u, v), a, tip, U, tool);
          if (!cut) continue;
          const k = this._idx(a, u, v);
          F[k] = subtractInterval(F[k], cut[0], cut[1]);
        }
      }
    }
  }

  /** true se il punto (coord mondo) è dentro il solido (test sul campo Z). */
  insideAt(x, y, z) {
    const u = Math.round((x - this.lo[0]) / this.d[0]);
    const v = Math.round((y - this.lo[1]) / this.d[1]);
    if (u < 0 || v < 0 || u >= this.Nn[0] || v >= this.Nn[1]) return false;
    const iv = this.fields[2][this._idx(2, u, v)];
    for (let k = 0; k < iv.length; k += 2) if (z >= iv[k] && z <= iv[k + 1]) return true;
    return false;
  }

  /** Volume solido residuo (campo Z: Σ lunghezze intervalli × area cella XY). */
  solidVolume() {
    let len = 0;
    for (const iv of this.fields[2]) for (let k = 0; k < iv.length; k += 2) len += iv[k + 1] - iv[k];
    return len * this.d[0] * this.d[1];
  }

  /**
   * Ricostruisce la mesh di superficie (surface nets sull'occupancy ai nodi):
   * un vertice per cella bipolare, posizionato sulla media dei crossing ESATTI
   * (endpoint dexel) sugli spigoli; quad duali sugli spigoli di griglia bipolari.
   * Gestisce gli undercut (rappresentazione 3D piena). @returns {{positions:Float64Array, indices:Uint32Array}}
   */
  toMesh() {
    const [Nx, Ny, Nz] = this.Nn;
    const [dx, dy, dz] = this.d, [lox, loy, loz] = this.lo;
    const nid = (i, j, k) => (k * Ny + j) * Nx + i;
    // occupancy ai nodi (test sul campo Z)
    const occ = new Uint8Array(Nx * Ny * Nz);
    for (let j = 0; j < Ny; j++) {
      for (let i = 0; i < Nx; i++) {
        const iv = this.fields[2][j * Nx + i];
        if (iv.length === 0) continue;
        for (let k = 0; k < Nz; k++) {
          const z = loz + k * dz;
          for (let m = 0; m < iv.length; m += 2) if (z >= iv[m] - 1e-9 && z <= iv[m + 1] + 1e-9) { occ[nid(i, j, k)] = 1; break; }
        }
      }
    }
    // crossing esatto sullo spigolo dal nodo (i,j,k) lungo l'asse ax
    const idxArr = [0, 0, 0];
    const crossing = (i, j, k, ax) => {
      idxArr[0] = i; idxArr[1] = j; idxArr[2] = k;
      const a1 = (ax + 1) % 3, a2 = (ax + 2) % 3;
      const iv = this.fields[ax][idxArr[a2] * this.Nn[a1] + idxArr[a1]];
      const lo = this.lo[ax] + idxArr[ax] * this.d[ax], hi = lo + this.d[ax];
      for (let m = 0; m < iv.length; m += 2) {
        if (iv[m] > lo - 1e-9 && iv[m] < hi + 1e-9) return iv[m];
        if (iv[m + 1] > lo - 1e-9 && iv[m + 1] < hi + 1e-9) return iv[m + 1];
      }
      return (lo + hi) / 2;
    };

    const EDGES = [ // [c0,c1,axis], corner bit = i + 2j + 4k
      [0, 1, 0], [2, 3, 0], [4, 5, 0], [6, 7, 0],
      [0, 2, 1], [1, 3, 1], [4, 6, 1], [5, 7, 1],
      [0, 4, 2], [1, 5, 2], [2, 6, 2], [3, 7, 2],
    ];
    const CORN = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
    const Cx = Nx - 1, Cy = Ny - 1, Cz = Nz - 1;
    const cid = (i, j, k) => (k * Cy + j) * Cx + i;
    const cellVtx = new Int32Array(Cx * Cy * Cz).fill(-1);
    /** @type {number[]} */ const pos = [];
    for (let k = 0; k < Cz; k++) {
      for (let j = 0; j < Cy; j++) {
        for (let i = 0; i < Cx; i++) {
          let mask = 0;
          for (let c = 0; c < 8; c++) if (occ[nid(i + CORN[c][0], j + CORN[c][1], k + CORN[c][2])]) mask |= 1 << c;
          if (mask === 0 || mask === 0xff) continue;
          let sx = 0, sy = 0, sz = 0, n = 0;
          for (const [c0, c1, ax] of EDGES) {
            if (((mask >> c0) & 1) === ((mask >> c1) & 1)) continue;
            const b = CORN[c0];
            const gi = i + b[0], gj = j + b[1], gk = k + b[2];
            const px = lox + gi * dx, py = loy + gj * dy, pz = loz + gk * dz;
            const cr = crossing(gi, gj, gk, ax);
            sx += ax === 0 ? cr : px; sy += ax === 1 ? cr : py; sz += ax === 2 ? cr : pz; n++;
          }
          cellVtx[cid(i, j, k)] = pos.length / 3;
          pos.push(sx / n, sy / n, sz / n);
        }
      }
    }

    /** @type {number[]} */ const tri = [];
    const quad = (a, b, c, d, flip) => {
      if (a < 0 || b < 0 || c < 0 || d < 0) return;
      if (flip) tri.push(a, b, c, a, c, d); else tri.push(a, d, c, a, c, b);
    };
    for (let k = 0; k < Nz; k++) {
      for (let j = 0; j < Ny; j++) {
        for (let i = 0; i < Nx; i++) {
          const o = occ[nid(i, j, k)];
          if (i < Cx && j >= 1 && k >= 1 && o !== occ[nid(i + 1, j, k)])
            quad(cellVtx[cid(i, j - 1, k - 1)], cellVtx[cid(i, j, k - 1)], cellVtx[cid(i, j, k)], cellVtx[cid(i, j - 1, k)], o === 1);
          if (j < Cy && i >= 1 && k >= 1 && o !== occ[nid(i, j + 1, k)])
            quad(cellVtx[cid(i - 1, j, k - 1)], cellVtx[cid(i, j, k - 1)], cellVtx[cid(i, j, k)], cellVtx[cid(i - 1, j, k)], o !== 1);
          if (k < Cz && i >= 1 && j >= 1 && o !== occ[nid(i, j, k + 1)])
            quad(cellVtx[cid(i - 1, j - 1, k)], cellVtx[cid(i, j - 1, k)], cellVtx[cid(i, j, k)], cellVtx[cid(i - 1, j, k)], o === 1);
        }
      }
    }
    return { positions: new Float64Array(pos), indices: new Uint32Array(tri) };
  }
}
