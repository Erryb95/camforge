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
// ── MODALITÀ QtPlasmaC-NATIVA "turnkey" (verificata su fonti primarie:
//    linuxcnc.org/docs/html/plasma/qtplasmac.html + sorgente qtplasmac.adoc) ──
// Ciò che i post SheetCam/generici NON fanno correttamente per il tubo rotary:
//   • #<keep-z-motion>=1  (SENZA spazi): dice a QtPlasmaC di NON forzare il proprio
//     movimento Z/probe iniziale e di lasciare che sia il file a pilotare Z. È il
//     meccanismo UFFICIALE per il tube cutting su asse angolare A/B/C. Salta il
//     touch-off (che su un tubo tondo rotante non è affidabile) in modo NATIVO —
//     non con hack. [Il vecchio #<tube-cut> era un artefatto del post SheetCam che
//     QtPlasmaC IGNORA, quindi non saltava affatto il probe.]
//   • M03 $0 S1 / M05 $0: torcia plasma normale. QtPlasmaC gestisce da solo, dopo
//     M03 $0 S1, arco/arc-OK e PIERCE DELAY dalla tabella materiale. Perciò NON si
//     emette G04 di pierce a mano (lo raddoppierebbe). ($3 NON esiste in QtPlasmaC:
//     spindle validi = $0 taglio, $1 scribe, $2 spotting.)
//   • THC OFF: il THC è un enable indipendente dallo spindle, spento per il tubo.
//   • Selezione materiale: M190 P<n> + M66 P3 L3 Q1 (attende la conferma del cambio
//     materiale, come da manuale "Automatic Material Handling").
//   • Nessuna subroutine o<touchoff> (assente in QtPlasmaC → errore): non emessa.
// Restano nostri differenziatori: G93 inverse-time (velocità di SUPERFICIE corretta
// su moti X/A/misti), angolo A geometrico, kerf/lead, torcia-che-segue sul rett.
// NB fisico noto (non risolvibile in CAM): sul rotary "wrapped" il look-ahead di
// LinuxCNC può cappare la velocità rotativa negli spigoli ad alte velocità.

import { tubePerimeter, tubeRadialAt, tubeSectionAt } from '../tubeGeom.js';

/**
 * @typedef {{u:number, v:number}} UV
 * @typedef {{pts:UV[], lead?:UV[], tag?:string}} RotaryContour
 * @typedef {import('../tubeGeom.js').TubeShape} TubeSpec  tondo (Ø) o rettangolare (w×h)
 * @typedef {{
 *   feed?:number,        // mm/min lungo la superficie
 *   thickness?:number,   // mm parete (informativo: il pierce lo gestisce QtPlasmaC via M190)
 *   pierceMs?:number,    // (deprecato/ignorato: pierce delay dalla tabella materiale QtPlasmaC)
 *   material?:number|null,// M190 P<n> (null = ometti selezione materiale)
 *   follow?:boolean,     // torcia che segue: emette Z = raggio + cutHeight (necessario sul rettangolare)
 *   cutHeight?:number,   // standoff di taglio (mm) per il modo follow
 *   pierceHeight?:number,// quota di sfondamento (mm) per il modo follow (default cutHeight+2)
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
 * Emette il programma QtPlasmaC rotary (modalità nativa turnkey) dai contorni svolti.
 * @param {RotaryContour[]} contours
 * @param {TubeSpec} tube
 * @param {RotaryPostOpts} [opts]
 * @returns {{text:string, lines:string[], moves:RotaryMove[]}}
 */
