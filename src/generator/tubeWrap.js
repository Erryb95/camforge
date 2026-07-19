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
import { closedRingsFromDxf } from './dxfmill.js';
import { applyKerfAndLeads, cutParamsFor, materialEntries } from './rotaryCut.js';
import { materialNumber } from './plasmacMaterial.js';
import { tubePerimeter, tubeSectionAt } from './tubeGeom.js';

/**
 * @typedef {import('./post/plasmac.js').UV} UV
 * @typedef {import('./post/plasmac.js').RotaryContour} RotaryContour
 * @typedef {import('./post/plasmac.js').TubeSpec} TubeSpec
 */

/** Punto 3D sulla superficie del tubo per (u = asse, v = perimetro). @param {import('./tubeGeom.js').TubeShape} tube */
function uvToXyz(u, v, tube) {
  const p = tubeSectionAt(v, tube);
  return { x: u, y: p.y, z: p.z };
}

/** Profilo per la mesh/meta (profileFromMeta): tondo o rettangolare. @param {TubeShape} tube */
function tubeMeta(tube) {
  return (tube.shape === 'rect')
    ? { dialect: 'QTPLASMAC', tubeWidth: tube.width, tubeHeight: tube.height, tubeLength: tube.length }
    : { dialect: 'QTPLASMAC', tubeDiameter: tube.diameter, tubeLength: tube.length };
}

/**
 * Costruisce il SceneModel avvolto sul tubo dai moti emessi dal post.
 * @param {import('./post/plasmac.js').RotaryMove[]} moves
 * @param {TubeSpec} tube
 * @param {string[]} rawLines
 * @param {string} name
 */
function buildWrappedModel(moves, tube, rawLines, name) {
  const meta = /** @type {Record<string, any>} */ (tubeMeta(tube));
  const profile = profileFromMeta(meta);   // {type:'round'|'rect', ...}
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
        pts.push(uvToXyz(u, v, tube));
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
  // orientamento CCW coerente (come circleUV): axis 'v' uscirebbe CW altrimenti
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].u * pts[i].v - pts[i].u * pts[j].v;
  if (a < 0) pts.reverse();
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

const centroidUV = (pts) => {
  let u = 0, v = 0;
  for (const p of pts) { u += p.u; v += p.v; }
  return { u: u / pts.length, v: v / pts.length };
};

/**
 * Helper CONDIVISO: contorni (u,v) → G-code QtPlasmaC + modello avvolto.
 * Aggiunge un lead-in verso il centroide dove manca.
 * @param {RotaryContour[]} contours
 * @param {import('./tubeGeom.js').TubeShape} tube
 * @param {{feed?:number, thickness?:number, pierceMs?:number, material?:number|null, follow?:boolean, cutHeight?:number, name?:string, leadIn?:number}} [opts]
 */
export function wrapContoursToRotary(contours, tube, opts = {}) {
  const leadIn = opts.leadIn ?? 0;
  const withLeads = contours.map((c) => {
    if (c.lead || leadIn <= 0) return c;
    const cen = centroidUV(c.pts);
    return { ...c, lead: leadFor(c.pts, cen.u, cen.v, leadIn) };
  });
  const post = postRotaryPlasmaC(withLeads, tube, {
    feed: opts.feed ?? 2000,
    thickness: opts.thickness ?? 2,
    pierceMs: opts.pierceMs,
    material: opts.material ?? 0,
    follow: opts.follow,
    cutHeight: opts.cutHeight,
    name: opts.name,
  });
  const size = tube.shape === 'rect' ? `${Math.round(tube.width || 0)}x${Math.round(tube.height || 0)}` : `O${tube.diameter}`;
  const name = opts.name || `rotary-${size}x${Math.round(tube.length)}.ngc`;
  const model = buildWrappedModel(post.moves, tube, post.lines, name);
  return { model, gcode: post.text, name, tube };
}

/**
 * Pipeline completa della demo di validazione: pattern → wrap → G-code
 * QtPlasmaC → modello avvolto (Svolto + 3D + simulazione).
 * @param {Partial<TubeSpec> & {feed?:number, thickness?:number, material?:number|null, name?:string}} [opts]
 * @returns {{model:import('../core/model.js').SceneModel, gcode:string, name:string, tube:TubeSpec}}
 */
