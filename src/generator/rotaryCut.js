// @ts-check
// CAM plasma per il tubo rotary: KERF COMPENSATION + LEAD-IN/OUT + preset di
// taglio per materiale/spessore. Opera sui contorni dello SVOLTO in coordinate
// (u = asse tubo mm, v = perimetro mm): il kerf sul piano svolto corrisponde al
// kerf sulla superficie del tubo (per diametri ragionevoli), quindi l'offset 2D
// di Clipper è la compensazione corretta.
//
// Regola kerf (centro-torcia): il finito deve avere la misura del disegno, quindi
//   contorno ESTERNO (perimetro pezzo) → torcia FUORI  → offset +kerf/2
//   contorno INTERNO (foro/asola)      → torcia DENTRO → offset −kerf/2
// Il lato "sfrido" (dove piercare) è quindi: fuori per il perimetro, dentro per i fori.

import { offsetClosed } from '../loaders/cad/offset.js';

/**
 * Preset di taglio PLASMA per ACCIAIO DOLCE (kerf/feed/pierce per spessore).
 * Valori REALI dalle cut chart Hypertherm Powermax SYNC (doc 810500MU Rev.4,
 * torce 45/65 A, aria) — kerf width, cut speed (mm/min), pierce delay (s).
 * @type {{t:number, kerf:number, feed:number, pierce:number, amps:number}[]}
 */
export const MILD_STEEL_PLASMA = [
  { t: 1, kerf: 1.4, feed: 8890, pierce: 0.1, amps: 45 },
  { t: 2, kerf: 1.7, feed: 6600, pierce: 0.2, amps: 45 },
  { t: 3, kerf: 1.3, feed: 5330, pierce: 0.1, amps: 65 },
  { t: 4, kerf: 1.4, feed: 4220, pierce: 0.1, amps: 65 },
  { t: 5, kerf: 1.45, feed: 3400, pierce: 0.2, amps: 65 },
  { t: 6, kerf: 1.5, feed: 2570, pierce: 0.2, amps: 65 },
  { t: 8, kerf: 1.7, feed: 1550, pierce: 0.5, amps: 65 },
  { t: 10, kerf: 1.9, feed: 1040, pierce: 0.7, amps: 65 },
];

/** Parametri di taglio per lo spessore più vicino nel preset. @param {number} thickness */
export function cutParamsFor(thickness, table = MILD_STEEL_PLASMA) {
  let best = table[0], bd = Infinity;
  for (const p of table) { const d = Math.abs(p.t - thickness); if (d < bd) { bd = d; best = p; } }
  return best;
}

// ---------- geometria (u,v) ----------

/** Area con segno (shoelace) di un anello [{u,v}] senza il punto di chiusura. */
export function signedAreaUV(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j].u * ring[i].v - ring[i].u * ring[j].v;
  }
  return a / 2;
}

/** Point-in-polygon (ray casting) su (u,v). @param {{u:number,v:number}} p */
export function pointInRingUV(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.v > p.v) !== (b.v > p.v) &&
        p.u < ((b.u - a.u) * (p.v - a.v)) / (b.v - a.v) + a.u) inside = !inside;
  }
  return inside;
}

/**
 * Profondità di contenimento (0 = più esterno). Un anello A è contenuto da O se
 * il CENTROIDE di A è dentro O E |area(O)| > |area(A)|: il probe sul centroide è
 * robusto ai vertici sul bordo (cerchio inscritto), il guard sull'area risolve i
 * casi CONCENTRICI (stesso centroide) dove il solo punto non distingue chi
 * contiene chi. @param {{pts:{u:number,v:number}[]}[]} contours
 */
export function containmentDepthUV(contours) {
  const probes = contours.map((c) => centroidUV(c.pts));
  const areas = contours.map((c) => Math.abs(signedAreaUV(c.pts)));
  return contours.map((_, i) => {
    let d = 0;
    contours.forEach((o, j) => {
      if (i !== j && areas[j] > areas[i] && pointInRingUV(probes[i], o.pts)) d++;
    });
    return d;
  });
}

const stripClose = (pts) => (pts.length > 1 && Math.abs(pts[0].u - pts[pts.length - 1].u) < 1e-9
  && Math.abs(pts[0].v - pts[pts.length - 1].v) < 1e-9 ? pts.slice(0, -1) : pts.slice());
const centroidUV = (pts) => {
  let u = 0, v = 0; for (const p of pts) { u += p.u; v += p.v; }
  return { u: u / pts.length, v: v / pts.length };
};
const norm = (x, y) => { const L = Math.hypot(x, y) || 1; return { x: x / L, y: y / L }; };

/**
 * Lead-in dal lato sfrido che termina ESATTAMENTE su ring[0], tangente al contorno.
 * @param {{u:number,v:number}[]} ring   anello aperto (senza chiusura), già orientato
 * @param {boolean} hole                 true = foro (sfrido dentro) · false = esterno (sfrido fuori)
 * @param {{type?:'arc'|'line'|'none', len?:number, arcSteps?:number}} [opts]
 * @returns {{u:number,v:number}[]}      punti del lead (ultimo = ring[0]); vuoto se 'none'
 */
