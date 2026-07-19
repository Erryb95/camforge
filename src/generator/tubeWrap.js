// @ts-check
// AVVOLGIMENTO tubo (rotary): da un pattern 2D sullo SVOLTO del tubo
// (u = ascissa assiale mm, v = ascissa perimetrale mm) a:
//   1) G-code QtPlasmaC rotary (X asse tubo, A rotazione) — vedi post/plasmac.js
//   2) un SceneModel già avvolto sul tubo solido, pronto per il viewer
//      (vista Svolto + 3D wrap + simulazione taglio), con seg.line che punta
//      alla riga del G-code emesso ⇒ sincronizzazione codice↔3D gratuita.
//
// È il primo tassello del "CAM tubo/rotary per controller aperti": riusa il
// motore svolto/tubo esistente (core/unroll.js, loaders/cad/tube3d.js) senza
// dipendere dal re-parsing del G-code (un file X+A puro non ricostruirebbe il
// tubo dal loader NC, che tratta A come asse utensile).

import { newBounds, dist3 } from '../core/model.js';
import { profileFromMeta, guidesFor } from '../core/unroll.js';
import { buildTubeMesh } from '../loaders/cad/tube3d.js';
import { postRotaryPlasmaC } from './post/plasmac.js';

/**
 * @typedef {import('./post/plasmac.js').UV} UV
 * @typedef {import('./post/plasmac.js').RotaryContour} RotaryContour
 * @typedef {import('./post/plasmac.js').TubeSpec} TubeSpec
 */

/** Punto sulla superficie del tubo tondo: v=0 al centro faccia superiore (+Z). */
function uvToXyz(u, v, R) {
  const phi = v / R;                      // angolo dalla sommità verso +Y
  return { x: u, y: R * Math.sin(phi), z: R * Math.cos(phi) };
}

/**
 * Costruisce il SceneModel avvolto sul tubo dai moti emessi dal post.
 * @param {import('./post/plasmac.js').RotaryMove[]} moves
 * @param {TubeSpec} tube
 * @param {string[]} rawLines
 * @param {string} name
 */
function buildWrappedModel(moves, tube, rawLines, name) {
  const R = tube.diameter / 2;
  const meta = /** @type {Record<string, any>} */ ({
    dialect: 'QTPLASMAC', tubeDiameter: tube.diameter, tubeLength: tube.length,
  });
  const profile = profileFromMeta(meta);   // {type:'round', r, per}
  if (!profile) throw new Error('profilo tubo non valido');

  /** @type {import('../core/model.js').Segment[]} */
  const segments = [];
  let prev = /** @type {UV|null} */ (null);
  let uMin = Infinity, uMax = -Infinity;

  for (const mv of moves) {
    const cur = { u: mv.u, v: mv.v };
    if (prev) {
      const du = cur.u - prev.u, dv = cur.v - prev.v;
      // tessellazione lungo la superficie: un punto ogni ~2 mm di corda svolta
      const n = Math.max(1, Math.min(96, Math.ceil(Math.hypot(du, dv) / 2)));
      /** @type {import('../core/model.js').P3[]} */ const pts = [];
      /** @type {{u:number,v:number}[]} */ const uv = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const u = prev.u + du * t, v = prev.v + dv * t;
        pts.push(uvToXyz(u, v, R));
        uv.push({ u, v });
        if (u < uMin) uMin = u;
        if (u > uMax) uMax = u;
      }
      const from = pts[0], to = pts[pts.length - 1];
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += dist3(pts[i - 1], pts[i]);
      segments.push({
        type: mv.type === 'rapid' ? 'rapid' : 'feed',
        from, to, pts, tubePts: pts, uv,
        line: mv.line, tool: 0, feed: mv.type === 'rapid' ? null : mv.feed, len,
      });
    }
    prev = cur;
  }

  if (uMin === Infinity) { uMin = 0; uMax = tube.length; }
  const margin = Math.max(2, (uMax - uMin) * 0.02);
  const mesh = buildTubeMesh(profile, uMin - margin, uMax + margin, 0);

  meta.unrollAvailable = true;
  meta.perimeter = profile.per;
  meta.unrollGuides = guidesFor(profile);

  // --- stats e bounds (come il parser NC) ---
  const all = newBounds(), feedB = newBounds();
  let feedLen = 0, rapidLen = 0, timeMin = 0, timeKnown = true;
  for (const s of segments) {
    for (const p of s.pts) all.add(p);
    if (s.type === 'rapid') rapidLen += s.len;
    else {
      feedLen += s.len;
      for (const p of s.pts) feedB.add(p);
      if (s.feed && s.feed > 0) timeMin += s.len / s.feed;
      else timeKnown = false;
    }
  }

  return /** @type {import('../core/model.js').SceneModel} */ ({
    name,
    program: null,
    units: 'mm',
    segments,
    drillPoints: [],
    warnings: [],
    rawLines,
    meta,
    mesh,
    bounds: all.result(),
    boundsFeed: feedB.result(),
    stats: { feedLen, rapidLen, timeMin: timeKnown && feedLen > 0 ? timeMin : null, tools: [0] },
  });
}

