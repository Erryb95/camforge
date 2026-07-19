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
 * @type {{t:number, kerf:number, feed:number, pierce:number, amps:number, volts?:number}[]}
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

/**
 * ACCIAIO INOX (AISI 304) — Hypertherm Powermax SYNC (810500MU R4, aria, colonna
 * Best Quality; backbone 65A + 45A a 1 mm). Include arc voltage (CUT_VOLTS).
 * @type {typeof MILD_STEEL_PLASMA}
 */
export const STAINLESS_PLASMA = [
  { t: 1, kerf: 0.8, feed: 8890, pierce: 0.1, amps: 45, volts: 134 },
  { t: 2, kerf: 0.8, feed: 8760, pierce: 0.1, amps: 65, volts: 132 },
  { t: 3, kerf: 1.1, feed: 7650, pierce: 0.1, amps: 65, volts: 132 },
  { t: 4, kerf: 1.3, feed: 5160, pierce: 0.1, amps: 65, volts: 133 },
  { t: 5, kerf: 1.45, feed: 3800, pierce: 0.15, amps: 65, volts: 133 },   // interpolato (la chart salta da 4 a 6)
  { t: 6, kerf: 1.6, feed: 2440, pierce: 0.2, amps: 65, volts: 133 },
  { t: 8, kerf: 1.8, feed: 1350, pierce: 0.5, amps: 65, volts: 135 },
  { t: 10, kerf: 2.0, feed: 940, pierce: 0.7, amps: 65, volts: 137 },
];

/**
 * ALLUMINIO — Hypertherm Powermax SYNC (810500MU R4, aria, torcia 45A per tutto
 * il range). Include arc voltage. (La chart non ha la riga a 5 mm.)
 * @type {typeof MILD_STEEL_PLASMA}
 */
export const ALUMINUM_PLASMA = [
  { t: 1, kerf: 1.5, feed: 8300, pierce: 0, amps: 45, volts: 140 },
  { t: 2, kerf: 1.2, feed: 6400, pierce: 0.1, amps: 45, volts: 139 },
  { t: 3, kerf: 1.1, feed: 4400, pierce: 0.1, amps: 45, volts: 142 },
  { t: 4, kerf: 1.1, feed: 3650, pierce: 0.1, amps: 45, volts: 143 },
  { t: 6, kerf: 1.0, feed: 2050, pierce: 0.2, amps: 45, volts: 146 },
  { t: 8, kerf: 1.2, feed: 1330, pierce: 0.5, amps: 45, volts: 147 },
  { t: 10, kerf: 1.3, feed: 860, pierce: 0.8, amps: 45, volts: 148 },
];

/**
 * Materiali plasma disponibili (mappa alloy → tabella spessori). Dati reali dai
 * cut chart Hypertherm Powermax SYNC (doc 810500MU R4, aria).
 * @type {Record<string, {key:string, label:string, gas:string, entries:typeof MILD_STEEL_PLASMA}>}
 */
export const PLASMA_MATERIALS = {
  mild_steel: { key: 'mild_steel', label: 'Acciaio dolce', gas: 'aria', entries: MILD_STEEL_PLASMA },
  stainless: { key: 'stainless', label: 'Inox 304', gas: 'aria', entries: STAINLESS_PLASMA },
  aluminum: { key: 'aluminum', label: 'Alluminio', gas: 'aria', entries: ALUMINUM_PLASMA },
};

/** Tabella spessori per un materiale (fallback acciaio dolce). @param {string} key */
export function materialEntries(key) {
  return (PLASMA_MATERIALS[key] || PLASMA_MATERIALS.mild_steel).entries;
}