export function leadInUV(ring, hole, opts = {}) {
  const type = opts.type ?? 'arc';
  const len = opts.len ?? 3;
  if (type === 'none' || len <= 0 || ring.length < 2) return [];
  const p0 = ring[0];
  const t = norm(ring[1].u - p0.u, ring[1].v - p0.v);   // tangente (direzione di taglio)
  const cen = centroidUV(ring);
  const wasteRaw = hole ? { x: cen.u - p0.u, y: cen.v - p0.v } : { x: p0.u - cen.u, y: p0.v - cen.v };
  if (type === 'line') {
    const w = norm(wasteRaw.x, wasteRaw.y);
    return [{ u: p0.u + w.x * len, v: p0.v + w.y * len }, { u: p0.u, v: p0.v }];
  }
  // ARC tangente: normale al percorso (⟂ tangente) verso lo sfrido
  let n = { x: -t.y, y: t.x };
  if (n.x * wasteRaw.x + n.y * wasteRaw.y < 0) n = { x: -n.x, y: -n.y };
  const r = len;
  const cx = p0.u + n.x * r, cy = p0.v + n.y * r;        // centro dell'arco (lato sfrido)
  // angolo di p0 rispetto al centro; l'arco spazza 90° arrivando tangente a t
  const a0 = Math.atan2(p0.v - cy, p0.u - cx);
  // verso di spazzata: quello che parte "contro" la direzione di taglio (entra nel materiale)
  const cross = t.x * (p0.v - cy) - t.y * (p0.u - cx);
  const dir = cross > 0 ? 1 : -1;
  const steps = opts.arcSteps ?? 10;
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + dir * (Math.PI / 2) * (1 - i / steps);
    out.push({ u: cx + r * Math.cos(a), v: cy + r * Math.sin(a) });
  }
  out[out.length - 1] = { u: p0.u, v: p0.v };            // chiudi esatto su p0
  return out;
}

/**
 * Applica KERF compensation + LEAD-IN/OUT a un set di contorni (u,v) chiusi.
 * @param {{pts:{u:number,v:number}[], tag?:string}[]} contours
 * @param {{kerf?:number, lead?:'arc'|'line'|'none', leadLen?:number, overcut?:number}} [opts]
 * @returns {Promise<{contours:{pts:{u:number,v:number}[], lead:{u:number,v:number}[], tag?:string}[], skipped:number, holes:number}>}
 */
export async function applyKerfAndLeads(contours, opts = {}) {
  const kerf = opts.kerf ?? 0;
  const leadType = opts.lead ?? 'arc';
  const leadLen = opts.leadLen ?? 3;
  const overcut = opts.overcut ?? 0;
  const depth = containmentDepthUV(contours);

  /** @type {{pts:{u:number,v:number}[], lead:{u:number,v:number}[], tag?:string}[]} */
  const out = [];
  let skipped = 0, holes = 0;

  for (let i = 0; i < contours.length; i++) {
    const hole = depth[i] % 2 === 1;
    if (hole) holes++;
    let ring = stripClose(contours[i].pts);
    // forza orientamento CCW (area>0): con Clipper +delta = espansione
    if (signedAreaUV(ring) < 0) ring = ring.slice().reverse();

    if (kerf > 0) {
      const sign = hole ? -1 : +1;                       // fuori per esterno, dentro per foro
      const paths = [ring.map((p) => [p.u, p.v])];
      const res = await offsetClosed(paths, (sign * kerf) / 2, { join: 'round' });
      if (!res.length) { skipped++; continue; }          // foro più piccolo del kerf: non tagliabile
      // prendi l'anello di area massima
      let bestRing = res[0], ba = -Infinity;
      for (const rr of res) { const a = Math.abs(shoelaceXY(rr)); if (a > ba) { ba = a; bestRing = rr; } }
      ring = bestRing.map(([u, v]) => ({ u, v }));
      if (signedAreaUV(ring) < 0) ring = ring.slice().reverse();
    }

    // DIREZIONE DI TAGLIO (convenzione Hypertherm, swirl orario: il bordo buono
    // resta a destra dell'avanzamento): contorni ESTERNI in senso ORARIO (area<0),
    // FORI in senso ANTIORARIO (area>0) ⇒ smusso/bava sullo sfrido, bordo squadrato
    // sul pezzo. (ring è CCW dopo l'offset: gira l'esterno.)
    if (!hole && signedAreaUV(ring) > 0) ring = ring.slice().reverse();

    const lead = leadInUV(ring, hole, { type: leadType, len: leadLen });
    const pts = ring.concat([{ ...ring[0] }]);
    // OVERCUT (overburn) SOLO sui FORI: prosegue oltre lo start sul kerf già
    // tagliato per chiudere pulito il foro (default QtPlasmaC #<oclength> = 4 mm)
    if (hole && overcut > 0 && ring.length > 1) {
      const t = norm(ring[1].u - ring[0].u, ring[1].v - ring[0].v);
      pts.push({ u: ring[0].u + t.x * overcut, v: ring[0].v + t.y * overcut });
    }
    out.push({ pts, lead, tag: contours[i].tag });
  }
  return { contours: out, skipped, holes };
}

/** Shoelace su [[x,y]...] (per scegliere l'anello di area massima dopo l'offset). */
function shoelaceXY(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}
