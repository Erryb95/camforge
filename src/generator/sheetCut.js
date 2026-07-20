// @ts-check
// CAM TAGLIO LAMIERA PIATTA (2D): da un disegno (DXF/STEP planare) → G-code
// plasma/laser con KERF compensation + LEAD-IN/OUT + TAB/ponticelli. È il "cuore"
// tipo SheetCam che mancava: riusa il motore kerf già generico (rotaryCut) — che
// opera su (u,v) = (x,y) sul piano — e il post lamiera (post/sheetplasmac).
// Il G-code è X/Y standard ⇒ si simula col loader NC esistente (nessun modello ad hoc).

import { contoursFromModel } from './tubeWrap.js';
import { applyKerfAndLeads, cutParamsFor, materialEntries } from './rotaryCut.js';
import { materialNumber } from './plasmacMaterial.js';
import { postSheetCut } from './post/sheetplasmac.js';

/**
 * @param {import('../core/model.js').SceneModel} model  disegno 2D (DXF o STEP/IGES planare)
 * @param {{thickness?:number, materialKey?:string, kerf?:number, feed?:number,
 *   dialect?:'qtplasmac'|'grbl'|'linuxcnc', lead?:'arc'|'line'|'none', leadLen?:number,
 *   overcut?:number, topology?:'auto'|'tube'|'sheet', material?:number|null, power?:number,
 *   pierceMs?:number, tabCount?:number, tabLen?:number, name?:string}} [opts]
 * @returns {Promise<{gcode:string, lines:string[], name:string, info:string, cam:any}>}
 */
export async function sheetCutFromModel(model, opts = {}) {
  const contours = contoursFromModel(model);
  if (!contours.length) throw new Error('nessun contorno CHIUSO nel disegno (servono profili chiusi da tagliare)');

  const thickness = opts.thickness ?? 2;
  const materialKey = opts.materialKey || 'mild_steel';
  const preset = cutParamsFor(thickness, materialEntries(materialKey));
  const kerf = opts.kerf ?? preset.kerf;
  const feed = opts.feed ?? preset.feed;
  const dialect = opts.dialect || 'qtplasmac';
  // material file QtPlasmaC solo per il dialetto QtPlasmaC; grbl/laser non usa M190
  const material = dialect === 'qtplasmac' ? (opts.material ?? materialNumber(materialKey, thickness)) : null;

  const cam = await applyKerfAndLeads(contours, {
    kerf,
    lead: opts.lead ?? 'arc',
    leadLen: opts.leadLen ?? Math.max(2, kerf * 2),
    overcut: opts.overcut ?? 0,
    topology: opts.topology ?? 'sheet',   // lamiera: il più esterno è il perimetro del pezzo
  });

  const post = postSheetCut(cam, {
    dialect, feed, thickness, power: opts.power,
    pierceMs: opts.pierceMs ?? preset.pierce * 1000,
    material,
    tabCount: opts.tabCount ?? 0,
    tabLen: opts.tabLen ?? 3,
    name: opts.name,
  });

  // estensione disegno (per l'info)
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const c of contours) for (const p of c.pts) {
    if (p.u < uMin) uMin = p.u; if (p.u > uMax) uMax = p.u;
    if (p.v < vMin) vMin = p.v; if (p.v > vMax) vMax = p.v;
  }
  const name = opts.name || (model.name || 'lamiera').replace(/\.[^.]+$/, '') + '.cut.ngc';
  let info = `${cam.contours.length} tagli (${cam.holes} fori · ${cam.sheet ? 'ritaglio sagoma' : 'fori'}) · `
    + `${(uMax - uMin).toFixed(0)}×${(vMax - vMin).toFixed(0)} mm · ${materialKey} ${thickness} mm · kerf ${kerf} mm · feed ${feed} mm/min`;
  if (opts.tabCount) info += ` · ${opts.tabCount} tab/pezzo (${opts.tabLen ?? 3} mm)`;
  if (cam.skipped) info += ` · ⚠ ${cam.skipped} contorni < kerf saltati`;

  return { gcode: post.text, lines: post.lines, name, info, cam };
}
