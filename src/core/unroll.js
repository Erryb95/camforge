// @ts-check
// Sviluppo ("tubo svolto") della superficie del tubo su un piano:
//   u = posizione assiale lungo il tubo (mm)
//   v = ascissa curvilinea sul perimetro della sezione (mm), 0 = centro faccia superiore
// Usato dal dialetto laser tubo NC (testa Y/Z + rotazione P + carro X_1)
// e dal loader AlmaCAM (punti già nel sistema tubo).

/**
 * @typedef {{type:'round', r:number, per:number}|{type:'rect', w:number, h:number, per:number}} TubeProfile
 */

/** Profilo del tubo dai metadati (WW/WH rettangolare, DM tondo). @returns {TubeProfile|null} */
export function profileFromMeta(meta) {
  if (meta && meta.tubeWidth && meta.tubeHeight) {
    return { type: 'rect', w: meta.tubeWidth, h: meta.tubeHeight, per: 2 * (meta.tubeWidth + meta.tubeHeight) };
  }
  if (meta && meta.tubeDiameter) {
    const r = meta.tubeDiameter / 2;
    return { type: 'round', r, per: 2 * Math.PI * r };
  }
  return null;
}

/**
 * Ascissa perimetrale in [-per/2, per/2) del punto di sezione (yt, zt) nel
 * sistema tubo. v=0 al centro della faccia superiore, cresce verso +yt.
 * I punti fuori dal bordo (testa sollevata) o interni (raccordi spigoli)
 * vengono proiettati sul bordo più vicino.
 * @param {number} yt @param {number} zt @param {TubeProfile} profile
 */
export function perimeterParam(yt, zt, profile) {
  const per = profile.per;
  let s;
  if (profile.type === 'round') {
    s = Math.atan2(yt, zt) * profile.r;
  } else {
    const a = profile.w / 2, b = profile.h / 2;
    let y = Math.min(a, Math.max(-a, yt));
    let z = Math.min(b, Math.max(-b, zt));
    if (y === yt && z === zt) {
      // punto interno: spingi sul bordo più vicino
      const dTop = b - z, dBot = z + b, dRight = a - y, dLeft = y + a;
      const m = Math.min(dTop, dBot, dRight, dLeft);
      if (m === dTop) z = b;
      else if (m === dBot) z = -b;
      else if (m === dRight) y = a;
      else y = -a;
    }
    // cammino orario dal centro della faccia superiore
    if (z === b) s = y;                              // faccia superiore
    else if (y === a) s = a + (b - z);               // fianco destro
    else if (z === -b) s = a + 2 * b + (a - y);      // fondo
    else s = 3 * a + 2 * b + (z + b);                // fianco sinistro
  }
  // centra in [-per/2, per/2)
  return ((s % per) + per + per / 2) % per - per / 2;
}

/**
 * Punto della sezione tubo che si trova sotto la testa (y, z) quando il tubo
 * è ruotato di rotDeg gradi.
 */
export function headToTube(y, z, rotDeg) {
  const f = (rotDeg * Math.PI) / 180;
  return {
    yt: y * Math.cos(f) + z * Math.sin(f),
    zt: -y * Math.sin(f) + z * Math.cos(f),
  };
}

/**
 * Continuità di v: sceglie il multiplo del perimetro più vicino al punto
 * precedente, così i percorsi che attraversano la "cucitura" non saltano.
 * `reset()` riparte dalla fascia base [-per/2, per/2): va chiamato a ogni
 * riposizionamento (nuovo contorno), altrimenti i giri completi di contorni
 * successivi si accumulano e il nastro svolto "sale" all'infinito.
 * @param {number} per
 */
export function makeUnwrapper(per) {
  let prev = /** @type {number|null} */ (null);
  return {
    next(vRaw) {
      if (prev === null) { prev = vRaw; return vRaw; }
      const v = vRaw + per * Math.round((prev - vRaw) / per);
      prev = v;
      return v;
    },
    reset() { prev = null; },
  };
}

