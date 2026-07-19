// @ts-check
// Motore TAGLIO LASER TUBO. A differenza della lamiera (piana), la parete del tubo
// è CURVA: mappare una regione 2D con pochi vertici la fa collassare. Perciò qui:
//  - il tubo è diviso in SEGMENTI ASSIALI dalle TRONCATURE (tagli a giro completo),
//    ciascuno costruito con buildTubeMesh (rende il tubo con parete, già corretto);
//    il PEZZO tra due troncature si STACCA e scorre lungo l'asse quando è libero;
//  - ogni FINESTRA/foro nella parete è uno slug che fa POP radiale al completamento
//    del suo contorno (estruso avvolgendo la sezione).
// Le operazioni (troncature/fori) sono separate dai BLOCCHI N (il percorso tubo è
// continuo, senza rapidi) → extractContours spezza sul cambio blocco.

import { extractContours } from './lasercut.js';
import { extrudeRegionMapped } from './triangulate.js';
import { buildTubeMesh } from '../loaders/cad/tube3d.js';
import { profileFromMeta } from '../core/unroll.js';

/** Inverso perimetro → punto sezione (y,z) + normale esterna (ny,nz). Vedi lasertube. */
export function vToSection(v, profile) {
  const per = profile.per;
  if (profile.type === 'round') {
    const t = ((v % per) + per + per / 2) % per - per / 2;
    const th = t / profile.r;
    return { y: profile.r * Math.sin(th), z: profile.r * Math.cos(th), ny: Math.sin(th), nz: Math.cos(th) };
  }
  const a = profile.w / 2, b = profile.h / 2;
  let t = ((v % per) + per) % per;
  if (t <= a) return { y: t, z: b, ny: 0, nz: 1 };
  t -= a; if (t <= 2 * b) return { y: a, z: b - t, ny: 1, nz: 0 };
  t -= 2 * b; if (t <= 2 * a) return { y: a - t, z: -b, ny: 0, nz: -1 };
  t -= 2 * a; if (t <= 2 * b) return { y: -a, z: -b + t, ny: -1, nz: 0 };
  t -= 2 * b; return { y: -a + t, z: b, ny: 0, nz: 1 };
}

/** Normale ESTERNA (2D nel piano sezione) al punto (y,z) del tubo. */
export function outwardNormalAt(y, z, profile) {
  if (profile.type === 'round') { const l = Math.hypot(y, z) || 1; return [y / l, z / l]; }
  const a = profile.w / 2, b = profile.h / 2;
  return (a - Math.abs(y)) < (b - Math.abs(z)) ? [Math.sign(y) || 1, 0] : [0, Math.sign(z) || 1];
}

function retool(mesh, tool) {
  const tt = new Uint32Array(mesh.indices.length / 3).fill(tool);
  return { positions: mesh.positions, indices: mesh.indices, triTool: tt };
}

export class LaserTubeSim {
  /** @param {import('../core/model.js').SceneModel} model @param {{kerf?:number, wall?:number}} [opts] */
  constructor(model, opts = {}) {
    this.model = model;
    this.kerf = opts.kerf ?? 0.3;
    this.wall = opts.wall ?? (model.meta && model.meta.thickness) ?? 2;
    this.profile = profileFromMeta(model.meta);
    this.ok = !!(model.meta && model.meta.unrollAvailable) && !!this.profile;
    this.ready = false;
    this.axials = [];   // segmenti tubo tra le troncature
    this.slugs = [];    // finestre/fori (pop radiale)
    this.total = model.segments.reduce((a, s) => a + (s.len || 0), 0);
  }