export function generateRotaryDemo(opts = {}) {
  const tube = { shape: 'round', diameter: opts.diameter ?? 60, length: opts.length ?? 300 };
  const contours = demoPattern({ diameter: tube.diameter, length: tube.length });
  return wrapContoursToRotary(contours, tube, {
    feed: opts.feed, thickness: opts.thickness, material: opts.material,
    name: opts.name || `rotary-demo-O${tube.diameter}x${tube.length}.ngc`,
  });
}

/**
 * Estrae contorni chiusi (u,v) da un modello DXF 2D: u = X del disegno (asse
 * tubo), v = Y (circonferenza). Riusa closedRingsFromDxf (concatenazione per
 * estremità) e aggiunge i segmenti già chiusi (cerchi/ellissi/polilinee chiuse).
 * @param {import('../core/model.js').SceneModel} model
 * @returns {RotaryContour[]}
 */
export function contoursFromDxfModel(model) {
  /** @type {RotaryContour[]} */ const out = [];
  const seen = new Set();
  const key = (pts) => {
    const c = centroidUV(pts);
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].u * pts[i].v - pts[i].u * pts[j].v;
    return `${c.u.toFixed(1)},${c.v.toFixed(1)},${Math.abs(a).toFixed(0)}`;
  };
  const add = (pts, tag) => {
    if (pts.length < 3) return;
    const k = key(pts);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ pts, tag });
  };
  // anelli concatenati (LINE/ARC che formano un profilo chiuso)
  for (const ring of closedRingsFromDxf(model)) {
    const pts = ring.map(([x, y]) => ({ u: x, v: y }));
    pts.push({ ...pts[0] });                       // chiudi
    add(pts, 'dxf-ring');
  }
  // segmenti singoli già chiusi (un CIRCLE/ELLIPSE tessellato = un solo segmento)
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-3;
  for (const s of model.segments) {
    if (s.type === 'rapid' || !s.pts || s.pts.length < 8) continue;
    if (!near(s.pts[0], s.pts[s.pts.length - 1])) continue;
    add(s.pts.map((p) => ({ u: p.x, v: p.y })), 'dxf-loop');
  }
  return out;
}

/**
 * Estensione del disegno DXF in (u,v) + Ø suggerito perché l'altezza del disegno
 * copra esattamente un giro (circonferenza = altezza ⇒ Ø = altezza/π).
 * @param {import('../core/model.js').SceneModel} model
 * @returns {{uSpan:number, vSpan:number, suggestedDiameter:number, contours:number}}
 */
export function dxfDesignExtent(model) {
  const contours = contoursFromDxfModel(model);
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const c of contours) for (const p of c.pts) {
    if (p.u < uMin) uMin = p.u; if (p.u > uMax) uMax = p.u;
    if (p.v < vMin) vMin = p.v; if (p.v > vMax) vMax = p.v;
  }
  const vSpan = vMax > vMin ? vMax - vMin : 0;
  return {
    uSpan: uMax > uMin ? uMax - uMin : 0,
    vSpan,
    // arrotonda per ECCESSO a 0.1 mm ⇒ la circonferenza copre sempre l'altezza
    suggestedDiameter: vSpan > 0 ? Math.ceil((vSpan / Math.PI) * 10) / 10 : 60,
    contours: contours.length,
  };
}

/**
 * DXF 2D (disegno sullo SVOLTO) → wrap sul tubo → G-code QtPlasmaC. Il disegno è
 * interpretato: X = asse tubo (mm), Y = circonferenza (mm). Se la lunghezza non è
 * data, si ricava dall'estensione del disegno; l'origine u è portata a un piccolo
 * margine dall'inizio. Segnala se l'altezza del disegno supera la circonferenza.
 * Applica kerf compensation (± kerf/2 secondo il contenimento) + lead-in/out.
 * feed/kerf/pierce di default vengono dal preset plasma per lo spessore.
 * @param {import('../core/model.js').SceneModel} dxfModel
 * @param {{shape?:'round'|'rect', diameter?:number, width?:number, height?:number, length?:number, feed?:number, thickness?:number, materialKey?:string, kerf?:number, lead?:'arc'|'line'|'none', leadLen?:number, overcut?:number, topology?:'auto'|'tube'|'sheet', follow?:boolean, cutHeight?:number, material?:number|null, name?:string, leadIn?:number, margin?:number}} opts
 * @returns {Promise<{model:import('../core/model.js').SceneModel, gcode:string, name:string, tube:import('./tubeGeom.js').TubeShape, info:string}>}
 */
