// @ts-check
// REPORT lavoro: stima TEMPO e COSTO da un programma di taglio X/Y. SheetCam dà
// solo il tempo di taglio; qui aggiungiamo il preventivo (macchina + consumabili +
// materiale). Calcolo dal G-code emesso (robusto per ogni dialetto).

/**
 * Stima da G-code piatto (X/Y): lunghezze, pierce, tempi e costi.
 * @param {string} gcode
 * @param {{feed?:number, rapidRate?:number, pierceSec?:number, ratePerHour?:number,
 *   costPerPierce?:number, materialCost?:number}} [opts]
 */
export function estimateJob(gcode, opts = {}) {
  const feed = opts.feed ?? 3000;               // mm/min di taglio
  const rapidRate = opts.rapidRate ?? 10000;    // mm/min dei rapidi
  const pierceSec = opts.pierceSec ?? 0.5;
  let cutLen = 0, rapidLen = 0, pierces = 0;
  let x = 0, y = 0, seen = false;
  for (const line of gcode.split('\n')) {
    if (/^\s*M0?3\b/.test(line)) pierces++;
    const isG0 = /^\s*G0\b/.test(line), isG1 = /^\s*G0?1\b/.test(line);
    if (!isG0 && !isG1) continue;
    const mx = /X(-?[\d.]+)/.exec(line), my = /Y(-?[\d.]+)/.exec(line);
    if (!mx && !my) continue;
    const nx = mx ? +mx[1] : x, ny = my ? +my[1] : y;
    if (seen) { const d = Math.hypot(nx - x, ny - y); if (isG0) rapidLen += d; else cutLen += d; }
    x = nx; y = ny; seen = true;
  }
  const cutMin = feed > 0 ? cutLen / feed : 0;
  const rapidMin = rapidRate > 0 ? rapidLen / rapidRate : 0;
  const pierceMin = (pierces * pierceSec) / 60;
  const timeMin = cutMin + rapidMin + pierceMin;

  const ratePerHour = opts.ratePerHour ?? 0;    // €/h macchina+operatore
  const costPerPierce = opts.costPerPierce ?? 0;
  const materialCost = opts.materialCost ?? 0;
  const machineCost = (timeMin / 60) * ratePerHour;
  const consumables = pierces * costPerPierce;
  const total = machineCost + consumables + materialCost;
  return { cutLen, rapidLen, pierces, cutMin, rapidMin, pierceMin, timeMin, machineCost, consumables, materialCost, total };
}

const mmss = (min) => { const s = Math.round(min * 60); return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; };
const eur = (n) => `€ ${n.toFixed(2)}`;

/** Report testuale scaricabile. @param {ReturnType<typeof estimateJob>} e */
export function reportText(e, meta = {}) {
  const L = [
    'CamForge — Report lavoro',
    meta.name ? `File:       ${meta.name}` : null,
    meta.material ? `Materiale:  ${meta.material}` : null,
    meta.qty ? `Pezzi:      ${meta.qty}` : null,
    '',
    `Lunghezza taglio:  ${e.cutLen.toFixed(0)} mm`,
    `Rapidi:            ${e.rapidLen.toFixed(0)} mm`,
    `Sfondamenti:       ${e.pierces}`,
    '',
    `Tempo taglio:      ${mmss(e.cutMin)}`,
    `Tempo rapidi:      ${mmss(e.rapidMin)}`,
    `Tempo pierce:      ${mmss(e.pierceMin)}`,
    `TEMPO TOTALE:      ${mmss(e.timeMin)}`,
  ];
  if (e.total > 0) {
    L.push('',
      e.machineCost > 0 ? `Costo macchina:    ${eur(e.machineCost)}` : null,
      e.consumables > 0 ? `Consumabili:       ${eur(e.consumables)}` : null,
      e.materialCost > 0 ? `Materiale:         ${eur(e.materialCost)}` : null,
      `COSTO TOTALE:      ${eur(e.total)}`);
  }
  return L.filter((s) => s !== null).join('\n') + '\n';
}
