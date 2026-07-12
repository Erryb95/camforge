// @ts-check
// Ordinamento della sequenza di taglio per geometrie senza ordine intrinseco
// (STEP/IGES/DWG): gli spigoli grezzi arrivano in ordine di mesh/entità (casuale
// nello spazio). Qui li concateniamo in CONTORNI connessi e ordiniamo i contorni
// partendo da un'estremità del pezzo e proseguendo per prossimità (nearest-neighbor),
// che è la regola standard del taglio laser lamiera/tubo.

const TOL = 1e-3;   // tolleranza di coincidenza vertici (mm)

/** Chiave di quantizzazione di un punto 3D. */
const key = (p) => `${Math.round(p.x / TOL)},${Math.round(p.y / TOL)},${Math.round(p.z / TOL)}`;
const mid = (s) => ({ x: (s.from.x + s.to.x) / 2, y: (s.from.y + s.to.y) / 2, z: (s.from.z + s.to.z) / 2 });
const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;

/**
 * Concatena i segmenti in catene connesse (contorni).
 * @param {import('../../core/model.js').Segment[]} segs
 * @returns {{segs:import('../../core/model.js').Segment[], start:{x,y,z}, end:{x,y,z}}[]}
 */
export function chainSegments(segs) {
  /** @type {Map<string, number[]>} indice punto→segmenti incidenti */
  const inc = new Map();
  const add = (p, i) => { const k = key(p); (inc.get(k) || inc.set(k, []).get(k)).push(i); };
  segs.forEach((s, i) => { add(s.from, i); add(s.to, i); });

  const used = new Uint8Array(segs.length);
  const chains = [];

  const nextFrom = (pt, exclude) => {
    const cand = inc.get(key(pt)) || [];
    for (const j of cand) if (!used[j] && j !== exclude) return j;
    return -1;
  };

  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const chain = [segs[i]];
    let head = { ...segs[i].from };
    let tail = { ...segs[i].to };

    // estendi in avanti dalla coda
    for (;;) {
      const j = nextFrom(tail, -1);
      if (j < 0) break;
      used[j] = 1;
      const s = segs[j];
      if (key(s.from) === key(tail)) { chain.push(s); tail = { ...s.to }; }
      else { chain.push(s); tail = { ...s.from }; }   // orientamento invertito, ok per il disegno
      if (key(tail) === key(head)) break;             // contorno chiuso
    }
    // estendi all'indietro dalla testa
    for (;;) {
      const j = nextFrom(head, -1);
      if (j < 0) break;
      used[j] = 1;
      const s = segs[j];
      if (key(s.to) === key(head)) { chain.unshift(s); head = { ...s.from }; }
      else { chain.unshift(s); head = { ...s.to }; }
    }
    chains.push({ segs: chain, start: head, end: tail });
  }
  return chains;
}

/** Asse principale del pezzo (0=x,1=y,2=z): la dimensione di ingombro maggiore. */
function principalAxis(segs) {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const s of segs) for (const p of [s.from, s.to]) {
    if (p.x < min.x) min.x = p.x; if (p.x > max.x) max.x = p.x;
    if (p.y < min.y) min.y = p.y; if (p.y > max.y) max.y = p.y;
    if (p.z < min.z) min.z = p.z; if (p.z > max.z) max.z = p.z;
  }
  const ext = [max.x - min.x, max.y - min.y, max.z - min.z];
  const axis = ext[0] >= ext[1] && ext[0] >= ext[2] ? 'x' : ext[1] >= ext[2] ? 'y' : 'z';
  return { axis, min: min[axis] };
}

/**
 * Ordina le catene: parti dall'estremità (minimo lungo l'asse principale),
 * poi nearest-neighbor sull'estremo più vicino, orientando ogni catena.
 * @param {ReturnType<typeof chainSegments>} chains
 * @param {import('../../core/model.js').Segment[]} allSegs
 */
export function orderChains(chains, allSegs) {
  if (chains.length <= 1) return chains;
  const { axis } = principalAxis(allSegs);
  const cval = (c) => Math.min(c.start[axis], c.end[axis]);   // quota dell'estremità

  const remaining = chains.slice();
  // partenza: catena più vicina a un'estremità del pezzo
  remaining.sort((a, b) => cval(a) - cval(b));
  const ordered = [remaining.shift()];
  let cursor = ordered[0].end;

  while (remaining.length) {
    let best = 0, bestD = Infinity, flip = false;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      const dStart = d2(cursor, c.start);
      const dEnd = d2(cursor, c.end);
      if (dStart < bestD) { bestD = dStart; best = i; flip = false; }
      if (dEnd < bestD) { bestD = dEnd; best = i; flip = true; }
    }
    const c = remaining.splice(best, 1)[0];
    if (flip) { c.segs.reverse(); const t = c.start; c.start = c.end; c.end = t; }
    ordered.push(c);
    cursor = c.end;
  }
  return ordered;
}

/**
 * Riordina una lista piatta di segmenti in sequenza di taglio coerente.
 * @param {import('../../core/model.js').Segment[]} segs
 * @returns {import('../../core/model.js').Segment[]}
 */
export function sequenceSegments(segs) {
  if (segs.length < 3) return segs;
  const chains = chainSegments(segs);
  const ordered = orderChains(chains, segs);
  const out = [];
  for (const c of ordered) for (const s of c.segs) out.push(s);
  // sicurezza: se qualcosa è andato storto, non perdere segmenti
  return out.length === segs.length ? out : segs;
}