export function postRotaryPlasmaC(contours, tube, opts = {}) {
  const feed = opts.feed ?? 2000;
  const material = opts.material === undefined ? 0 : opts.material;
  const home = opts.home !== false;
  const perimeter = tubePerimeter(tube);
  const follow = !!opts.follow;
  const cutHeight = opts.cutHeight ?? 1.5;
  const pierceHeight = opts.pierceHeight ?? (cutHeight + 2);
  // Z (solo modo follow): la torcia segue la superficie. Z_cut = raggio + cutHeight;
  // Z_pierce = raggio + pierceHeight (più alta, per sfondare senza sporcare l'ugello).
  // Con #<keep-z-motion>=1 è il FILE a pilotare Z (QtPlasmaC non inserisce il suo Z/probe).
  const zCut = (v) => f(tubeRadialAt(v, tube) + cutHeight);
  const zPierce = (v) => f(tubeRadialAt(v, tube) + pierceHeight);
  // raggio MASSIMO (spigolo sul rett) → Z SICURA per i rapidi: durante un rapido A
  // spazza anche gli spigoli, quindi la torcia si ritrae a zSafe per non passarci sotto.
  const maxRadial = tube.shape === 'rect'
    ? Math.hypot((tube.width || 0) / 2, (tube.height || 0) / 2)
    : (tube.diameter || 0) / 2;
  const zSafe = f(maxRadial + Math.max(pierceHeight, cutHeight) + 10);

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
  // precedente così i moti non fanno il giro lungo attorno al tubo. prevA parte da 0.
  let prevA = 0;
  const wrapTo180 = (d) => ((d % 360) + 540) % 360 - 180;
  // A = ANGOLO GEOMETRICO di rotazione del mandrino per portare il punto di sezione
  // sotto la torcia = atan2(y,z). Sul TONDO = v/perimetro·360; sul RETTANGOLARE diverso.
  const vDeg = (v) => { const p = tubeSectionAt(v, tube); return Math.atan2(p.y, p.z) * 180 / Math.PI; };
  const emitA = (v) => {
    prevA += wrapTo180(vDeg(v) - prevA);
    return f(prevA);
  };
  const zWord = (v) => (follow ? ` Z${zCut(v)}` : '');
  // Feed INVERSE-TIME (G93): F = 1/T con T = lunghezza superficie / velocità. Sullo
  // svolto la lunghezza reale del segmento è hypot(du,dv) mm ⇒ velocità di taglio
  // corretta su moti assiali, di sola rotazione e misti (con G94 un moto di sola A
  // verrebbe letto come gradi/min).
  let prev = null;
  const invF = (u, v) => {
    if (!prev) return null;
    const ds = Math.hypot(u - prev.u, v - prev.v);
    return ds > 1e-6 ? feed / ds : null;   // 1/min
  };

  const shapeDesc = tube.shape === 'rect'
    ? `tubo rett. ${f(tube.width || 0)}×${f(tube.height || 0)} mm`
    : `tubo tondo Ø${f(tube.diameter || 0)} mm`;
  push(`(QtPlasmaC ROTARY — CamForge · post QtPlasmaC-nativo turnkey)`);
  push(`(${shapeDesc} · lunghezza ${f(tube.length)} mm · perimetro ${f(perimeter)} mm)`);
  push(`(X = asse tubo mm · A = rotazione gradi${follow ? ' · Z = torcia che segue' : ' · torcia a standoff fisso'})`);
  push(`(feed superficie ${feed} mm/min via G93 inverse-time · contorni ${contours.length})`);
  push(`(#<keep-z-motion> salta il probe sul tubo · THC off · pierce/arco/materiale gestiti da QtPlasmaC)`);
  // preambolo sicuro raccomandato dal manuale QtPlasmaC (senza il feed-mode: sotto G93)
  push('G21 G40 G49 G64 P0.1 G80 G90 G92.1 G97');
  push('#<keep-z-motion>=1');            // NATIVO: niente probe/Z forzato → il file pilota Z
  if (material !== null) {
    push(`M190 P${material}`);           // seleziona materiale (pierce/feed/amp/altezze)
    push('M66 P3 L3 Q1');                // attende la conferma del cambio materiale (fino a 1 s)
  }
  push('G93');                           // inverse-time feed mode

  contours.forEach((c, i) => {
    push(`(contorno ${i + 1}/${contours.length}${c.tag ? ' ' + c.tag : ''})`);
    const lead = c.lead && c.lead.length ? c.lead : null;
    const entry = lead ? lead[0] : c.pts[0];
    // rapido al punto d'attacco: in follow si va a Z SICURA (torcia ritratta mentre A
    // ruota attraverso gli spigoli), poi si scende alla quota di PIERCE; senza follow
    // è un semplice G0 X A (Z alla torcia, fissa; keep-z-motion evita il probe).
    motion(`G0 X${f(entry.u)} A${emitA(entry.v)}${follow ? ` Z${zSafe}` : ''}`, 'rapid', entry.u, entry.v, null);
    if (follow) push(`G0 Z${zPierce(entry.v)}`);   // discesa alla quota di sfondamento
    prev = { u: entry.u, v: entry.v };
    push('M03 $0 S1');                   // torcia ON — QtPlasmaC esegue arco + pierce delay dal materiale
    // (nessun G04: il pierce delay è gestito da QtPlasmaC via M190; emetterlo lo raddoppierebbe)
    const emitFeed = (p) => {
      const F = invF(p.u, p.v);
      if (F === null) { prev = { u: p.u, v: p.v }; return; }   // moto di lunghezza nulla: in G93 servirebbe una F → non emetterlo
      // in follow, il PRIMO moto di taglio scende da pierceHeight a cutHeight (zWord)
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
  push('M2');                            // fine programma (come da esempi QtPlasmaC)

  return { text: L.join('\n') + '\n', lines: L, moves };
}

const sameUV = (a, b) => Math.abs(a.u - b.u) < 1e-9 && Math.abs(a.v - b.v) < 1e-9;
