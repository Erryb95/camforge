// @ts-check
// Generatore ZERO-DEP di FRESE realistiche (mesh) che variano per materiale.
// Non ricolora un'unica punta: costruisce una geometria DIVERSA per numero di
// taglienti (lobi elicoidali), angolo d'elica e forma del tagliente (flat/ball/vee).
// Asse lungo +Y con il tagliente all'estremo Y-min (stessa convenzione dello STL
// cncjs/bit.stl) così `placeMillBit()` la orienta verticale senza modifiche.
//
// Modello: la sezione trasversale è un profilo a N lobi (lands) separati da N gole
// (flutes); ruotando il profilo con la quota Y si ottiene la caratteristica elica.
// Sopra la zona di taglio c'è il gambo (cilindro liscio). Dati geometrici coerenti
// con frese commerciali (Lc ≈ 2.4·D, gambo ≈ 2.2·D, gola ≈ 0.38·D).

const TAU = Math.PI * 2;

/**
 * @param {{dia?:number, flutes?:number, tip?:'flat'|'ball'|'vee', helixDeg?:number,
 *          veeDeg?:number, seg?:number, toolId?:number}} [spec]
 * @returns {{positions:Float64Array, indices:Uint32Array, triTool:Uint32Array,
 *            tip:number[], dia:number, len:number}}
 */
export function makeEndmill(spec = {}) {
  const dia = spec.dia ?? 6;
  const R = dia / 2;
  const flutes = Math.max(1, Math.min(6, Math.round(spec.flutes ?? 2)));
  const tip = spec.tip ?? 'flat';
  const helix = (spec.helixDeg ?? 30) * Math.PI / 180;
  const seg = spec.seg ?? Math.max(56, flutes * 18);   // campioni angolari
  const toolId = spec.toolId ?? 5;

  const Lc = 2.4 * dia;          // lunghezza di taglio (parte fresata)
  const Ls = 2.2 * dia;          // gambo
  const landMin = 0.60;          // fondo gola = 60% del raggio
  const twist = Math.tan(helix) / Math.max(R, 1e-6);   // rad d'elica per mm

  // Modulazione a N lobi: 1 sulle lands (r=R), landMin nelle gole. Ruota con y (elica).
  const fluteFactor = (theta, y) => {
    const phase = flutes * (theta + twist * y);
    const lobe = Math.pow((Math.cos(phase) + 1) / 2, 2.2);   // 0..1, picco = land
    return landMin + (1 - landMin) * lobe;
  };

  /** @type {{y:number, env:number, fluted:boolean}[]} rings dal basso (tip) verso l'alto */
  const rings = [];
  let yTip = 0;   // quota della punta (vertice inferiore)

  if (tip === 'ball') {
    // Calotta emisferica di raggio R: y in [0..R], inviluppo = sin dell'angolo.
    const nb = 10;
    for (let i = 1; i <= nb; i++) {
      const y = (R * i) / nb;
      const env = Math.sqrt(Math.max(0, 1 - ((R - y) / R) ** 2));
      rings.push({ y, env, fluted: true });
    }
  } else if (tip === 'vee') {
    // Cono d'incisione: semiangolo → altezza Hc; il tagliente parte a punta.
    const half = ((spec.veeDeg ?? 60) / 2) * Math.PI / 180;
    const Hc = R / Math.tan(half);
    const nv = 8;
    for (let i = 1; i <= nv; i++) rings.push({ y: (Hc * i) / nv, env: i / nv, fluted: true });
  } else {
    // Flat: fondo piano a y=0 (il fan dal centro chiude la faccia di testa).
    rings.push({ y: 0, env: 1, fluted: true });
  }

  const bodyBase = rings.length ? rings[rings.length - 1].y : 0;
  const nBody = 20;
  for (let i = 1; i <= nBody; i++) rings.push({ y: bodyBase + (Lc * i) / nBody, env: 1, fluted: true });
  const shankBase = rings[rings.length - 1].y;
  const nSh = 4;
  for (let i = 1; i <= nSh; i++) rings.push({ y: shankBase + (Ls * i) / nSh, env: 1, fluted: false });

  // ---- vertici: vertice-punta + anelli + vertice-cima -----------------------
  const pos = [];
  const tipIdx = 0;
  pos.push(0, yTip, 0);                                   // 0: punta (tagliente)
  const ringStart = [];
  for (const rg of rings) {
    ringStart.push(pos.length / 3);
    for (let a = 0; a < seg; a++) {
      const th = (a / seg) * TAU;
      const r = rg.env * (rg.fluted ? fluteFactor(th, rg.y) : 1) * R;
      pos.push(r * Math.cos(th), rg.y, r * Math.sin(th));
    }
  }
  const topIdx = pos.length / 3;
  pos.push(0, rings[rings.length - 1].y, 0);             // cima del gambo

  // ---- triangoli ------------------------------------------------------------
  const idx = [];
  // fan inferiore: punta → primo anello
  const r0 = ringStart[0];
  for (let a = 0; a < seg; a++) idx.push(tipIdx, r0 + a, r0 + ((a + 1) % seg));
  // strisce tra anelli
  for (let k = 0; k < rings.length - 1; k++) {
    const A0 = ringStart[k], A1 = ringStart[k + 1];
    for (let a = 0; a < seg; a++) {
      const b = (a + 1) % seg;
      idx.push(A0 + a, A1 + a, A1 + b);
      idx.push(A0 + a, A1 + b, A0 + b);
    }
  }
  // cappello superiore: ultimo anello → cima
  const rl = ringStart[rings.length - 1];
  for (let a = 0; a < seg; a++) idx.push(topIdx, rl + ((a + 1) % seg), rl + a);

  const positions = new Float64Array(pos);
  const indices = new Uint32Array(idx);
  const triTool = new Uint32Array(indices.length / 3).fill(toolId);
  return { positions, indices, triTool, tip: [0, yTip, 0], dia: 2 * R, len: rings[rings.length - 1].y - yTip };
}

/** Estrae l'angolo d'elica (gradi) dalla descrizione geometrica del materiale. */
export function helixFromGeom(geom) {
  const m = String(geom || '').match(/(\d{2})\s*°/);
  return m ? Math.max(10, Math.min(50, +m[1])) : 30;
}

/**
 * Specifica della punta consigliata per un materiale (n. taglienti, elica, tip).
 * Le plastiche O-flute → 1 tagliente affilato; il resto è una fresa a codolo flat.
 * @param {{flutes?:number, geom?:string, cat?:string}} mat
 */
export function bitSpecForMaterial(mat) {
  return {
    dia: 6,
    flutes: mat.flutes ?? 2,
    tip: 'flat',
    helixDeg: helixFromGeom(mat.geom),
  };
}
