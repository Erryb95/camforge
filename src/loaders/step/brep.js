// @ts-check
// Estrazione della geometria B-rep ESATTA da un STEP tramite opencascade.js.
// Restituisce: bounding box, cilindri (fori/raccordi con asse+raggio esatti),
// facce piane, e spigoli tessellati (polilinee) per il rendering.
// È la base per il generatore NC: fori con centro/raggio precisi, niente mesh.

import { getOcctFull, readStepShape, explore } from './occt.js';

const CURVE_STEPS = 40;   // campioni per spigolo curvo

/**
 * @param {string} stepText
 * @returns {Promise<{
 *   bbox:{min:{x,y,z},max:{x,y,z}},
 *   cylinders:{r:number, c:{x,y,z}, dir:{x,y,z}}[],
 *   planes:{p:{x,y,z}, n:{x,y,z}}[],
 *   edges:{x:number,y:number,z:number}[][]
 * }>}
 */
export async function extractBrep(stepText) {
  const oc = await getOcctFull();
  const shape = readStepShape(oc, stepText);

  // --- bounding box dai vertici ---
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const v of explore(oc, shape, oc.TopAbs_ShapeEnum.TopAbs_VERTEX)) {
    const p = oc.BRep_Tool.Pnt(oc.TopoDS.Vertex_1(v));
    const x = p.X(), y = p.Y(), z = p.Z();
    if (x < min.x) min.x = x; if (x > max.x) max.x = x;
    if (y < min.y) min.y = y; if (y > max.y) max.y = y;
    if (z < min.z) min.z = z; if (z > max.z) max.z = z;
  }

  // --- facce: cilindri (fori/raccordi) e piani ---
  /** @type {{r:number, c:{x,y,z}, dir:{x,y,z}}[]} */
  const cylinders = [];
  /** @type {{p:{x,y,z}, n:{x,y,z}}[]} */
  const planes = [];
  for (const f of explore(oc, shape, oc.TopAbs_ShapeEnum.TopAbs_FACE)) {
    const face = oc.TopoDS.Face_1(f);
    const surf = new oc.BRepAdaptor_Surface_2(face, true);
    const t = surf.GetType();
    if (t === oc.GeomAbs_SurfaceType.GeomAbs_Cylinder) {
      const cyl = surf.Cylinder();
      const ax = cyl.Axis();               // gp_Ax1
      const loc = ax.Location(), d = ax.Direction();
      cylinders.push({
        r: cyl.Radius(),
        c: { x: loc.X(), y: loc.Y(), z: loc.Z() },
        dir: { x: d.X(), y: d.Y(), z: d.Z() },
      });
    } else if (t === oc.GeomAbs_SurfaceType.GeomAbs_Plane) {
      const pl = surf.Plane();
      const ax = pl.Axis();
      const loc = ax.Location(), n = ax.Direction();
      planes.push({ p: { x: loc.X(), y: loc.Y(), z: loc.Z() }, n: { x: n.X(), y: n.Y(), z: n.Z() } });
    }
  }

  // --- spigoli tessellati (per il rendering) ---
  /** @type {{x,y,z}[][]} */
  const edges = [];
  for (const e of explore(oc, shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE)) {
    const edge = oc.TopoDS.Edge_1(e);
    let curve;
    try { curve = new oc.BRepAdaptor_Curve_2(edge); } catch { continue; }
    const u0 = curve.FirstParameter(), u1 = curve.LastParameter();
    if (!isFinite(u0) || !isFinite(u1)) continue;
    const isLine = curve.GetType() === oc.GeomAbs_CurveType.GeomAbs_Line;
    const n = isLine ? 1 : CURVE_STEPS;
    /** @type {{x,y,z}[]} */
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const u = u0 + ((u1 - u0) * i) / n;
      const p = curve.Value(u);
      pts.push({ x: p.X(), y: p.Y(), z: p.Z() });
    }
    if (pts.length >= 2) edges.push(pts);
  }

  return { bbox: { min, max }, cylinders, planes, edges };
}