export async function wrapDxfToRotary(dxfModel, opts = {}) {
  const shape = opts.shape || 'round';
  // il rettangolare RICHIEDE la torcia che segue (Z variabile): raggio min sulla
  // faccia, max sugli spigoli → uno standoff fisso non è mantenibile. Forzalo.
  const follow = opts.follow ?? (shape === 'rect');
  const contours = contoursFromDxfModel(dxfModel);
  if (!contours.length) throw new Error('nessun contorno CHIUSO nel DXF (servono profili chiusi da tagliare)');
  // bounding box del disegno in (u,v)
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const c of contours) for (const p of c.pts) {
    if (p.u < uMin) uMin = p.u; if (p.u > uMax) uMax = p.u;
    if (p.v < vMin) vMin = p.v; if (p.v > vMax) vMax = p.v;
  }
  const margin = opts.margin ?? 10;
  // trasla u così che il disegno parta a `margin`; centra v attorno a 0 (sommità)
  const du = margin - uMin;
  const vMid = (vMin + vMax) / 2;
  const shifted = contours.map((c) => ({
    ...c, pts: c.pts.map((p) => ({ u: p.u + du, v: p.v - vMid })),
  }));
  const length = opts.length ?? (uMax - uMin + 2 * margin);
  const tube = shape === 'rect'
    ? { shape: 'rect', width: opts.width ?? 40, height: opts.height ?? 40, length }
    : { shape: 'round', diameter: opts.diameter ?? 60, length };
  const perim = tubePerimeter(tube);

  // preset di taglio dalla lega + spessore (kerf/feed/pierce), con override
  const thickness = opts.thickness ?? 2;
  const materialKey = opts.materialKey || 'mild_steel';
  const entries = materialEntries(materialKey);
  const preset = cutParamsFor(thickness, entries);
  const kerf = opts.kerf ?? preset.kerf;
  const feed = opts.feed ?? preset.feed;
  // numero materiale QtPlasmaC (per M190) coerente col material file esportato
  const material = opts.material ?? materialNumber(materialKey, thickness);
  // avviso se lo spessore è fuori dal range della lega (preset del più vicino)
  const tMin = Math.min(...entries.map((p) => p.t)), tMax = Math.max(...entries.map((p) => p.t));
  const outOfRange = thickness < tMin - 1e-9 || thickness > tMax + 1e-9;

  // kerf compensation + lead-in/out sui contorni svolti
  const cam = await applyKerfAndLeads(shifted, {
    kerf, lead: opts.lead ?? 'arc', leadLen: opts.leadLen ?? Math.max(2, kerf * 2),
    overcut: opts.overcut ?? 0, topology: opts.topology ?? 'auto',
  });

  const vSpan = vMax - vMin;
  const topo = cam.sheet ? 'ritaglio sagoma' : 'fori nel tubo';
  const shapeTxt = shape === 'rect' ? `tubo rett. ${tube.width}×${tube.height}` : `tubo Ø${tube.diameter}`;
  let info = `${cam.contours.length} contorni (${cam.holes} fori · ${topo}) · disegno ${(uMax - uMin).toFixed(0)}×${vSpan.toFixed(0)} mm · ${shapeTxt} (perim. ${perim.toFixed(1)} mm) · kerf ${kerf} mm · feed ${feed} mm/min${follow ? ' · torcia segue (Z)' : ''}`;
  if (cam.skipped) info += ` · ⚠ ${cam.skipped} contorni < kerf saltati`;
  if (outOfRange) info += ` · ⚠ spessore ${thickness} mm fuori range ${tMin}–${tMax} mm per la lega: preset del più vicino`;
  if (vSpan > perim + 0.5) info += ` · ⚠ altezza disegno > perimetro: il taglio si sovrappone (>360°)`;

  const size = shape === 'rect' ? `${tube.width}x${tube.height}` : `O${tube.diameter}`;
  const name = opts.name || (dxfModel.name || 'dxf').replace(/\.[^.]+$/, '') + `.rotary-${size}.ngc`;
  const r = wrapContoursToRotary(cam.contours, tube, {
    feed, thickness, pierceMs: preset.pierce * 1000, material,
    follow, cutHeight: opts.cutHeight, name,
  });
  return { ...r, info };
}