// ---------- generatori di forme sullo svolto (u,v) ----------

/** Cerchio chiuso di raggio r centrato in (cu,cv). @returns {UV[]} */
export function circleUV(cu, cv, r, n = 48) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = (2 * Math.PI * i) / n;
    pts.push({ u: cu + r * Math.cos(t), v: cv + r * Math.sin(t) });
  }
  return pts;
}

/**
 * Asola/obround (stadio) lunga `len` e larga `width`, centrata in (cu,cv).
 * axis 'u' = sviluppata lungo l'asse tubo; 'v' = circonferenziale (avvolta).
 * @returns {UV[]}
 */
export function obroundUV(cu, cv, len, width, axis = 'u', arc = 8) {
  const r = width / 2;
  const half = Math.max(0, len / 2 - r);
  const pts = [];
  // due centri dei semicerchi lungo l'asse scelto
  const along = (s, ang) => (axis === 'u'
    ? { u: cu + s * half + r * Math.cos(ang), v: cv + r * Math.sin(ang) }
    : { u: cu + r * Math.sin(ang), v: cv + s * half + r * Math.cos(ang) });
  // semicerchio destro/alto
  for (let i = 0; i <= arc; i++) pts.push(along(+1, -Math.PI / 2 + (Math.PI * i) / arc));
  // semicerchio sinistro/basso
  for (let i = 0; i <= arc; i++) pts.push(along(-1, Math.PI / 2 + (Math.PI * i) / arc));
  pts.push({ ...pts[0] });   // chiudi
  return pts;
}

/** Lead-in corto dal lato sfrido (verso il centro del contorno). @returns {UV[]} */
function leadFor(contour, cu, cv, leadLen = 3) {
  const p0 = contour[0];
  let dx = cu - p0.u, dy = cv - p0.v;
  const L = Math.hypot(dx, dy) || 1;
  dx /= L; dy /= L;
  return [{ u: p0.u + dx * leadLen, v: p0.v + dy * leadLen }, { u: p0.u, v: p0.v }];
}

/**
 * Pattern demo su un tubo tondo: due file di fori (sommità e fianco), un'asola
 * assiale e un'asola circonferenziale che si avvolge di ~180° (mostra il wrap).
 * @param {TubeSpec} tube
 * @returns {RotaryContour[]}
 */
export function demoPattern(tube) {
  const circ = Math.PI * tube.diameter;
  const us = [60, 120, 180, 240].filter((u) => u < tube.length);
  /** @type {RotaryContour[]} */ const cs = [];

  // fila sulla sommità (v=0), fori Ø14
  for (const u of us) {
    const c = circleUV(u, 0, 7);
    cs.push({ pts: c, lead: leadFor(c, u, 0), tag: `foro-top Ø14 @u${u}` });
  }
  // fila sul fianco (v = +circ/4 ≈ 90°), fori Ø10
  const vSide = circ / 4;
  for (const u of us) {
    const c = circleUV(u, vSide, 5);
    cs.push({ pts: c, lead: leadFor(c, u, vSide), tag: `foro-side Ø10 @u${u}` });
  }
  // asola assiale (lungo il tubo) sul fondo (v = circ/2 ≈ 180°)
  {
    const cu = 150, cv = circ / 2;
    const c = obroundUV(cu, cv, 80, 12, 'u');
    cs.push({ pts: c, lead: leadFor(c, cu, cv), tag: 'asola assiale 80×12' });
  }
  // asola CIRCONFERENZIALE che si avvolge (~180° di sviluppo) — il "wrap"
  {
    const cu = 290 < tube.length ? 290 : tube.length - 10;
    const cv = 0;
    const c = obroundUV(cu, cv, circ * 0.5, 10, 'v');
    cs.push({ pts: c, lead: leadFor(c, cu, cv), tag: 'asola circonf. wrap ~180°' });
  }
  return cs;
}

/**
 * Pipeline completa della demo di validazione: pattern → wrap → G-code
 * QtPlasmaC → modello avvolto (Svolto + 3D + simulazione).
 * @param {Partial<TubeSpec> & {feed?:number, thickness?:number, material?:number|null, name?:string}} [opts]
 * @returns {{model:import('../core/model.js').SceneModel, gcode:string, name:string, tube:TubeSpec}}
 */
export function generateRotaryDemo(opts = {}) {
  const tube = { diameter: opts.diameter ?? 60, length: opts.length ?? 300 };
  const contours = demoPattern(tube);
  const post = postRotaryPlasmaC(contours, tube, {
    feed: opts.feed ?? 2000,
    thickness: opts.thickness ?? 2,
    material: opts.material ?? 0,
    name: opts.name,
  });
  const name = opts.name || `rotary-demo-O${tube.diameter}x${tube.length}.ngc`;
  const model = buildWrappedModel(post.moves, tube, post.lines, name);
  return { model, gcode: post.text, name, tube };
}
