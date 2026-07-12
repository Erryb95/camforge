// @ts-check
// Ricostruzione del TUBO SOLIDO in 3D per i file laser-tubo (NC/pgm/alma).
// Fatto chiave del dialetto: (Y,Z) di ogni punto sono già le coordinate della
// SEZIONE nel sistema pezzo, e l'ascissa assiale è u (= carro X_1 + testa X).
// Quindi il punto 3D sul tubo è semplicemente { x: u, y: Ysez, z: Zsez }:
// nessuna inversione necessaria. Costruiamo la superficie del tubo (cilindro o
// cassone) lungo X e vi appoggiamo sopra i contorni di taglio.

const TUBE_TOOL = 0;   // il tubo usa il colore base (ciano)

/**
 * Superficie solida del tubo lungo l'asse X, sezione nel piano Y-Z.
 * @param {{type:'round',r:number,per:number}|{type:'rect',w:number,h:number,per:number}} profile
 * @param {number} xMin @param {number} xMax
 * @param {number} [wall] spessore parete (mm): se >0 aggiunge la parete interna
 */
export function buildTubeMesh(profile, xMin, xMax, wall = 0) {
  /** @type {number[]} */ const positions = [];
  /** @type {number[]} */ const indices = [];
  /** @type {number[]} */ const triTool = [];

  // punti della sezione (outline chiuso) nel piano Y-Z
  const outer = sectionOutline(profile, 0);
  const shells = [outer];
  if (wall > 0) shells.push(sectionOutline(profile, -wall));   // parete interna

  for (const sect of shells) {
    const N = sect.length;
    const base = positions.length / 3;
    for (const x of [xMin, xMax]) for (const [y, z] of sect) positions.push(x, y, z);
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const A = base + i, B = base + j, C = base + N + i, D = base + N + j;
      indices.push(A, C, B, B, C, D);
      triTool.push(TUBE_TOOL, TUBE_TOOL);
    }
  }

  return {
    positions: new Float64Array(positions),
    indices: new Uint32Array(indices),
    triTool: new Uint32Array(triTool),
  };
}

/** Outline della sezione (offset<0 = rientro parete). @returns {number[][]} [y,z] */
function sectionOutline(profile, offset) {
  if (profile.type === 'round') {
    const r = Math.max(0.1, profile.r + offset);
    const N = 56;
    const out = [];
    for (let i = 0; i < N; i++) {
      const a = (2 * Math.PI * i) / N;
      out.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    return out;
  }
  const a = Math.max(0.1, profile.w / 2 + offset);
  const b = Math.max(0.1, profile.h / 2 + offset);
  return [[-a, b], [a, b], [a, -b], [-a, -b]];
}

/**
 * Avvolge i segmenti sul tubo (imposta seg.tubePts) e costruisce model.mesh.
 * Va chiamato dopo che seg.uv è stato calcolato.
 * @param {import('../../core/model.js').Segment[]} segments
 * @param {*} profile
 * @param {number} [wall]
 * @returns {{positions:Float64Array, indices:Uint32Array, triTool:Uint32Array}|null}
 */
export function wrapOnTube(segments, profile, wall = 0) {
  if (!profile) return null;
  let uMin = Infinity, uMax = -Infinity;
  for (const seg of segments) {
    if (!seg.uv) continue;
    const base = seg.pts.length === seg.uv.length ? seg.pts : null;
    /** @type {{x:number,y:number,z:number}[]} */
    const tubePts = [];
    for (let i = 0; i < seg.uv.length; i++) {
      const u = seg.uv[i].u;
      // (y,z) della sezione: dal punto tessellato se allineato, altrimenti interpola from→to
      let y, z;
      if (base) { y = base[i].y; z = base[i].z; }
      else {
        const t = i / (seg.uv.length - 1);
        y = seg.from.y + (seg.to.y - seg.from.y) * t;
        z = seg.from.z + (seg.to.z - seg.from.z) * t;
      }
      tubePts.push({ x: u, y, z });
      if (u < uMin) uMin = u;
      if (u > uMax) uMax = u;
    }
    seg.tubePts = tubePts;
  }
  if (uMin === Infinity) return null;
  const margin = Math.max(2, (uMax - uMin) * 0.02);
  return buildTubeMesh(profile, uMin - margin, uMax + margin, wall);
}
