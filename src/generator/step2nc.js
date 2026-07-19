// @ts-check
// Pipeline STEP → NC condivisa da CLI (tools/step2nc.mjs) e UI (bottone "→ NC").
// Rileva da sé il tipo di pezzo:
//   TUBO (lungo X, sezione piccola)  → generatore dialetto Cutlite (.cn)
//   PIASTRA (faccia piana top)       → toolpath 2D + post grbl/linuxcnc (.nc)

import { getOcctFull, readStepShape } from '../loaders/step/occt.js';
import { planarFaces, wiresOfFace } from '../loaders/step/wires.js';
import { makeToolpath } from './toolpath.js';
import { postGcode } from './post/gcode.js';

/**
 * @param {string} stepText contenuto del file .step/.stp
 * @param {{post?:'grbl'|'linuxcnc'|'cutlite', feed?:number, power?:number,
 *          thickness?:number, lead?:number, name?:string}} [opts]
 * @returns {Promise<{nc:string, kind:'tube'|'plate', post:string, ext:string, info:string}>}
 */
export async function stepToNc(stepText, opts = {}) {
  const oc = await getOcctFull();
  const shape = readStepShape(oc, stepText);

  // ingombro dai vertici (per la classificazione tubo/piastra)
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  const exp = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; exp.More(); exp.Next()) {
    const p = oc.BRep_Tool.Pnt(oc.TopoDS.Vertex_1(exp.Current()));
    const x = p.X(), y = p.Y(), z = p.Z();
    if (x < min.x) min.x = x; if (x > max.x) max.x = x;
    if (y < min.y) min.y = y; if (y > max.y) max.y = y;
    if (z < min.z) min.z = z; if (z > max.z) max.z = z;
  }
  const xLen = max.x - min.x, yLen = max.y - min.y, zLen = max.z - min.z;
  const isTube = xLen > 2.2 * Math.max(yLen, zLen);   // convenzione COPPIE: asse tubo = X

  const post = opts.post || (isTube ? 'cutlite' : 'grbl');

  if (post === 'cutlite') {
    const { extractBrep } = await import('../loaders/step/brep.js');
    const { featuresFromBrep } = await import('./features.js');
    const { generateTubeNc } = await import('./tubeNc.js');
    const feat = featuresFromBrep(await extractBrep(stepText));
    return {
      nc: generateTubeNc(feat),
      kind: 'tube',
      post: 'cutlite',
      ext: 'cn',
      info: `tubo ${feat.sectionW}×${feat.sectionH} r${feat.cornerR} L${feat.length} — fori ${feat.holes.length}, asole ${feat.slots.length}`,
    };
  }

  // piastra: contorni dalla faccia piana più alta (normale ‖ Z)
  const top = planarFaces(oc, shape)
    .filter((f) => Math.abs(f.n.z) > 0.99)
    .sort((a, b) => b.z - a.z)[0];
  if (!top) {
    throw new Error('nessuna faccia piana orizzontale: non è una piastra (né un tubo lungo X)');
  }
  const loops = wiresOfFace(oc, top.face);
  const contours = loops.map((l, i) => ({
    pts: l.pts.map((p) => ({ x: p.x, y: p.y })),
    closed: true,
    tag: l.outer ? 'perimetro' : `foro ${i}`,
  }));
  const thickness = opts.thickness ?? Math.max(0.5, +zLen.toFixed(2));
  const nc = postGcode(makeToolpath(contours, { leadIn: opts.lead ?? 2 }), {
    dialect: /** @type {'grbl'|'linuxcnc'} */ (post),
    feed: opts.feed ?? 3000,
    power: opts.power ?? 800,
    thickness,
    name: opts.name || 'pezzo',
  });
  return {
    nc,
    kind: 'plate',
    post,
    ext: 'nc',
    info: `piastra ${xLen.toFixed(0)}×${yLen.toFixed(0)}×${thickness} — ${loops.length} contorni (${loops.filter((l) => !l.outer).length} interni)`,
  };
}
