// @ts-check
// POST-PROCESSOR TAGLIO LAMIERA PIATTA (X/Y) — plasma/laser. Consuma i contorni
// GIÀ compensati kerf + lead-in/out di rotaryCut.applyKerfAndLeads (coordinate
// (u,v) = (x,y) sul piano) e produce il programma NC, con TAB/ponticelli sui
// perimetri per tenere i pezzi nel grezzo.
//
// Dialetti:
//  - qtplasmac : QtPlasmaC LinuxCNC PIATTO — M03 $0 S1 / M05 $0, THC ON e probe
//    NORMALI (sul piatto il touch-off funziona: niente keep-z-motion, quello è un
//    trucco solo-rotary), pierce/arco gestiti da QtPlasmaC via M190; selezione
//    materiale M190 P<n> + M66 P3 L3 Q1.
//  - grbl / linuxcnc : sorgente M3 S<power> / M5 + G4 pierce (laser/plasma generico).
// TAB: sui contorni PERIMETRO (non i fori) si interrompe l'arco per `count` tratti
// di lunghezza `len` → il pezzo resta attaccato allo scheletro.

const f = (n) => { if (!Number.isFinite(n)) return '0'; const s = n.toFixed(3); return s.replace(/\.?0+$/, '') || '0'; };
const numOr = (v, d) => (Number.isFinite(v) ? v : d);   // scarta anche NaN (?? no)
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Spezza un anello di taglio in RUN (tratti tagliati) separati da `count` tab di
 * lunghezza `len`, distribuiti per lunghezza d'arco (centrati, non a cavallo dello start).
 * @param {{x:number,y:number}[]} pts  anello chiuso (ultimo = primo)
 * @returns {{x:number,y:number}[][]}  lista di run; [pts] se niente tab
 */
export function planTabRuns(pts, count, len) {
  if (count <= 0 || len <= 0 || pts.length < 3) return [pts.slice()];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i], pts[i - 1]));
  const total = cum[cum.length - 1];
  // ADATTA i tab al perimetro invece di ometterli in silenzio (il pezzo si staccherebbe):
  // riduci prima il numero, poi la lunghezza; rinuncia solo su un perimetro davvero minuscolo.
  let n = count, L = len;
  if (total < n * L * 2) n = Math.max(1, Math.floor(total / (L * 2)));
  if (total < n * L * 2) L = Math.max(0.2, total / (n * 4));
  if (total < n * L * 1.2 || total < 2) return [pts.slice()];   // impossibile: perimetro troppo corto
  const at = (s) => {
    let i = 1; while (i < cum.length && cum[i] < s) i++;
    if (i >= cum.length) return { ...pts[pts.length - 1] };
    const t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
  };
  const tabs = [];
  for (let i = 0; i < n; i++) { const c = (i + 0.5) * total / n; tabs.push([c - L / 2, c + L / 2]); }
  const runs = [];
  const emitRun = (a, b) => {
    const run = [at(a)];
    for (let i = 0; i < pts.length; i++) if (cum[i] > a + 1e-9 && cum[i] < b - 1e-9) run.push(pts[i]);
    run.push(at(b));
    if (run.length >= 2 && dist(run[0], run[run.length - 1]) > 1e-6) runs.push(run);
  };
  let cursor = 0;
  for (const [ts, te] of tabs) { emitRun(cursor, ts); cursor = te; }
  emitRun(cursor, total);
  return runs;
}

