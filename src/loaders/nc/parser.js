// @ts-check
// Parser G-code (ISO/Fanuc-like + dialetto laser tubo) -> SceneModel.
// Supporta: G0/G1/G2/G3 (modali), piani G17/G18/G19, unità G20/G21,
// G90/G91, archi I/J/K e R (cerchi completi ed eliche incluse),
// cicli fissi G81-G89 (+G80), T/M6, F, commenti (…) e ;, N, O, %.
// Dialetto tubo (Adige-like): KG10 come rapido, parametri macchina a più
// lettere (ZX, KA, LT<...>), assi ausiliari X_1=, direttive !...!, righe --LN.
// Tutto ciò che non è supportato genera un avviso con numero di riga: mai un crash.

import { newBounds, dist3 } from '../../core/model.js';
import { applyTubeUnroll } from '../../core/unroll.js';

// assi (u,v) e offset di centro per ciascun piano di lavoro
const PLANES = {
  XY: { u: 'x', v: 'y', w: 'z', ou: 'I', ov: 'J' },
  ZX: { u: 'z', v: 'x', w: 'y', ou: 'K', ov: 'I' },
  YZ: { u: 'y', v: 'z', w: 'x', ou: 'J', ov: 'K' },
};

const CHORD_TOL = 0.02;            // errore di corda max per la tessellazione (mm)
const MAX_ARC_STEPS = 3000;

// parametri header del dialetto tubo che vale la pena esporre
const TUBE_META = { LT: 'tubeLength', DM: 'tubeDiameter', WW: 'tubeWidth', WH: 'tubeHeight' };

/**
 * Scompone una riga (già privata di commenti) in parole standard a lettera
 * singola (G1, X-5.2) e parametri macchina a più lettere o con suffisso
 * (KG10, ZX-61.2, KA<10>, X_1=307.4). Ritorna null per righe da saltare.
 * @param {string} line
 */
function tokenize(line) {
  /** @type {{letter:string, value:number}[]} */
  const words = [];
  /** @type {Record<string, number|null>} */
  const params = {};
  let junk = '';
  let i = 0;
  const n = line.length;

  while (i < n) {
    const c = line[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === '!') {                       // direttiva macchina !...!
      const j = line.indexOf('!', i + 1);
      i = j < 0 ? n : j + 1;
      continue;
    }
    if (c === '-' && line[i + 1] === '-') break;   // etichetta/flow (--LN, --GOTOLN)
    if (/[A-Za-z]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z]/.test(line[j])) j++;
      let ident = line.slice(i, j).toUpperCase();
      if (line[j] === '_') {               // asse ausiliario: X_1, Y_2…
        let k = j + 1;
        while (k < n && /\d/.test(line[k])) k++;
        ident += line.slice(j, k);
        j = k;
      }
      i = j;
      while (i < n && line[i] === ' ') i++;
      if (line[i] === '=') { i++; while (i < n && line[i] === ' ') i++; }
      let bracket = false;
      if (line[i] === '<') { bracket = true; i++; }
      const m = /^[+-]?(?:\d+\.?\d*|\.\d+)/.exec(line.slice(i));
      if (!m) {
        if (bracket) {                     // parametro non numerico: KA<abc>
          const j2 = line.indexOf('>', i);
          i = j2 < 0 ? n : j2 + 1;
          params[ident] = null;
        } else {
          junk += ident + ' ';             // identificatore senza valore
        }
        continue;
      }
      const value = parseFloat(m[0]);
      i += m[0].length;
      if (bracket && line[i] === '>') i++;
      if (ident.length === 1) words.push({ letter: ident, value });
      else params[ident] = value;
    } else {
      junk += c;
      i++;
    }
  }
  return { words, params, junk: junk.trim() };
}

/**
 * @param {string} text
 * @param {string} [fileName]
 * @returns {import('../../core/model.js').SceneModel}
 */
