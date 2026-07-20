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
import { nestGrid } from './nest.js';
import { pocketRings } from './pocket.js';
import { textToPolylines } from './text.js';

/**
 * @param {import('../core/model.js').SceneModel} model  disegno 2D (DXF o STEP/IGES planare)
 * @param {{thickness?:number, materialKey?:string, kerf?:number, feed?:number,
 *   dialect?:'qtplasmac'|'grbl'|'linuxcnc', lead?:'arc'|'line'|'none', leadLen?:number,
 *   overcut?:number, topology?:'auto'|'tube'|'sheet', material?:number|null, power?:number,
 *   pierceMs?:number, tabCount?:number, tabLen?:number, name?:string}} [opts]
 * @returns {Promise<{gcode:string, lines:string[], name:string, info:string, cam:any}>}
 */
export async function sheetCutFromModel(model, opts = {}) {
  let contours = contoursFromModel(model);
  if (!contours.length) throw new Error('nessun contorno CHIUSO nel disegno (servono profili chiusi da tagliare)');

  // NESTING: se si richiedono più copie, replica il pezzo sul foglio (griglia bbox).
  // Più perimetri ⇒ forza topology 'sheet' (ogni top-level è un perimetro di pezzo).
  let topology = opts.topology ?? 'sheet';
  let nestInfo = '';
  const count = Math.max(1, Math.round(opts.count ?? 1));
  if (count > 1) {
    const nest = nestGrid(contours, {
      count, sheetW: opts.sheetW, sheetH: opts.sheetH, gap: opts.nestGap, allowRotate: opts.allowRotate,
    });
    contours = nest.contours;
    topology = 'sheet';
    nestInfo = ` · nesting ${nest.placed}/${count} pezzi (${nest.cols}×${nest.rows}${nest.rot ? ', 90°' : ''}, foglio ${nest.sheetW}×${nest.sheetH} mm, uso ${(nest.util * 100).toFixed(0)}%)`;
    if (nest.placed < count) nestInfo += ` · ⚠ solo ${nest.placed} entrano nel foglio`;
  }

  const thickness = opts.thickness ?? 2;
  const materialKey = opts.materialKey || 'mild_steel';
  const preset = cutParamsFor(thickness, materialEntries(materialKey));
  const kerf = opts.kerf ?? preset.kerf;
  const feed = opts.feed ?? preset.feed;
  const dialect = opts.dialect || 'qtplasmac';
  // material file QtPlasmaC solo per il dialetto QtPlasmaC; grbl/laser non usa M190
  const material = dialect === 'qtplasmac' ? (opts.material ?? materialNumber(materialKey, thickness)) : null;

  const operation = opts.operation ?? 'cut';   // cut | engrave | pocket
  /** @type {{contours:any[], holes:number, sheet:boolean, skipped:number}} */
  let cam;
  if (operation === 'pocket') {
    // POCKET: passate concentriche che svuotano l'area (riuso offsetClosed). v1: usa
    // il contorno più ESTERNO (area max) come confine; le isole/fori sono fase futura.
    const tool = kerf > 0 ? kerf : 1;
    const area = (c) => { let a = 0; const p = c.pts; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j].u * p[i].v - p[i].u * p[j].v; return Math.abs(a); };
    const boundary = contours.reduce((m, c) => (area(c) > area(m) ? c : m), contours[0]);
    const rings = await pocketRings([boundary], { tool, stepover: opts.stepover, finish: tool / 2 });
    if (!rings.length) throw new Error('area troppo piccola per lo svuotamento (pocket) con questo utensile');
    const camC = rings.map((r, i) => ({ pts: r.concat([{ ...r[0] }]), lead: [], tag: `pocket ${i + 1}`, hole: false, depth: 0 }));
    cam = { contours: camC, holes: 0, sheet: false, skipped: 0 };
  } else {
    const engrave = operation === 'engrave';   // marcatura ON-LINE: niente kerf, niente lead
    cam = await applyKerfAndLeads(contours, {
      kerf: engrave ? 0 : kerf,
      lead: engrave ? 'none' : (opts.lead ?? 'arc'),
      leadLen: opts.leadLen ?? Math.max(2, kerf * 2),
      overcut: engrave ? 0 : (opts.overcut ?? 0),
      topology,                             // 'sheet' (o forzato 'sheet' se nesting)
    });
  }

  // REGOLA PLASMA: rallenta i FORI PICCOLI. Ad alta velocità l'arco "lagga" e il
  // foro esce ovale/sottodimensionato → sotto una certa Ø si taglia più piano.
  const smallHoleDia = opts.smallHoleDia ?? 0;              // 0 = regola disattivata
  const smallHoleFactor = opts.smallHoleFactor ?? 0.6;      // % della velocità (SheetCam ~60%)
  let slowed = 0;
  if (smallHoleDia > 0) {
    for (const c of cam.contours) {
      if (!c.hole) continue;
      let miX = Infinity, miY = Infinity, maX = -Infinity, maY = -Infinity;
      for (const p of c.pts) { if (p.u < miX) miX = p.u; if (p.u > maX) maX = p.u; if (p.v < miY) miY = p.v; if (p.v > maY) maY = p.v; }
      if (Math.max(maX - miX, maY - miY) <= smallHoleDia) { c.feed = Math.round(feed * smallHoleFactor); slowed++; }
    }
  }

  const post = postSheetCut(cam, {
    dialect, feed, thickness, power: opts.power,
    pierceMs: opts.pierceMs ?? preset.pierce * 1000,
    material,
    tabCount: operation === 'cut' ? (opts.tabCount ?? 0) : 0,   // tab solo nel taglio passante
    tabLen: opts.tabLen ?? 3,
    engrave: operation === 'engrave',
    customPost: opts.customPost,
    name: opts.name,
  });

  // estensione disegno (per l'info)
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const c of contours) for (const p of c.pts) {
    if (p.u < uMin) uMin = p.u; if (p.u > uMax) uMax = p.u;
    if (p.v < vMin) vMin = p.v; if (p.v > vMax) vMax = p.v;
  }
  const opName = operation === 'pocket' ? 'pocket' : operation === 'engrave' ? 'marcatura' : 'taglio';
  const name = opts.name || (model.name || 'lamiera').replace(/\.[^.]+$/, '') + (operation === 'engrave' ? '.mark.ngc' : operation === 'pocket' ? '.pocket.ngc' : '.cut.ngc');
  let info = `${opName}: ${cam.contours.length} ${operation === 'pocket' ? 'passate' : 'contorni'}${operation === 'cut' ? ` (${cam.holes} fori · ${cam.sheet ? 'ritaglio sagoma' : 'fori'})` : ''} · `
    + `${(uMax - uMin).toFixed(0)}×${(vMax - vMin).toFixed(0)} mm · ${materialKey} ${thickness} mm${operation === 'cut' ? ` · kerf ${kerf} mm` : ''} · feed ${feed} mm/min`;
  if (opts.tabCount) info += ` · ${opts.tabCount} tab/pezzo (${opts.tabLen ?? 3} mm)`;
  if (slowed) info += ` · ${slowed} fori piccoli @ ${Math.round(smallHoleFactor * 100)}%`;
  info += nestInfo;
  if (cam.skipped) info += ` · ⚠ ${cam.skipped} contorni < kerf saltati`;

  return { gcode: post.text, lines: post.lines, name, info, cam };
}

