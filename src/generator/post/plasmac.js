// @ts-check
// POST-PROCESSOR QtPlasmaC ROTARY (taglio tubo su asse A) — dialetto LinuxCNC.
//
// Modello di macchina: PIPE/ROTARY a torcia FISSA. L'asse X corre lungo il tubo
// (mm), l'asse A ruota il tubo (gradi). La geometria da tagliare è definita sul
// tubo SVOLTO in coordinate (u = ascissa assiale mm, v = ascissa perimetrale mm)
// e viene AVVOLTA:  A[°] = v / circonferenza · 360   (X = u).
//
// Convenzioni QtPlasmaC verificate sul file reale samples/cut/plasma_pipe.ngc
// (post "PlasmaRotary PlasmaC.scpost"):
//   G21                unità mm
//   #<tube-cut>=1      modalità taglio tubo (QtPlasmaC disattiva THC/altezza)
//   M03 $0 S1          torcia ON (con arco/materiale corrente)
//   M05 $0             torcia OFF
//   G04 P<s>           pierce delay (dwell) prima di iniziare a tagliare
//   M190 P<n>          (opzionale) selezione materiale QtPlasmaC
// La torcia resta a standoff fisso: nessun moto Z (THC disattivato in rotary),
// scelta legittima e più semplice/robusta per la demo di validazione.

import { pierceSeconds } from './gcode.js';

/**
 * @typedef {{u:number, v:number}} UV
 * @typedef {{pts:UV[], lead?:UV[], tag?:string}} RotaryContour
 * @typedef {{diameter:number, length:number}} TubeSpec  tondo: Ø e lunghezza (mm)
 * @typedef {{
 *   feed?:number,        // mm/min lungo la superficie
 *   thickness?:number,   // mm parete, per il pierce delay
 *   pierceMs?:number,    // override delay in ms
 *   material?:number|null,// M190 P<n> (null = ometti)
 *   name?:string,
 *   home?:boolean,       // ritorno a X0 A0 a fine programma (default true)
 * }} RotaryPostOpts
 *
 * @typedef {{line:number, type:'rapid'|'feed', u:number, v:number, feed:number|null}} RotaryMove
 */

/** Gradi di rotazione A per un'ascissa perimetrale v su un tubo tondo Ø. */
export function vToDegrees(v, diameter) {
  const circ = Math.PI * diameter;
  return (v / circ) * 360;
}

/** Inverso: ascissa perimetrale v (mm) da un angolo A (gradi). */
export function degreesToV(aDeg, diameter) {
  const circ = Math.PI * diameter;
  return (aDeg / 360) * circ;
}

const f = (n) => {
  const s = n.toFixed(4);
  return s.replace(/\.?0+$/, '') || '0';
};

/**
 * Emette il programma QtPlasmaC rotary dai contorni svolti.
 * @param {RotaryContour[]} contours
 * @param {TubeSpec} tube
 * @param {RotaryPostOpts} [opts]
 * @returns {{text:string, lines:string[], moves:RotaryMove[]}}
 */
export function postRotaryPlasmaC(contours, tube, opts = {}) {
  const feed = opts.feed ?? 2000;
  const pierce = pierceSeconds(opts.thickness ?? 2, opts.pierceMs);
  const material = opts.material === undefined ? 0 : opts.material;
  const home = opts.home !== false;
  const circ = Math.PI * tube.diameter;

  /** @type {string[]} */ const L = [];
  /** @type {RotaryMove[]} */ const moves = [];
  // aggiunge una riga e restituisce il suo numero (1-based)
  const push = (s) => { L.push(s); return L.length; };
  // aggiunge una riga di moto e registra il move per il sync codice↔3D
  const motion = (code, type, u, v, ff) => {
    const line = push(code);
    moves.push({ line, type, u, v, feed: ff });
  };
  const A = (v) => f(vToDegrees(v, tube.diameter));

  push(`(QtPlasmaC ROTARY — generato da CAD/CAM visualLGE)`);
  push(`(tubo tondo Ø${f(tube.diameter)} mm · lunghezza ${f(tube.length)} mm · circonferenza ${f(circ)} mm)`);
  push(`(X = asse tubo mm · A = rotazione gradi · torcia fissa, THC off)`);
  push(`(contorni: ${contours.length} · feed ${feed} mm/min · pierce ${f(pierce)} s)`);
  push('G21');
  push('G40');
  push('G90');
  push('#<tube-cut>=1');
  if (material !== null) push(`M190 P${material}`);

  contours.forEach((c, i) => {
    push(`(contorno ${i + 1}/${contours.length}${c.tag ? ' ' + c.tag : ''})`);
    const lead = c.lead && c.lead.length ? c.lead : null;
    const entry = lead ? lead[0] : c.pts[0];
    // posizionamento rapido al punto d'attacco (X assiale + A rotazione tubo)
    motion(`G0 X${f(entry.u)} A${A(entry.v)}`, 'rapid', entry.u, entry.v, null);
    push('M03 $0 S1');                   // torcia ON
    if (pierce > 0) push(`G04 P${f(pierce)}`);   // pierce delay
    let first = true;
    const emitFeed = (p) => {
      motion(`G1 X${f(p.u)} A${A(p.v)}${first ? ` F${feed}` : ''}`, 'feed', p.u, p.v, feed);
      first = false;
    };
    // lead-in (dal 2° punto: il 1° è già il rapido d'attacco)
    if (lead) for (const p of lead.slice(1)) emitFeed(p);
    // contorno: se il lead termina già su pts[0], parti da k=1
    const startK = lead && sameUV(lead[lead.length - 1], c.pts[0]) ? 1 : 0;
    for (let k = startK; k < c.pts.length; k++) emitFeed(c.pts[k]);
    push('M05 $0');                      // torcia OFF
  });

  push('M05 $0');
  if (home) push('G0 X0 A0');
  push('M30');

  return { text: L.join('\n') + '\n', lines: L, moves };
}

const sameUV = (a, b) => Math.abs(a.u - b.u) < 1e-9 && Math.abs(a.v - b.v) < 1e-9;
