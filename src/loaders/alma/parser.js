// @ts-check
// Loader AlmaCAM (LXDDocument XML: file .cn / .ctd delle macchine taglio tubo Alma).
// La geometria è già esplicita: polilinee 3D per ogni curva di taglio.
// Il "listato" mostrato nel pannello codice è un indice sintetico delle curve.

import { newBounds, dist3 } from '../../core/model.js';
import { perimeterParam, makeUnwrapper, guidesFor } from '../../core/unroll.js';

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

  // 1° passaggio: raccogli le curve
  /** @type {{pts:{x:number,y:number,z:number}[], isCutOff:boolean}[]} */
  const curves = [];
  let pm;
  while ((pm = POLY_RE.exec(text)) !== null) {
    const body = pm[1];
    /** @type {{x:number,y:number,z:number}[]} */
    const pts = [];
    let m;
    PT_RE.lastIndex = 0;
    while ((m = PT_RE.exec(body)) !== null) {
      pts.push({ x: parseFloat(m[1]), y: parseFloat(m[2]), z: parseFloat(m[3]) });
    }
    const isCutOff = text.lastIndexOf('IsCutOff="true"', pm.index) > text.lastIndexOf('</GeoCurve>', pm.index);
    curves.push({ pts, isCutOff });
  }

  // profilo sezione: tonda se i raggi dei punti sono ~costanti, altrimenti
  // rettangolare dal bounding box della sezione
  let profile = null;
  {
    let rMin = Infinity, rMax = -Infinity, rSum = 0, n = 0;
    for (const c of curves) {
      for (const p of c.pts) {
        const r = Math.hypot(p.x, p.y);
        if (r < rMin) rMin = r;
        if (r > rMax) rMax = r;
        rSum += r; n++;
        if (n >= 2000) break;
      }
      if (n >= 2000) break;
    }
    if (n > 2) {
      const rMean = rSum / n;
      if (rMean > 1e-6 && (rMax - rMin) / rMean < 0.05) {
        profile = { type: 'round', r: rMean, per: 2 * Math.PI * rMean };
        meta.tubeDiameter = 2 * rMean;
      } else if (mExtMin && mExtMax) {
        const w = parseFloat(mExtMax[1]) - parseFloat(mExtMin[1]);
        const h = parseFloat(mExtMax[2]) - parseFloat(mExtMin[2]);
        if (w > 0 && h > 0) {
          profile = { type: 'rect', w, h, per: 2 * (w + h) };
          meta.tubeWidth = w;
          meta.tubeHeight = h;
        }
      }
    }
  }
  const unwrap = profile ? makeUnwrapper(profile.per) : null;

  // 2° passaggio: indice curve + segmenti (con sviluppo u=Z, v=perimetro)
  let curveIdx = 0;
  for (const { pts, isCutOff } of curves) {
    curveIdx++;
    listing.push(`Curva ${curveIdx} — ${pts.length} punti${isCutOff ? ' (troncatura)' : ''}`);
    if (unwrap) unwrap.reset();   // ogni curva riparte nella fascia base
    const uvPts = unwrap
      ? pts.map((p) => ({ u: p.z, v: unwrap.next(perimeterParam(p.x, p.y, /** @type {any} */(profile))) }))
      : null;
    for (let i = 1; i < pts.length; i++) {
      const from = pts[i - 1], to = pts[i];
      const len = dist3(from, to);
      if (len < 1e-9) continue;
      /** @type {any} */
      const seg = {
        type: 'feed', from, to, pts: [from, to],
        line: curveIdx,        // sincronizzato con la riga dell'indice curve
        tool: 0, feed: null, len,
      };
      if (uvPts) seg.uv = [uvPts[i - 1], uvPts[i]];
      segments.push(seg);
    }
  }

  if (profile) {
    meta.unrollAvailable = true;
    meta.perimeter = profile.per;
    meta.unrollGuides = guidesFor(/** @type {any} */(profile));
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