export function parseNC(text, fileName = '') {
  const rawLines = text.split(/\r\n|\r|\n/);

  /** @type {import('../../core/model.js').Segment[]} */
  const segments = [];
  /** @type {import('../../core/model.js').DrillPoint[]} */
  const drillPoints = [];
  /** @type {{line:number, msg:string}[]} */
  const warnings = [];
  const warnedOnce = new Set();
  /** @type {number[]} */
  const toolsSeen = [];
  /** @type {Record<string, any>} */
  const meta = {};

  const st = {
    pos: { x: 0, y: 0, z: 0 },
    axisSet: { x: false, y: false, z: false },
    motion: /** @type {number|null} */ (null),  // 0,1,2,3
    plane: 'XY',
    inch: false,
    abs: true,
    feed: /** @type {number|null} */ (null),
    tool: 0,
    pendingTool: /** @type {number|null} */ (null),
    cycle: /** @type {{g:string, z:number|null, r:number|null}|null} */ (null),
    program: /** @type {string|null} */ (null),
    ended: false,
    rot: /** @type {number|null} */ (null),   // rotazione tubo P (gradi, modale)
    aux: /** @type {number|null} */ (null),   // carro tubo X_1 (mm, modale)
  };

  const warn = (line, msg, once = false) => {
    if (once) {
      if (warnedOnce.has(msg)) return;
      warnedOnce.add(msg);
    }
    if (warnings.length < 500) warnings.push({ line, msg });
  };
  const mm = (v) => (st.inch ? v * 25.4 : v);
  const useTool = () => {
    if (st.tool && !toolsSeen.includes(st.tool)) toolsSeen.push(st.tool);
    return st.tool;
  };

  for (let li = 0; li < rawLines.length; li++) {
    const ln = li + 1;
    let line = rawLines[li];

    // commenti tra parentesi e da ';' a fine riga
    line = line.replace(/\([^)]*\)/g, ' ');
    if (line.includes('(')) { warn(ln, 'Commento "(" non chiuso'); line = line.slice(0, line.indexOf('(')); }
    const sc = line.indexOf(';');
    if (sc >= 0) line = line.slice(0, sc);
    line = line.trim();
    if (!line || line.startsWith('%')) continue;

    // macro / logica parametrica: fuori scope fase 1
    if (line.includes('#') || /^\?|\b(IF|WHILE|GOTO|GOTOF|GOTOB|JMPF|THEN|REPEAT)\b/i.test(line)) {
      warn(ln, 'Riga con macro/logica parametrica ignorata');
      continue;
    }

    const { words, params, junk } = tokenize(line);
    if (junk) warn(ln, `Testo non riconosciuto: "${junk.slice(0, 24)}"`, true);

    /** @type {Record<string, number>} */
    const w = {};
    /** @type {number[]} */
    const gCodes = [];
    /** @type {number[]} */
    const mCodes = [];
    for (const { letter, value } of words) {
      if (letter === 'G') gCodes.push(value);
      else if (letter === 'M') mCodes.push(value);
      else w[letter] = value;
    }

    // dialetto .pgm: un G-code macchina (>=100) rende la riga una direttiva,
    // non un moto. M/T/F su queste righe sono parametri della macro (es.
    // "G510 A1 M2 ..." NON è fine programma). Da G2292 si leggono i dati tubo.
    if (gCodes.some((g) => g >= 100)) {
      if (gCodes.includes(2292)) {
        if (w.Y !== undefined && w.V !== undefined) meta.tubeWidth = w.V - w.Y;
        if (w.Z !== undefined && w.W !== undefined) meta.tubeHeight = w.W - w.Z;
        if (w.U !== undefined) meta.tubeLength = Math.abs(w.U);
        meta.profileAuto = true;   // tondo/rettangolare deciso dai punti reali
      }
      continue;
    }

    // parametri header del dialetto tubo (LT<5597> DM<75.19> WW<73> WH<25>)
    for (const [key, metaKey] of Object.entries(TUBE_META)) {
      if (params[key] !== undefined && params[key] !== null && meta[metaKey] === undefined) {
        meta[metaKey] = params[key];
      }
    }
    // KG10 = posizionamento rapido del dialetto tubo (one-shot, non modale)
    const oneShotRapid = params.KG !== undefined;

    if (w.O !== undefined && st.program === null) st.program = 'O' + w.O;
    if (w.T !== undefined) st.pendingTool = Math.round(w.T);
    if (w.F !== undefined) st.feed = mm(w.F);

    // --- codici G modali ---
    let sawG28 = false;
    let motionSeen = false;
    for (const g of gCodes) {
      if (g === 0 || g === 1 || g === 2 || g === 3) {
        if (motionSeen) warn(ln, `Più modi di moto sulla stessa riga: vale G${g}`);
        motionSeen = true;
        st.motion = g;
      } else if (g === 17) st.plane = 'XY';
      else if (g === 18) st.plane = 'ZX';
      else if (g === 19) st.plane = 'YZ';
      else if (g === 20) st.inch = true;
      else if (g === 21) st.inch = false;
      else if (g === 90) st.abs = true;
      else if (g === 91) st.abs = false;
      else if (g === 80) st.cycle = null;
      else if (g >= 81 && g <= 89) {
        st.cycle = { g: 'G' + g, z: null, r: null };
        st.motion = null; // il ciclo sostituisce il moto modale
      } else if (g === 28 || g === 30) { sawG28 = true; }
      else if (g === 41 || g === 42) warn(ln, `G${g}: compensazione raggio utensile non applicata (percorso = centro utensile)`, true);
      else if (g >= 54 && g <= 59) warn(ln, `G${g}: origine lavoro non applicata (coordinate come da programma)`, true);
      else if (g === 53) warn(ln, 'G53: coordinate macchina trattate come coordinate pezzo', true);
      else if ([4, 40, 43, 49, 61, 64, 94, 95, 98, 99, 50, 69].includes(g)) { /* innocui: ignora */ }
      else warn(ln, `G${g} non supportato (ignorato)`, true);
    }

    // --- codici M ---
    for (const m of mCodes) {
      if (m === 6) {
        if (st.pendingTool === null) warn(ln, 'M6 senza T precedente');
        else st.tool = st.pendingTool;
      } else if (m === 30 || m === 2) st.ended = true;
      else if (m === 98 || m === 99) warn(ln, `M${m}: sottoprogrammi non supportati in fase 1`, true);
      // altri M (3,4,5,7,8,9, M2x macchina...): non geometrici, ignorati
    }
    if (st.ended) continue; // dopo M30/M02 non tracciamo altro

    const hasCoord = w.X !== undefined || w.Y !== undefined || w.Z !== undefined;
    const hasArcData = w.I !== undefined || w.J !== undefined || w.K !== undefined || w.R !== undefined;

    // --- ciclo fisso attivo: ogni posizione XY è un foro ---
    if (st.cycle) {
      if (w.Z !== undefined) st.cycle.z = mm(w.Z);
      if (w.R !== undefined) st.cycle.r = mm(w.R);
      if (w.X !== undefined || w.Y !== undefined) {
        const nx = w.X !== undefined ? (st.abs ? mm(w.X) : st.pos.x + mm(w.X)) : st.pos.x;
        const ny = w.Y !== undefined ? (st.abs ? mm(w.Y) : st.pos.y + mm(w.Y)) : st.pos.y;
        const rz = st.cycle.r !== null ? st.cycle.r : st.pos.z;
        // rapido di posizionamento tra un foro e l'altro
        const from = { ...st.pos };
        const to = { x: nx, y: ny, z: rz };
        if (dist3(from, to) > 1e-9) {
          segments.push({
            type: 'rapid', from, to, pts: [from, to], line: ln,
            tool: useTool(), feed: null, len: dist3(from, to),
            implicit: !(st.axisSet.x && st.axisSet.y),
          });
        }
        drillPoints.push({
          at: { x: nx, y: ny, z: st.cycle.z !== null ? st.cycle.z : rz },
          cycle: st.cycle.g, line: ln, tool: useTool(), afterSeg: segments.length,
        });
        st.pos = { x: nx, y: ny, z: rz };
        st.axisSet.x = st.axisSet.y = true;
        if (st.cycle.r !== null) st.axisSet.z = true;
      }
      continue;
    }

    // --- moto normale ---
    // dialetto tubo: P = rotazione tubo, X_1 = carro (solo con header tubo presente)
    const tubeDialect = meta.tubeLength !== undefined || meta.tubeWidth !== undefined
      || meta.tubeDiameter !== undefined;
    // rotazione tubo: P (Adige) oppure C (.pgm)
    const rotWord = tubeDialect ? (w.P !== undefined ? w.P : w.C) : undefined;
    const auxWord = tubeDialect && params.X_1 != null ? params.X_1 : undefined;
    // P è espresso modulo 360: la macchina prende la via corta (0→357 = -3°,
    // non +357°). Riporta il nuovo valore sul giro più vicino a quello attuale.
    let rotNew;
    if (rotWord !== undefined) {
      rotNew = st.rot === null ? rotWord
        : rotWord + 360 * Math.round((st.rot - rotWord) / 360);
    }
    const auxChanges = auxWord !== undefined && st.aux !== null && Math.abs(auxWord - st.aux) > 1e-9;

    if (!hasCoord && !hasArcData) {
      // solo avanzamento carro X_1: trasla u nello sviluppo (geometria reale);
      // la sola rotazione P non muove il punto di taglio (coordinate nel sistema pezzo)
      const pureCarriage = auxChanges && (st.motion !== null || oneShotRapid);
      if (!pureCarriage) {
        if (rotNew !== undefined) st.rot = rotNew;
        if (auxWord !== undefined) st.aux = auxWord;
        continue;      // riga senza geometria (solo F/S/T/M/param…)
      }
    } else if (st.motion === null && !oneShotRapid) {
      warn(ln, 'Coordinate senza modo di moto attivo (manca G0/G1/G2/G3): riga ignorata');
      continue;
    }

    const from = { ...st.pos };
    const fromSet = { ...st.axisSet };
    const rot0 = st.rot, aux0 = st.aux;
    const rot1 = rotNew !== undefined ? rotNew : rot0;
    const aux1 = auxWord !== undefined ? auxWord : aux0;
    st.rot = rot1; st.aux = aux1;
    const to = {
      x: w.X !== undefined ? (st.abs ? mm(w.X) : from.x + mm(w.X)) : from.x,
      y: w.Y !== undefined ? (st.abs ? mm(w.Y) : from.y + mm(w.Y)) : from.y,
      z: w.Z !== undefined ? (st.abs ? mm(w.Z) : from.z + mm(w.Z)) : from.z,
    };
    if (w.X !== undefined) st.axisSet.x = true;
    if (w.Y !== undefined) st.axisSet.y = true;
    if (w.Z !== undefined) st.axisSet.z = true;

    const implicit = !(fromSet.x || fromSet.y || fromSet.z);

    if (sawG28) warn(ln, 'G28/G30: ritorno al riferimento tracciato come rapido', true);

    if (oneShotRapid || st.motion === 0 || st.motion === 1 || sawG28) {
      const type = !oneShotRapid && st.motion === 1 && !sawG28 ? 'feed' : 'rapid';
      const len = dist3(from, to);
      if (len > 1e-9 || auxChanges) {
        segments.push({
          type, from, to, pts: [from, to], line: ln, tool: useTool(),
          feed: type === 'feed' ? st.feed : null, len, implicit,
          rot0, rot1, aux0, aux1,
        });
      }
      st.pos = to;
      continue;
    }

    // --- archi G2/G3 ---
    const arc = buildArc(st, from, to, w, st.motion === 2, ln, warn);
    if (arc) {
      arc.tool = useTool();
      arc.implicit = implicit;
      arc.rot0 = rot0; arc.rot1 = rot1; arc.aux0 = aux0; arc.aux1 = aux1;
      segments.push(arc);
    } else {
      // fallback: traccia una linea per non perdere il percorso
      const len = dist3(from, to);
      if (len > 1e-9) {
        segments.push({
          type: 'feed', from, to, pts: [from, to], line: ln,
          tool: useTool(), feed: st.feed, len, implicit,
          rot0, rot1, aux0, aux1,
        });
      }
    }
    st.pos = to;
  }

  // sviluppo tubo (se il file ha l'header tubo): calcola seg.uv, avvolge i
  // contorni sul tubo solido e corregge la lunghezza dei moti di sola rotazione
  const tubeMesh = applyTubeUnroll(segments, meta);

  // --- statistiche e bounds ---
  const all = newBounds();
  const feedB = newBounds();
  let feedLen = 0, rapidLen = 0, timeMin = 0, timeKnown = true;
  for (const s of segments) {
    for (const p of s.pts) all.add(p);
    if (s.type === 'rapid') {
      rapidLen += s.len;
    } else {
      feedLen += s.len;
      for (const p of s.pts) feedB.add(p);
      if (s.feed && s.feed > 0) timeMin += s.len / s.feed;
      else timeKnown = false;
    }
  }
  for (const d of drillPoints) { all.add(d.at); feedB.add(d.at); }

  return {
    name: fileName,
    program: st.program,
    units: st.inch ? 'in' : 'mm',
    segments,
    drillPoints,
    warnings,
    rawLines,
    meta,
    mesh: tubeMesh || null,
    bounds: all.result(),
    boundsFeed: feedB.result(),
    stats: {
      feedLen,
      rapidLen,
      timeMin: timeKnown && feedLen > 0 ? timeMin : null,
      tools: toolsSeen,
    },
  };
}