const DIALECTS = {
  qtplasmac: {
    title: 'QtPlasmaC piatto (LinuxCNC)',
    preamble: ['G21 G40 G49 G64 P0.1 G80 G90 G92.1 G94 G97'],
    material: (n) => (n === null ? [] : [`M190 P${n}`, 'M66 P3 L3 Q1']),
    on: () => ['M03 $0 S1'],       // QtPlasmaC: probe + pierce + arc-ok + THC gestiti internamente
    off: () => ['M05 $0'],
    pierce: () => [],              // niente G04: lo fa QtPlasmaC dalla tabella materiale
    postamble: ['M05 $0', 'M2'],
    comment: (t) => `(${t.replace(/[()]/g, '')})`,
  },
  linuxcnc: {
    title: 'LinuxCNC / plasma generico',
    preamble: ['G17 G54 G40 G49 G80 G90', 'G21'],
    material: () => [],
    on: (S) => [`M3 S${S}`],
    off: () => ['M5'],
    pierce: (s) => (s > 0 ? [`G4 P${f(s)}`] : []),
    postamble: ['M05', 'G17 G90', 'M2'],
    comment: (t) => `(${t.replace(/[()]/g, '')})`,
  },
  grbl: {
    title: 'GRBL (laser/plasma)',
    preamble: ['G21', 'G90', 'G17'],
    material: () => [],
    on: (S) => [`M3 S${S}`],
    off: () => ['M5'],
    pierce: (s) => (s > 0 ? [`G4 P${f(s)}`] : []),
    postamble: ['M5', 'G17 G90', 'M2'],
    comment: (t) => `; ${t}`,
  },
  mach3: {
    title: 'Mach3 (plasma)',
    preamble: ['G21 G40 G90 G94 G17'],
    material: () => [],
    on: () => ['M3'],                    // Mach3: torcia ON = spindle M3
    off: () => ['M5'],
    pierce: (s) => (s > 0 ? [`G4 P${f(s)}`] : []),
    postamble: ['M5', 'G0 X0 Y0', 'M30'],
    comment: (t) => `(${t.replace(/[()]/g, '')})`,
  },
  mach4: {
    title: 'Mach4 (plasma)',
    preamble: ['G21 G40 G90 G94 G17'],
    material: () => [],
    on: () => ['M3'],
    off: () => ['M5'],
    pierce: (s) => (s > 0 ? [`G4 P${f(s)}`] : []),
    postamble: ['M5', 'M30'],
    comment: (t) => `(${t.replace(/[()]/g, '')})`,
  },
  uccnc: {
    title: 'UCCNC (plasma)',
    preamble: ['G21 G40 G90 G94 G17'],
    material: () => [],
    on: () => ['M3'],
    off: () => ['M5'],
    pierce: (s) => (s > 0 ? [`G4 P${f(s)}`] : []),
    postamble: ['M5', 'M30'],
    comment: (t) => `(${t.replace(/[()]/g, '')})`,
  },
};

/**
 * Dialetto CUSTOM costruito dai template dell'utente (per controller non in lista).
 * @param {{preamble?:string, on?:string, off?:string, postamble?:string, comment?:string, pierce?:boolean}} cp
 */
function buildCustom(cp) {
  const lines = (s, def) => String(s ?? def).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  return {
    title: 'Custom',
    preamble: lines(cp.preamble, 'G21 G90'),
    material: () => [],
    on: () => lines(cp.on, 'M3'),
    off: () => lines(cp.off, 'M5'),
    pierce: (s) => (cp.pierce !== false && s > 0 ? [`G4 P${f(s)}`] : []),
    postamble: lines(cp.postamble, 'M5\nM2'),
    comment: cp.comment === ';' ? (t) => `; ${t}` : (t) => `(${t.replace(/[()]/g, '')})`,
  };
}

/**
 * @typedef {{pts:{u:number,v:number}[], lead:{u:number,v:number}[], tag?:string, hole?:boolean, depth?:number}} SheetContour
 * @typedef {{dialect?:'qtplasmac'|'grbl'|'linuxcnc', feed?:number, power?:number, thickness?:number,
 *   pierceMs?:number, material?:number|null, tabCount?:number, tabLen?:number, name?:string}} SheetPostOpts
 */

/**
 * Emette il G-code di taglio lamiera piatta dai contorni compensati kerf+lead.
 * @param {{contours:SheetContour[], holes?:number, sheet?:boolean, skipped?:number}} cam
 * @param {SheetPostOpts} [opts]
 * @returns {{text:string, lines:string[]}}
 */
