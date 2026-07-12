// @ts-check
// Loader AlmaCAM / formato LXD di Friendess (file .cn / .ctd, XML <LXDDocument>).
// Schema reale: LXDDocument > Segments > TubeSegment > Entities > GeoCurve
//   (attributi IsCutOff/ChannelPort/IsCommon, con LeadIn/LeadOut) > Geometry >
//   CompositeCurve3D > Polyline3D > Point3D. La sezione è esplicita in
//   CrossSection/SectionData (<Circle Radius=".."/> per il tondo).
// Parsing schema-driven (non a tentativi): sezione, curve e tipo taglio.

import { newBounds, dist3 } from '../../core/model.js';
import { perimeterParam, makeUnwrapper, guidesFor } from '../../core/unroll.js';
import { buildTubeMesh } from '../cad/tube3d.js';

const GEOCURVE_RE = /<GeoCurve\b([^>]*)>([\s\S]*?)<\/GeoCurve>/g;
const POLY_RE = /<Polyline3D[^>]*>([\s\S]*?)<\/Polyline3D>/g;
const PT_RE = /<Point3D\s+X="([^"]+)"\s+Y="([^"]+)"\s+Z="([^"]+)"/g;
const attr = (s, name) => { const m = new RegExp(`${name}="([^"]*)"`).exec(s); return m ? m[1] : null; };

// utensili logici (colore + toggle): troncatura vs contorno di taglio
const TOOL_CUTOFF = 1, TOOL_CONTOUR = 2;

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
  /** @type {Record<number,string>} */
  const toolNames = {};
  /** @type {number[]} */
  const toolsSeen = [];

  const mLen = /TubeLength="([\d.]+)"/.exec(text);
  if (mLen) meta.tubeLength = parseFloat(mLen[1]);
  const mName = /TubeName="([^"]*)"/.exec(text);
  if (mName) meta.tubeName = mName[1];
  const mExtMin = /<ExtMin X="([-\d.]+)" Y="([-\d.]+)"/.exec(text);
  const mExtMax = /<ExtMax X="([-\d.]+)" Y="([-\d.]+)"/.exec(text);

  if (!text.includes('<LXDDocument')) {
    warnings.push({ line: 1, msg: 'Il file non sembra un documento LXD (manca <LXDDocument>)' });
  }

  // 1° passaggio: curve per GeoCurve (attributi affidabili, non lastIndexOf)
  /** @type {{pts:{x:number,y:number,z:number}[], isCutOff:boolean, channel:string, common:boolean}[]} */
  const curves = [];
  let gm;
  GEOCURVE_RE.lastIndex = 0;
  while ((gm = GEOCURVE_RE.exec(text)) !== null) {
    const head = gm[1], body = gm[2];
    const isCutOff = attr(head, 'IsCutOff') === 'true';
    const channel = attr(head, 'ChannelPort') || '1';
    const common = attr(head, 'IsCommon') === 'true';
    // tutti i Polyline3D dentro la GeoCurve (contorno principale)
    /** @type {{x:number,y:number,z:number}[]} */
    const pts = [];
    let pmm;
    POLY_RE.lastIndex = 0;
    while ((pmm = POLY_RE.exec(body)) !== null) {
      let m;
      PT_RE.lastIndex = 0;
      while ((m = PT_RE.exec(pmm[1])) !== null) {
        pts.push({ x: parseFloat(m[1]), y: parseFloat(m[2]), z: parseFloat(m[3]) });
      }
    }
    if (pts.length >= 2) curves.push({ pts, isCutOff, channel, common });
  }
  // fallback: se lo schema GeoCurve non emerge, prendi le Polyline3D nude
  if (!curves.length) {
    let pm;
    POLY_RE.lastIndex = 0;
    while ((pm = POLY_RE.exec(text)) !== null) {
      const pts = [];
      let m; PT_RE.lastIndex = 0;
      while ((m = PT_RE.exec(pm[1])) !== null) pts.push({ x: parseFloat(m[1]), y: parseFloat(m[2]), z: parseFloat(m[3]) });
      if (pts.length >= 2) curves.push({ pts, isCutOff: false, channel: '1', common: false });
    }
  }

  // profilo sezione: PRIMA dallo schema esplicito <SectionData><Circle Radius>,
  // altrimenti dai punti (tondo se raggio ~costante) o dal bounding box (rett).
  let profile = null;
  const mCirc = /<SectionData>\s*<Circle\s+Radius="([\d.]+)"/.exec(text)
    || /<CrossSection>[\s\S]*?<Circle\s+Radius="([\d.]+)"/.exec(text);
  if (mCirc) {
    const r = parseFloat(mCirc[1]);
    profile = { type: 'round', r, per: 2 * Math.PI * r };
    meta.tubeDiameter = 2 * r;
    meta.sectionSource = 'SectionData';
  } else {
    let rMin = Infinity, rMax = -Infinity, rSum = 0, n = 0;
    for (const c of curves) for (const p of c.pts) {
      const r = Math.hypot(p.x, p.y);
      if (r < rMin) rMin = r; if (r > rMax) rMax = r; rSum += r; n++;
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
          meta.tubeWidth = w; meta.tubeHeight = h;
        }
      }
    }
  }
  if (mExtMin && mExtMax && meta.tubeDiameter === undefined && !meta.tubeWidth) {
    meta.tubeDiameter = Math.max(
      parseFloat(mExtMax[1]) - parseFloat(mExtMin[1]),
      parseFloat(mExtMax[2]) - parseFloat(mExtMin[2]));
  }
  const unwrap = profile ? makeUnwrapper(profile.per) : null;

  // 2° passaggio: indice curve + segmenti (con sviluppo u=Z, v=perimetro)
  let curveIdx = 0;
  for (const { pts, isCutOff, channel, common } of curves) {
    curveIdx++;
    const tool = isCutOff ? TOOL_CUTOFF : TOOL_CONTOUR;
    if (!toolsSeen.includes(tool)) {
      toolsSeen.push(tool);
      toolNames[tool] = isCutOff ? 'Troncatura' : 'Contorno';
    }
    const tags = [isCutOff ? 'troncatura' : null, common ? 'comune' : null, `ch${channel}`].filter(Boolean);
    listing.push(`Curva ${curveIdx} — ${pts.length} punti (${tags.join(', ')})`);
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
        tool, feed: null, len,
      };
      if (uvPts) seg.uv = [uvPts[i - 1], uvPts[i]];
      // 3D sul tubo: asse = Z (lunghezza), sezione = (X,Y) → (Ytubo, Ztubo)
      if (profile) {
        seg.tubePts = [
          { x: from.z, y: from.x, z: from.y },
          { x: to.z, y: to.x, z: to.y },
        ];
      }
      segments.push(seg);
    }
  }

  // tubo solido 3D (asse X = lunghezza del tubo, sezione nel piano Y-Z)
  let tubeMesh = null;
  if (profile && segments.length) {
    let zMin = Infinity, zMax = -Infinity;
    for (const s of segments) {
      if (s.from.z < zMin) zMin = s.from.z; if (s.from.z > zMax) zMax = s.from.z;
      if (s.to.z < zMin) zMin = s.to.z; if (s.to.z > zMax) zMax = s.to.z;
    }
    const margin = Math.max(2, (zMax - zMin) * 0.02);
    tubeMesh = buildTubeMesh(/** @type {any} */(profile), zMin - margin, zMax + margin, 0);
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
    toolNames,
    mesh: tubeMesh,
    bounds: all.result(),
    boundsFeed: feedB.result(),
    stats: { feedLen, rapidLen: 0, timeMin: null, tools: toolsSeen },
  };
}
