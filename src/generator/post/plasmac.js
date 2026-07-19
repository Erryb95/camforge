// @ts-check
// POST-PROCESSOR QtPlasmaC ROTARY (taglio tubo su asse A) — dialetto LinuxCNC.
//
// Modello di macchina: PIPE/ROTARY. L'asse X corre lungo il tubo (mm), l'asse A
// RUOTA il tubo attorno al suo asse (gradi). La geometria è definita sullo SVOLTO
// (u = ascissa assiale mm, v = ascissa perimetrale mm) e viene AVVOLTA. L'angolo
// di rotazione A è l'ANGOLO GEOMETRICO del punto di sezione = atan2(y,z) (sul
// tondo coincide con v/circonferenza·360; sul rettangolare NO). X = u.
// Modo "torcia che segue" (follow): emette anche Z = raggio + cut height per
// mantenere lo standoff — costante sul tondo, variabile (necessario) sul rett.
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
import { tubePerimeter, tubeRadialAt, tubeSectionAt } from '../tubeGeom.js';

/**
 * @typedef {{u:number, v:number}} UV
 * @typedef {{pts:UV[], lead?:UV[], tag?:string}} RotaryContour
 * @typedef {import('../tubeGeom.js').TubeShape} TubeSpec  tondo (Ø) o rettangolare (w×h)
 * @typedef {{
 *   feed?:number,        // mm/min lungo la superficie
 *   thickness?:number,   // mm parete, per il pierce delay
 *   pierceMs?:number,    // override delay in ms
 *   material?:number|null,// M190 P<n> (null = ometti)
 *   follow?:boolean,     // torcia che segue: emette Z = raggio + cutHeight (necessario sul rettangolare)
 *   cutHeight?:number,   // standoff di taglio (mm) per il modo follow
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
  const perimeter = tubePerimeter(tube);
  const follow = !!opts.follow;
  const cutHeight = opts.cutHeight ?? 1.5;
  // Z (solo modo follow): la torcia segue la superficie a standoff costante ⇒
  // Z = distanza radiale del punto + cutHeight. Costante sul tondo, VARIABILE sul
  // rettangolare (indispensabile lì).
  const zAt = (v) => f(tubeRadialAt(v, tube) + cutHeight);
  // raggio MASSIMO (spigolo sul rett) → Z SICURA per i rapidi: durante un rapido
  // A spazza anche gli spigoli (raggio maggiore degli estremi), quindi la torcia
  // deve prima ritrarsi a zSafe per non passarci sotto. Sul tondo maxRadial = R,
  // quindi zSafe è solo un po' più alta e non cambia il comportamento.
  const maxRadial = tube.shape === 'rect'
    ? Math.hypot((tube.width || 0) / 2, (tube.height || 0) / 2)
    : (tube.diameter || 0) / 2;
  const zSafe = f(maxRadial + cutHeight + 10);

  /** @type {string[]} */ const L = [];
  /** @type {RotaryMove[]} */ const moves = [];
  // aggiunge una riga e restituisce il suo numero (1-based)
  const push = (s) => { L.push(s); return L.length; };
  // aggiunge una riga di moto e registra il move per il sync codice↔3D
  // (moves[].feed resta la velocità SUPERFICIE in mm/min, per stime tempo del modello)
  const motion = (code, type, u, v, ff) => {
    const line = push(code);
    moves.push({ line, type, u, v, feed: ff });
  };

  // A in gradi con SHORTEST-PATH: sceglie l'equivalente più vicino al valore
  // precedente così i moti non fanno il giro lungo attorno al tubo (né grandi
  // riavvolgimenti vicino alla cucitura). prevA parte da 0 (home A0).
  let prevA = 0;
  const wrapTo180 = (d) => ((d % 360) + 540) % 360 - 180;
  // A = ANGOLO GEOMETRICO di rotazione del mandrino per portare il punto di
  // sezione sotto la torcia = atan2(y,z) del punto perimetrale. Sul TONDO è
  // identico a v/perimetro·360; sul RETTANGOLARE è diverso (l'ascissa cresce
  // linearmente sulla faccia mentre l'angolo cresce come atan) ⇒ solo così le
  // feature finiscono nella posizione angolare giusta e coerente con lo Z-follow.
  const vDeg = (v) => { const p = tubeSectionAt(v, tube); return Math.atan2(p.y, p.z) * 180 / Math.PI; };
  const emitA = (v) => {
    prevA += wrapTo180(vDeg(v) - prevA);
    return f(prevA);
  };
  const zWord = (v) => (follow ? ` Z${zAt(v)}` : '');
  // Feed INVERSE-TIME (G93): F = 1/T con T = lunghezza superficie / velocità
  // (min). Sullo svolto la lunghezza reale del segmento è hypot(du,dv) mm (u e v
  // sono entrambi ascisse in mm sulla superficie). Così la velocità di taglio è
  // corretta su moti assiali, di sola rotazione e misti — cosa che F in mm/min
  // (G94) NON garantisce (su un moto di sola A verrebbe letto come gradi/min).
  let prev = null;
  const invF = (u, v) => {
    if (!prev) return null;
    const ds = Math.hypot(u - prev.u, v - prev.v);
    return ds > 1e-6 ? feed / ds : null;   // 1/min
  };

  const shapeDesc = tube.shape === 'rect'
    ? `tubo rett. ${f(tube.width || 0)}×${f(tube.height || 0)} mm`
    : `tubo tondo Ø${f(tube.diameter || 0)} mm`;
  push(`(QtPlasmaC ROTARY — generato da CAD/CAM visualLGE)`);
  push(`(${shapeDesc} · lunghezza ${f(tube.length)} mm · perimetro ${f(perimeter)} mm)`);
  push(`(X = asse tubo mm · A = rotazione gradi${follow ? ' · Z = standoff torcia che segue' : ' · torcia fissa, THC off'})`);
  push(`(feed superficie ${feed} mm/min via G93 inverse-time · pierce ${f(pierce)} s · contorni ${contours.length})`);
  push('G21');
  push('G40');
  push('G90');
  push('G93');                           // inverse-time feed mode
  push('#<tube-cut>=1');
  if (material !== null) push(`M190 P${material}`);

  contours.forEach((c, i) => {
    push(`(contorno ${i + 1}/${contours.length}${c.tag ? ' ' + c.tag : ''})`);
    const lead = c.lead && c.lead.length ? c.lead : null;
    const entry = lead ? lead[0] : c.pts[0];
    // posizionamento rapido al punto d'attacco: in modo follow il rapido va a Z
    // SICURA (torcia ritratta mentre A ruota attraverso gli spigoli), poi si
    // scende allo standoff di taglio; senza follow è un semplice G0 X A.
    motion(`G0 X${f(entry.u)} A${emitA(entry.v)}${follow ? ` Z${zSafe}` : ''}`, 'rapid', entry.u, entry.v, null);
    if (follow) push(`G0 Z${zAt(entry.v)}`);   // discesa allo standoff sul punto d'attacco
    prev = { u: entry.u, v: entry.v };
    push('M03 $0 S1');                   // torcia ON
    if (pierce > 0) push(`G04 P${f(pierce)}`);   // pierce delay
    const emitFeed = (p) => {
      const F = invF(p.u, p.v);
      if (F === null) { prev = { u: p.u, v: p.v }; return; }   // moto di lunghezza nulla: in G93 servirebbe una F → non emetterlo
      motion(`G1 X${f(p.u)} A${emitA(p.v)}${zWord(p.v)} F${f(F)}`, 'feed', p.u, p.v, feed);
      prev = { u: p.u, v: p.v };
    };
    // lead-in (dal 2° punto: il 1° è già il rapido d'attacco)
    if (lead) for (const p of lead.slice(1)) emitFeed(p);
    // contorno: se il lead termina già su pts[0], parti da k=1
    const startK = lead && sameUV(lead[lead.length - 1], c.pts[0]) ? 1 : 0;
    for (let k = startK; k < c.pts.length; k++) emitFeed(c.pts[k]);
    push('M05 $0');                      // torcia OFF
    if (follow) push(`G0 Z${zSafe}`);    // ritrai a Z sicura prima del prossimo rapido
  });

  push('M05 $0');
  push('G94');                           // ripristina feed in unità/min
  if (home) push(`G0 X0 A${emitA(0)}`);
  push('M30');

  return { text: L.join('\n') + '\n', lines: L, moves };
}

const sameUV = (a, b) => Math.abs(a.u - b.u) < 1e-9 && Math.abs(a.v - b.v) < 1e-9;
