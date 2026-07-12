// @ts-check
// Modello di scena COMUNE a tutti i formati (nc, dxf, dwg, step...).
// I loader producono questo modello; il renderer consuma SOLO questo modello.

/**
 * @typedef {{x:number, y:number, z:number}} P3
 *
 * @typedef {Object} Segment
 * @property {'rapid'|'feed'|'arc'} type
 * @property {P3} from
 * @property {P3} to
 * @property {P3[]} pts        punti tessellati (per le linee: [from, to])
 * @property {number} line     riga sorgente (1-based) che ha generato il segmento
 * @property {number} tool     utensile attivo (0 = nessuno)
 * @property {number|null} feed  avanzamento mm/min (solo type feed/arc)
 * @property {number} len      lunghezza 3D in mm
 * @property {boolean} [cw]    solo archi: senso orario
 * @property {P3} [center]     solo archi
 * @property {number} [radius] solo archi
 * @property {string} [plane]  solo archi: XY | ZX | YZ
 * @property {boolean} [implicit] partenza da posizione mai impostata (non affidabile)
 *
 * @typedef {Object} DrillPoint
 * @property {P3} at
 * @property {string} cycle    es. "G81"
 * @property {number} line
 * @property {number} tool
 * @property {number} afterSeg indice del segmento dopo il quale avviene (per l'animazione)
 *
 * @typedef {Object} Bounds
 * @property {P3} min
 * @property {P3} max
 *
 * @typedef {Object} SceneModel
 * @property {string} name       nome file
 * @property {string|null} program  numero programma (Oxxxx)
 * @property {'mm'|'in'} units   unità dichiarate nel file (interno sempre mm)
 * @property {Segment[]} segments
 * @property {DrillPoint[]} drillPoints
 * @property {{line:number, msg:string}[]} warnings
 * @property {string[]} rawLines
 * @property {Bounds|null} bounds      ingombro di tutte le corse
 * @property {Bounds|null} boundsFeed  ingombro del solo percorso in lavoro
 * @property {{feedLen:number, rapidLen:number, timeMin:number|null, tools:number[]}} stats
 */

/** Crea un accumulatore di bounds. */
export function newBounds() {
  return {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
    /** @param {P3} p */
    add(p) {
      if (p.x < this.min.x) this.min.x = p.x;
      if (p.y < this.min.y) this.min.y = p.y;
      if (p.z < this.min.z) this.min.z = p.z;
      if (p.x > this.max.x) this.max.x = p.x;
      if (p.y > this.max.y) this.max.y = p.y;
      if (p.z > this.max.z) this.max.z = p.z;
    },
    valid() { return this.min.x !== Infinity; },
    /** @returns {Bounds|null} */
    result() {
      return this.valid() ? { min: { ...this.min }, max: { ...this.max } } : null;
    },
  };
}

/** Distanza 3D. @param {P3} a @param {P3} b */
export function dist3(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}