/** Linee guida orizzontali per la vista svolta (bordi delle facce / quadranti). */
export function guidesFor(profile) {
  if (profile.type === 'rect') {
    const a = profile.w / 2, b = profile.h / 2;
    return [-(a + 2 * b + a), -(a + 2 * b), -a, a, a + 2 * b, a + 2 * b + a];
  }
  const q = (Math.PI * profile.r) / 2;
  return [-2 * q, -q, q, 2 * q];
}

/**
 * Post-pass per il dialetto NC tubo: calcola seg.uv per ogni segmento.
 *   u = X_1 (carro, modale: seg.aux0→aux1) + X (testa)
 *   v = sviluppo perimetrale di (Y, Z)
 * NOTA dialetto (verificato sui file Adige del cliente): il post-processor
 * scrive Y/Z già nel SISTEMA PEZZO (durante la troncatura (Y,Z) percorre
 * esattamente il perimetro della sezione, con Z anche sotto l'asse). La
 * rotazione P è quindi solo cinematica macchina e NON va riapplicata alla
 * geometria — farlo raddoppierebbe lo sviluppo (bug storico, non reintrodurlo).
 * I segmenti di solo avanzamento carro (len 0 in coordinate testa) ricevono
 * come len la lunghezza del percorso sviluppato.
 * @param {import('./model.js').Segment[]} segments
 * @param {Record<string, any>} meta  aggiornato con unrollAvailable/perimeter/unrollGuides
 */
export function applyTubeUnroll(segments, meta) {
  // profilo "auto" (header .pgm G2292 dà solo il bounding box): se i punti
  // in lavoro giacciono a raggio ~costante la sezione è tonda, altrimenti
  // resta il rettangolo del bounding box
  if (meta.profileAuto && meta.tubeWidth && meta.tubeHeight) {
    let rMin = Infinity, rMax = -Infinity, rSum = 0, n = 0;
    for (const seg of segments) {
      if (seg.type === 'rapid') continue;
      for (const p of [seg.from, seg.to]) {
        const r = Math.hypot(p.y, p.z);
        if (r < rMin) rMin = r;
        if (r > rMax) rMax = r;
        rSum += r; n++;
      }
      if (n > 800) break;
    }
    if (n > 10) {
      const mean = rSum / n;
      if (mean > 1e-6 && (rMax - rMin) / mean < 0.05) {
        meta.tubeDiameter = 2 * mean;
        delete meta.tubeWidth;
        delete meta.tubeHeight;
      }
    }
    meta.profileAuto = false;
  }

  const profile = profileFromMeta(meta);
  if (!profile || !segments.length) return;
  const unwrap = makeUnwrapper(profile.per);

  for (const seg of segments) {
    // un rapido = riposizionamento: il contorno successivo riparte nella fascia base
    if (seg.type === 'rapid') unwrap.reset();
    const aux0 = seg.aux0 ?? seg.aux1 ?? 0;
    const aux1 = seg.aux1 ?? aux0;

    const base = seg.pts.length > 2 ? seg.pts : [seg.from, seg.to];
    const uv = [];
    for (let i = 0; i < base.length; i++) {
      const t = i / (base.length - 1);
      const p = base[i];
      uv.push({
        u: aux0 + (aux1 - aux0) * t + p.x,
        v: unwrap.next(perimeterParam(p.y, p.z, profile)),
      });
    }
    seg.uv = uv;

    if (seg.len < 1e-9) {
      let uvLen = 0;
      for (let i = 1; i < uv.length; i++) {
        uvLen += Math.hypot(uv[i].u - uv[i - 1].u, uv[i].v - uv[i - 1].v);
      }
      seg.len = uvLen;
    }
  }

  meta.unrollAvailable = true;
  meta.perimeter = profile.per;
  meta.unrollGuides = guidesFor(profile);
}