  precompute() {
    if (!this.ok) return this;
    const profile = /** @type {any} */ (this.profile);
    const per = profile.per;
    // v RIPIEGATO a [0,per): il contorno si chiude su sé stesso (loop isolato bene,
    // il lead-in/travel resta fuori); vToSection ripiega comunque per la geometria
    const ptOf = (seg) => (seg.uv ? seg.uv.map((q) => [q.u, ((q.v % per) + per) % per]) : []);
    const ex = extractContours(this.model, ptOf);
    this.contours = ex.contours;
    this.total = ex.total;

    let uMin = Infinity, uMax = -Infinity;
    for (const c of ex.contours) for (const [u] of c.pts) { if (u < uMin) uMin = u; if (u > uMax) uMax = u; }
    const margin = Math.max(8, 0.05 * (uMax - uMin));

    // classifica: troncature (giro completo a u≈const) vs finestre (contorni chiusi)
    const troncature = [];   // {u, endLen}
    const windows = [];      // {pts(u,v), endLen, vc}
    for (const c of ex.contours) {
      const loop = c.closed ? c.pts.slice(c.loopStart) : c.pts;   // solo il taglio, senza travel
      let umn = Infinity, umx = -Infinity, sx = 0, sy = 0;
      for (const [u, v] of loop) {
        if (u < umn) umn = u; if (u > umx) umx = u;
        const a = (((v % per) + per) % per) / per * 2 * Math.PI; sx += Math.cos(a); sy += Math.sin(a);
      }
      const R = Math.hypot(sx, sy) / loop.length;   // concentrazione angolare attorno alla sezione
      const vc = ((Math.atan2(sy, sx) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * per;
      // TRONCATURA = punti SPARSI attorno a tutta la sezione (R basso) a u≈const;
      // FORO/finestra = punti CONCENTRATI su una faccia (R alto)
      if (R < 0.4 && umx - umn < 0.2 * per) troncature.push({ u: (umn + umx) / 2, endLen: c.endLen });
      else if (c.closed) windows.push({ pts: loop, endLen: c.endLen, vc });
    }
    troncature.sort((p, q) => p.u - q.u);

    // divisioni assiali: estremi barra + posizioni troncature
    const cuts = [uMin - margin, ...troncature.map((t) => t.u), uMax + margin];
    for (let i = 0; i < cuts.length - 1; i++) {
      const uA = cuts[i], uB = cuts[i + 1];
      if (uB - uA < 0.5) continue;
      const isEnd = i === 0 || i === cuts.length - 2;   // estremità barra = sfrido, resta
      // il pezzo interno si libera quando entrambe le troncature ai suoi lati sono fatte
      const left = i - 1 >= 0 ? troncature[i - 1] : null;
      const right = i < troncature.length ? troncature[i] : null;
      const sep = isEnd ? Infinity : Math.max(left ? left.endLen : 0, right ? right.endLen : 0);
      this.axials.push({ uA, uB, sep, isEnd });
    }

    // slug finestre: estrusione avvolta della finestra sul tubo (pop radiale)
    const map = (u, v, side) => { const s = vToSection(v, profile); const off = side ? 0.15 : -this.wall - 0.15; return [u, s.y + off * s.ny, s.z + off * s.nz]; };
    for (const w of windows) {
      const mesh = extrudeRegionMapped(w.pts, [], map);
      const sc = vToSection(w.vc, profile);
      this.slugs.push({ mesh, sep: w.endLen, normal: [0, sc.ny, sc.nz] });
    }
    this.ready = true;
    return this;
  }

  meshAt(progress) {
    // a fine programma (null) i pezzi tagliati sono staccati del tutto (vista finale)
    const prog = progress == null ? this.total + 1e6 : progress;
    const profile = /** @type {any} */ (this.profile);
    const RAMP = 25, AXIAL = 240, RADIAL = 40;
    const parts = [];
    for (const a of this.axials) {
      const rel = a.sep === Infinity ? -1 : prog - a.sep;
      const f = rel >= 0 ? Math.min(1, rel / RAMP) : 0;
      const tube = buildTubeMesh(profile, a.uA, a.uB, this.wall);
      parts.push({ mesh: retool(tube, rel >= 0 ? 2 : 1), off: [f * AXIAL, 0, 0] });
    }
    for (const s of this.slugs) {
      const rel = prog - s.sep;
      const f = rel >= 0 ? Math.min(1, rel / RAMP) : 0;
      parts.push({ mesh: retool(s.mesh, rel >= 0 ? 2 : 1), off: [0, s.normal[1] * f * RADIAL, s.normal[2] * f * RADIAL] });
    }
    let np = 0, ni = 0;
    for (const p of parts) { np += p.mesh.positions.length; ni += p.mesh.indices.length; }
    const positions = new Float64Array(np), indices = new Uint32Array(ni), triTool = new Uint32Array(ni / 3);
    let po = 0, io = 0, to = 0;
    for (const p of parts) {
      const base = po / 3;
      for (let i = 0; i < p.mesh.positions.length; i += 3) { positions[po + i] = p.mesh.positions[i] + p.off[0]; positions[po + i + 1] = p.mesh.positions[i + 1] + p.off[1]; positions[po + i + 2] = p.mesh.positions[i + 2] + p.off[2]; }
      for (let i = 0; i < p.mesh.indices.length; i++) indices[io + i] = p.mesh.indices[i] + base;
      triTool.set(p.mesh.triTool, to);
      po += p.mesh.positions.length; io += p.mesh.indices.length; to += p.mesh.indices.length / 3;
    }
    return { positions, indices, triTool };
  }
}