/**
 * Costruisce un segmento arco (con tessellazione) oppure null se i dati non bastano.
 * @param {{plane:string, feed:number|null, inch:boolean}} st
 * @param {{x:number,y:number,z:number}} from
 * @param {{x:number,y:number,z:number}} to
 * @param {Record<string, number>} w
 * @param {boolean} cw
 * @param {number} ln
 * @param {(line:number, msg:string, once?:boolean)=>void} warn
 * @returns {import('../../core/model.js').Segment|null}
 */
function buildArc(st, from, to, w, cw, ln, warn) {
  const pl = PLANES[/** @type {'XY'|'ZX'|'YZ'} */ (st.plane)];
  const mm = (v) => (st.inch ? v * 25.4 : v);

  const su = from[pl.u], sv = from[pl.v];
  const eu = to[pl.u], ev = to[pl.v];

  let cu, cv, radius;

  if (w.R !== undefined) {
    const R = mm(w.R);
    const r = Math.abs(R);
    const du = eu - su, dv = ev - sv;
    const d = Math.hypot(du, dv);
    if (d < 1e-9) { warn(ln, 'Arco con R e punto finale = iniziale: impossibile, riga ignorata'); return null; }
    if (d / 2 > r + 1e-6) warn(ln, `Arco R${R}: corda più lunga del diametro, raggio adattato`);
    const h = Math.sqrt(Math.max(0, r * r - (d / 2) * (d / 2)));
    const mu = (su + eu) / 2, mv = (sv + ev) / 2;
    const pu = -dv / d, pv = du / d; // perpendicolare unitaria alla corda
    // due centri candidati: scegli per convenzione del segno di R
    const cands = [
      { cu: mu + pu * h, cv: mv + pv * h },
      { cu: mu - pu * h, cv: mv - pv * h },
    ];
    let chosen = null;
    for (const c of cands) {
      const sw = arcSweep(su, sv, eu, ev, c.cu, c.cv, cw);
      const minor = Math.abs(sw) <= Math.PI + 1e-9;
      if ((R >= 0 && minor) || (R < 0 && !minor)) { chosen = c; break; }
    }
    if (!chosen) chosen = cands[0];
    cu = chosen.cu; cv = chosen.cv; radius = r;
  } else if (w.I !== undefined || w.J !== undefined || w.K !== undefined) {
    const offU = w[pl.ou] !== undefined ? mm(w[pl.ou]) : 0;
    const offV = w[pl.ov] !== undefined ? mm(w[pl.ov]) : 0;
    cu = su + offU;
    cv = sv + offV;
    const r0 = Math.hypot(su - cu, sv - cv);
    const r1 = Math.hypot(eu - cu, ev - cv);
    if (Math.abs(r0 - r1) > Math.max(0.05, r0 * 0.002)) {
      warn(ln, `Arco incoerente: raggio iniziale ${r0.toFixed(3)} ≠ finale ${r1.toFixed(3)}`);
    }
    radius = r0;
  } else {
    warn(ln, 'G2/G3 senza I/J/K né R: tracciato come linea');
    return null;
  }

  if (radius < 1e-9) { warn(ln, 'Arco con raggio nullo ignorato'); return null; }

  const sweep = arcSweep(su, sv, eu, ev, cu, cv, cw);

  // tessellazione con errore di corda controllato
  let dth = 2 * Math.acos(Math.min(1, Math.max(-1, 1 - CHORD_TOL / radius)));
  dth = Math.min(Math.PI / 12, Math.max(2 * Math.PI / 2000, dth));
  const steps = Math.min(MAX_ARC_STEPS, Math.max(2, Math.ceil(Math.abs(sweep) / dth)));

  const a0 = Math.atan2(sv - cv, su - cu);
  const w0 = from[pl.w], w1 = to[pl.w];
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = a0 + sweep * t;
    const p = { x: 0, y: 0, z: 0 };
    p[pl.u] = cu + radius * Math.cos(a);
    p[pl.v] = cv + radius * Math.sin(a);
    p[pl.w] = w0 + (w1 - w0) * t;
    pts.push(p);
  }
  // forza il punto finale esatto
  pts[pts.length - 1] = { ...to };

  const center = { x: 0, y: 0, z: 0 };
  center[pl.u] = cu; center[pl.v] = cv; center[pl.w] = (w0 + w1) / 2;

  const len = Math.hypot(Math.abs(sweep) * radius, w1 - w0);

  return {
    type: 'arc', from, to, pts, line: ln, tool: 0, feed: st.feed, len,
    cw, center, radius, plane: st.plane,
  };
}

/**
 * Angolo spazzato dall'arco: negativo per orario (G2), positivo per antiorario (G3).
 * Punto finale coincidente con l'iniziale = cerchio completo.
 */
function arcSweep(su, sv, eu, ev, cu, cv, cw) {
  const a0 = Math.atan2(sv - cv, su - cu);
  const a1 = Math.atan2(ev - cv, eu - cu);
  let sweep = a1 - a0;
  if (cw) {
    while (sweep > -1e-9) sweep -= 2 * Math.PI;
    if (sweep < -2 * Math.PI) sweep += 2 * Math.PI;
  } else {
    while (sweep < 1e-9) sweep += 2 * Math.PI;
    if (sweep > 2 * Math.PI) sweep -= 2 * Math.PI;
  }
  return sweep;
}