/**
 * Incisione TESTO single-line (Hershey futural) → G-code marcatura/scribe. Non serve
 * un modello: il testo è generato dai font vettoriali vendorizzati.
 * @param {string} text
 * @param {{size?:number, x?:number, y?:number, dialect?:'qtplasmac'|'grbl'|'linuxcnc'|'mach3'|'mach4'|'uccnc',
 *   feed?:number, power?:number, materialKey?:string, thickness?:number, material?:number|null, name?:string}} [opts]
 * @returns {{gcode:string, lines:string[], name:string, info:string, cam:any}}
 */
export function sheetTextGcode(text, opts = {}) {
  const t = textToPolylines(text || '', { size: opts.size ?? 20, x: opts.x ?? 0, y: opts.y ?? 0 });
  if (!t.polylines.length) throw new Error('testo vuoto o caratteri non supportati');
  const cam = {
    contours: t.polylines.map((pl, i) => ({ pts: pl, lead: [], tag: `text ${i + 1}`, hole: false, depth: 0 })),
    holes: 0, sheet: false, skipped: 0,
  };
  const dialect = opts.dialect || 'qtplasmac';
  const material = dialect === 'qtplasmac' ? (opts.material ?? materialNumber(opts.materialKey || 'mild_steel', opts.thickness ?? 2)) : null;
  const name = opts.name || `testo.mark.ngc`;
  const post = postSheetCut(cam, { dialect, feed: opts.feed ?? 3000, power: opts.power, material, engrave: true, customPost: opts.customPost, name });
  const info = `marcatura testo "${text}" · ${t.width.toFixed(0)}×${t.height.toFixed(0)} mm · ${t.polylines.length} tratti · ${dialect}`;
  return { gcode: post.text, lines: post.lines, name, info, cam };
}