export function postSheetCut(cam, opts = {}) {
  const d = opts.dialect === 'custom' ? buildCustom(opts.customPost || {}) : (DIALECTS[opts.dialect || 'qtplasmac'] || DIALECTS.qtplasmac);
  const feed = numOr(opts.feed, 3000);        // scarta NaN (campo UI svuotato) → default, mai "FNaN"
  const power = numOr(opts.power, 800);
  const material = opts.material === undefined ? 0 : opts.material;
  const tabCount = numOr(opts.tabCount, 0);
  const tabLen = numOr(opts.tabLen, 3);
  const engrave = !!opts.engrave;             // marcatura/scribe on-line (no taglio passante)
  const pierceS = engrave ? 0 : (opts.pierceMs !== undefined ? opts.pierceMs / 1000 : Math.max(0.3, 0.07 * (opts.thickness ?? 2)));
  // QtPlasmaC ha lo SCRIBE come tool #1 (M03 $1): usato per marcare senza tagliare.
  const scribe = engrave && (opts.dialect || 'qtplasmac') === 'qtplasmac';
  const onCodes = scribe ? ['M03 $1 S1'] : d.on(power);
  const offCodes = scribe ? ['M05 $1'] : d.off();
  const xy = (p) => ({ x: p.u, y: p.v });

  /** @type {string[]} */ const L = [];
  L.push(d.comment(`Taglio lamiera piatta — CamForge (post ${d.title})`));
  L.push(d.comment(`contorni ${cam.contours.length}${cam.holes != null ? ` (${cam.holes} fori)` : ''} · feed ${feed} mm/min${tabCount ? ` · ${tabCount} tab da ${tabLen} mm` : ''}`));
  L.push(...d.preamble);
  L.push(...d.material(material));

  cam.contours.forEach((c, i) => {
    L.push(d.comment(`contorno ${i + 1}/${cam.contours.length}${c.tag ? ` ${c.tag}` : ''}${c.hole ? ' [foro]' : ' [perimetro]'}`));
    const lead = (c.lead || []).map(xy);
    const pts = c.pts.map(xy);
    // tab SOLO sui perimetri (i fori: lo sfrido cade, niente tab)
    const runs = (!c.hole && tabCount > 0) ? planTabRuns(pts, tabCount, tabLen) : [pts];

    // primo run: preceduto dal lead-in (che termina su pts[0] = runs[0][0])
    const cf = numOr(c.feed, feed);     // feed per-contorno (regola fori piccoli), NaN-safe
    const first = runs[0];
    const entry = lead.length ? lead[0] : first[0];
    L.push(`G0 X${f(entry.x)} Y${f(entry.y)}`);
    L.push(...onCodes);
    L.push(...d.pierce(pierceS));
    let feededOnce = false;
    const g1 = (p) => { L.push(`G1 X${f(p.x)} Y${f(p.y)}${feededOnce ? '' : ` F${f(cf)}`}`); feededOnce = true; };
    for (const p of lead.slice(1)) g1(p);           // lead-in (dal 2° punto)
    // start da k=1: il punto d'attacco (first[0]) è già raggiunto dal G0/lead → niente G1 nullo
    for (let k = 1; k < first.length; k++) g1(first[k]);
    // run successivi: tab = torcia OFF, rapido oltre il ponticello, riaccendi
    for (let r = 1; r < runs.length; r++) {
      L.push(...offCodes);
      const run = runs[r];
      L.push(`G0 X${f(run[0].x)} Y${f(run[0].y)}`);
      L.push(...onCodes);
      L.push(...d.pierce(pierceS));
      feededOnce = false;
      for (let k = 1; k < run.length; k++) g1(run[k]);
    }
    L.push(...offCodes);
  });

  L.push(...d.postamble);
  return { text: L.join('\n') + '\n', lines: L };
}
