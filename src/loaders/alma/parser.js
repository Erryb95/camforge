// @ts-check
// Loader AlmaCAM (LXDDocument XML: file .cn / .ctd delle macchine taglio tubo Alma).
// La geometria è già esplicita: polilinee 3D per ogni curva di taglio.
// Il "listato" mostrato nel pannello codice è un indice sintetico delle curve.

import { newBounds, dist3 } from '../../core/model.js';

const POLY_RE = /<Polyline3D[^>]*>([\s\S]*?)<\/Polyline3D>/g;
const PT_RE = /<Point3D\s+X="([^"]+)"\s+Y="([^"]+)"\s+Z="([^"]+)"/g;

/**
 * @param {string} text
 * @param {string} [fileName]
 * @returns {import('../../core/model.js').SceneModel}
 */
export function parseAlma(text, fileName = '') {
  /** @type {import('../../core/model.js').Segment[]} */
  const segments = [];
  /** @type {{line:number, msg:string}[]} */
  const warnings = [];
  /** @type {string[]} */
  const listing = [];
  /** @type {Record<string, any>} */
  const meta = { dialect: 'AlmaCAM' };

  const mLen = /TubeLength="([\d.]+)"/.exec(text);
  if (mLen) meta.tubeLength = parseFloat(mLen[1]);
  const mName = /TubeName="([^"]*)"/.exec(text);
  if (mName) meta.tubeName = mName[1];
  const mExtMin = /<ExtMin X="([-\d.]+)" Y="([-\d.]+)"/.exec(text);
  const mExtMax = /<ExtMax X="([-\d.]+)" Y="([-\d.]+)"/.exec(text);
  if (mExtMin && mExtMax) {
    meta.tubeDiameter = Math.max(
      parseFloat(mExtMax[1]) - parseFloat(mExtMin[1]),
      parseFloat(mExtMax[2]) - parseFloat(mExtMin[2]),
    );
  }

  if (!text.includes('<LXDDocument')) {
    warnings.push({ line: 1, msg: 'Il file non sembra un documento AlmaCAM (manca <LXDDocument>)' });
  }

  let curveIdx = 0;
  let pm;
  while ((pm = POLY_RE.exec(text)) !== null) {
    curveIdx++;
    const body = pm[1];
    /** @type {{x:number,y:number,z:number}[]} */
    const pts = [];
    let m;
    PT_RE.lastIndex = 0;
    while ((m = PT_RE.exec(body)) !== null) {
      pts.push({ x: parseFloat(m[1]), y: parseFloat(m[2]), z: parseFloat(m[3]) });
    }
    const isCutOff = text.lastIndexOf('IsCutOff="true"', pm.index) > text.lastIndexOf('</GeoCurve>', pm.index);
    listing.push(`Curva ${curveIdx} — ${pts.length} punti${isCutOff ? ' (troncatura)' : ''}`);
    for (let i = 1; i < pts.length; i++) {
      const from = pts[i - 1], to = pts[i];
      const len = dist3(from, to);
      if (len < 1e-9) continue;
      segments.push({
        type: 'feed', from, to, pts: [from, to],
        line: curveIdx,        // sincronizzato con la riga dell'indice curve
        tool: 0, feed: null, len,
      });
    }
  }

  if (curveIdx === 0) {
    warnings.push({ line: 1, msg: 'Nessuna Polyline3D trovata nel documento' });
  }

  // statistiche e bounds
  const all = newBounds();
  const feedB = newBounds();
  let feedLen = 0;
  for (const s of segments) {
    all.add(s.from); all.add(s.to);
    feedB.add(s.from); feedB.add(s.to);
    feedLen += s.len;
  }

  if (meta.tubeLength) listing.unshift(`Tubo ${meta.tubeName || ''} L=${meta.tubeLength} mm`.trim());

  return {
    name: fileName,
    program: meta.tubeName || null,
    units: 'mm',
    segments,
    drillPoints: [],
    warnings,
    rawLines: listing.length ? listing : ['(documento vuoto)'],
    meta,
    bounds: all.result(),
    boundsFeed: feedB.result(),
    stats: { feedLen, rapidLen: 0, timeMin: null, tools: [] },
  };
}
