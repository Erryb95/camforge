// @ts-check
// Estrazione dei WIRE (contorni chiusi) delle facce B-rep come polilinee 3D
// CONTINUE e ordinate. È la primitiva per: demo piastra STEP→NC (fori/asole
// come contorni veri), asole tubo nel generatore, e contorni "una passata".
//
// Note API (build emscripten di opencascade.js, OCCT pre-7.5):
//  - orientamento: shape.Orientation_1() (non .Orientation) → TopAbs_REVERSED;
//  - BRepTools_WireExplorer percorre gli edge in ordine di connessione;
//  - BRepTools.OuterWire(face) individua il wire esterno della faccia.

import { explore } from './occt.js';

const ARC_STEP_DEG = 4;   // densità di campionamento degli archi

/**
 * Campiona un edge come polilinea, rispettando l'orientamento nel wire.
 * @param {any} oc @param {any} edgeShape
 * @returns {{x:number,y:number,z:number}[]}
 */
export function sampleEdge(oc, edgeShape) {
  const edge = oc.TopoDS.Edge_1(edgeShape);
  let curve;
  try { curve = new oc.BRepAdaptor_Curve_2(edge); } catch { return []; }
  const u0 = curve.FirstParameter(), u1 = curve.LastParameter();
  if (!isFinite(u0) || !isFinite(u1)) return [];
  let n = 1;
  if (curve.GetType() !== oc.GeomAbs_CurveType.GeomAbs_Line) {
    // archi: ~4°/campione; altre curve: proporzionale all'intervallo
    let sweepDeg = 360;
    try { if (curve.GetType() === oc.GeomAbs_CurveType.GeomAbs_Circle) sweepDeg = Math.abs(u1 - u0) * 180 / Math.PI; } catch { /* stima */ }
    n = Math.max(6, Math.ceil(sweepDeg / ARC_STEP_DEG));
  }
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = u0 + ((u1 - u0) * i) / n;
    const p = curve.Value(u);
    pts.push({ x: p.X(), y: p.Y(), z: p.Z() });
  }
  // l'orientamento dell'edge nel wire decide il verso di percorrenza
  const rev = edgeShape.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;
  if (rev) pts.reverse();
  return pts;
}

/**
 * Tutti i wire di una faccia come polilinee chiuse continue.
 * @param {any} oc @param {any} faceShape  (TopoDS_Shape di tipo FACE)
 * @returns {{pts:{x:number,y:number,z:number}[], outer:boolean}[]}
 */
export function wiresOfFace(oc, faceShape) {
  const face = oc.TopoDS.Face_1(faceShape);
  let outerWire = null;
  try { outerWire = oc.BRepTools.OuterWire(face); } catch { /* fallback: wire più esteso */ }

  const loops = [];
  for (const w of explore(oc, face, oc.TopAbs_ShapeEnum.TopAbs_WIRE)) {
    const wire = oc.TopoDS.Wire_1(w);
    /** @type {{x:number,y:number,z:number}[]} */
    const pts = [];
    // BRepTools_WireExplorer percorre gli edge già in ordine di connessione
    let wexp;
    try { wexp = new oc.BRepTools_WireExplorer_2(wire); } catch { wexp = null; }
    if (wexp) {
      for (; wexp.More(); wexp.Next()) {
        const ep = sampleEdge(oc, wexp.Current());
        appendChained(pts, ep);
      }
    } else {
      for (const e of explore(oc, wire, oc.TopAbs_ShapeEnum.TopAbs_EDGE)) {
        appendChained(pts, sampleEdge(oc, e));
      }
    }
    if (pts.length < 3) continue;
    // chiudi il loop se serve
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > 1e-6) pts.push({ ...a });
    let outer = false;
    if (outerWire) { try { outer = w.IsSame(outerWire); } catch { outer = false; } }
    loops.push({ pts, outer });
  }
  // fallback outer: se nessuno marcato, il loop con bbox più estesa
  if (loops.length && !loops.some((l) => l.outer)) {
    let best = 0, bestExt = -Infinity;
    loops.forEach((l, i) => {
      let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
      for (const p of l.pts) { mnx = Math.min(mnx, p.x); mxx = Math.max(mxx, p.x); mny = Math.min(mny, p.y); mxy = Math.max(mxy, p.y); }
      const ext = (mxx - mnx) + (mxy - mny);
      if (ext > bestExt) { bestExt = ext; best = i; }
    });
    loops[best].outer = true;
  }
  return loops;
}

/** Accoda una polilinea evitando il punto doppio alla giunzione (contorno continuo). */
function appendChained(pts, ep) {
  if (!ep.length) return;
  if (pts.length) {
    const last = pts[pts.length - 1], first = ep[0];
    if (Math.hypot(last.x - first.x, last.y - first.y, last.z - first.z) < 1e-6) ep = ep.slice(1);
  }
  pts.push(...ep);
}

/**
 * Facce piane di una shape con normale e quota, per scegliere la faccia "top".
 * @param {any} oc @param {any} shape
 * @returns {{face:any, n:{x:number,y:number,z:number}, z:number}[]}
 */
export function planarFaces(oc, shape) {
  const out = [];
  for (const f of explore(oc, shape, oc.TopAbs_ShapeEnum.TopAbs_FACE)) {
    const face = oc.TopoDS.Face_1(f);
    const surf = new oc.BRepAdaptor_Surface_2(face, true);
    if (surf.GetType() !== oc.GeomAbs_SurfaceType.GeomAbs_Plane) continue;
    const pl = surf.Plane();
    const ax = pl.Axis();
    const loc = ax.Location(), n = ax.Direction();
    out.push({ face: f, n: { x: n.X(), y: n.Y(), z: n.Z() }, z: loc.Z() });
  }
  return out;
}