/** Parametri di taglio per lo spessore più vicino nella tabella. @param {number} thickness */
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
 * A è contenuto in O se la MAGGIORANZA dei vertici di A cade dentro O. Robusto
 * per contorni NON convessi (un singolo centroide-media può cadere fuori dal
 * poligono a C/U e falsare l'annidamento); per contorni disgiunti non
 * intersecantisi la frazione è ~0 o ~1. @param {{u,v}[]} inner @param {{u,v}[]} outer
 */
function ringInsideUV(inner, outer) {
  let cnt = 0;
  for (const p of inner) if (pointInRingUV(p, outer)) cnt++;
  return cnt * 2 > inner.length;
}

/**
 * Profondità di contenimento (0 = più esterno). A è contenuto da O se la
 * maggioranza dei vertici di A è dentro O E |area(O)| > |area(A)| (il guard
 * sull'area risolve i casi concentrici). Il punto di chiusura duplicato viene
 * tolto per non distorcere il conteggio. @param {{pts:{u:number,v:number}[]}[]} contours
 */
export function containmentDepthUV(contours) {
  const rings = contours.map((c) => stripClose(c.pts));
  const areas = rings.map((r) => Math.abs(signedAreaUV(r)));
  return rings.map((ri, i) => {
    let d = 0;
    rings.forEach((rj, j) => {
      if (i !== j && areas[j] > areas[i] && ringInsideUV(ri, rj)) d++;
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
 *
 * TOPOLOGIA (chi è foro / chi è perimetro):
 *  - `tube`  : lo stock è la parete del tubo ⇒ i contorni top-level sono FORI
 *              (si asporta l'interno). Caso tipico "features nel tubo".
 *  - `sheet` : si ritaglia una sagoma svolta ⇒ il contorno più esterno è il
 *              PERIMETRO del pezzo, quelli annidati sono fori.
 *  - `auto`  : sheet se c'è UN solo contorno top-level che ne racchiude altri,
 *              altrimenti tube. (default)
 * Il segno del kerf segue: FORO → −kerf/2 (torcia dentro), PERIMETRO → +kerf/2.
 *
 * @param {{pts:{u:number,v:number}[], tag?:string}[]} contours
 * @param {{kerf?:number, lead?:'arc'|'line'|'none', leadLen?:number, overcut?:number, topology?:'auto'|'tube'|'sheet'}} [opts]
 * @returns {Promise<{contours:{pts:{u:number,v:number}[], lead:{u:number,v:number}[], tag?:string}[], skipped:number, holes:number, sheet:boolean}>}
 */
export async function applyKerfAndLeads(contours, opts = {}) {
  const kerf = opts.kerf ?? 0;
  const leadType = opts.lead ?? 'arc';
  const leadLen = opts.leadLen ?? 3;
  const overcut = opts.overcut ?? 0;
  const depth = containmentDepthUV(contours);
  const nTop = depth.filter((d) => d === 0).length;
  const mode = opts.topology || 'auto';
  const sheet = mode === 'sheet' ? true : mode === 'tube' ? false : (nTop === 1 && contours.length > 1);
  // sheet: foro = annidamento DISPARI · tube: foro = annidamento PARI (lo sfondo è pezzo)
  const isHole = (d) => (sheet ? d % 2 === 1 : d % 2 === 0);

  /** @type {{ring:{u:number,v:number}[], hole:boolean, depth:number, tag?:string}[]} */
  const items = [];
  let skipped = 0, holes = 0;

  for (let i = 0; i < contours.length; i++) {
    const hole = isHole(depth[i]);
    if (hole) holes++;
    let ring = stripClose(contours[i].pts);
    if (signedAreaUV(ring) < 0) ring = ring.slice().reverse();   // CCW per l'offset

    /** @type {{u:number,v:number}[][]} */
    let rings;
    if (kerf > 0) {
      const sign = hole ? -1 : +1;                       // fuori per esterno, dentro per foro
      const res = await offsetClosed([ring.map((p) => [p.u, p.v])], (sign * kerf) / 2, { join: 'round' });
      if (!res.length) { skipped++; continue; }          // contorno più piccolo del kerf: non tagliabile
      // TUTTI gli anelli risultanti: un contorno strozzato può spezzarsi in più
      // lobi → ciascuno è un taglio separato (niente geometria persa in silenzio)
      rings = res.map((rr) => rr.map(([u, v]) => ({ u, v })));
    } else {
      rings = [ring];
    }
    for (const rg of rings) items.push({ ring: rg, hole, depth: depth[i], tag: contours[i].tag });
  }

  // ORDINE inside-out: prima i contorni più interni (annidamento alto), il
  // perimetro esterno per ultimo (il pezzo resta fermo finché è tagliato).
  items.sort((a, b) => b.depth - a.depth);

  /** @type {{pts:{u:number,v:number}[], lead:{u:number,v:number}[], tag?:string}[]} */
  const out = [];
  for (const it of items) {
    let ring = it.ring;
    if (signedAreaUV(ring) < 0) ring = ring.slice().reverse();   // normalizza CCW
    // DIREZIONE DI TAGLIO (convenzione Hypertherm, swirl orario): contorni
    // ESTERNI in senso ORARIO (area<0), FORI in senso ANTIORARIO (area>0) ⇒
    // smusso/bava sullo sfrido, bordo squadrato sul pezzo.
    if (!it.hole) ring = ring.slice().reverse();          // da CCW a CW per gli esterni
    const lead = leadInUV(ring, it.hole, { type: leadType, len: leadLen });
    const pts = ring.concat([{ ...ring[0] }]);
    // OVERCUT (overburn) SOLO sui FORI: prosegue oltre lo start sul kerf già
    // tagliato per chiudere pulito il foro (default QtPlasmaC #<oclength> = 4 mm)
    if (it.hole && overcut > 0 && ring.length > 1) {
      const t = norm(ring[1].u - ring[0].u, ring[1].v - ring[0].v);
      pts.push({ u: ring[0].u + t.x * overcut, v: ring[0].v + t.y * overcut });
    }
    out.push({ pts, lead, tag: it.tag });
  }
  return { contours: out, skipped, holes, sheet };
}
