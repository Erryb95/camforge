// CAM TAGLIO LAMIERA PIATTA (2D): DXF → G-code plasma/laser con kerf + lead + tabs.
// È il cuore "tipo SheetCam" aggiunto. Verifica: kerf comp reale sul piatto, tab sui
// perimetri, materiale QtPlasmaC, dialetti, e che il G-code sia X/Y valido (parsabile).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sheetCutFromModel } from '../src/generator/sheetCut.js';
import { planTabRuns } from '../src/generator/post/sheetplasmac.js';
import { pocketRings } from '../src/generator/pocket.js';
import { parseDXF } from '../src/loaders/dxf/parser.js';
import { parseNC } from '../src/loaders/nc/parser.js';
import { materialNumber } from '../src/generator/plasmacMaterial.js';

const DXF = fileURLToPath(new URL('../samples/dxf/piastra-4fori.dxf', import.meta.url));
const dxf = () => parseDXF(readFileSync(DXF, 'utf8'), 'piastra-4fori.dxf');
const bbox = (model) => {
  const b = model.bounds;
  return { w: b.max.x - b.min.x, h: b.max.y - b.min.y };
};

test('sheetCutFromModel: QtPlasmaC piatto — struttura nativa + X/Y + parsabile', async () => {
  const { gcode, name, info } = await sheetCutFromModel(dxf(), { thickness: 4, materialKey: 'mild_steel', dialect: 'qtplasmac', tabCount: 4 });
  assert.ok(name.endsWith('.ngc') && name.includes('cut'));
  assert.ok(/^G21 G40 /m.test(gcode), 'preambolo');
  assert.ok(/^M190 P\d+$/m.test(gcode) && /^M66 P3 L3 Q1$/m.test(gcode), 'materiale QtPlasmaC');
  assert.equal(+gcode.match(/M190 P(\d+)/)[1], materialNumber('mild_steel', 4));
  assert.ok(/^M03 \$0 S1$/m.test(gcode) && /^M05 \$0$/m.test(gcode), 'torcia on/off QtPlasmaC');
  assert.ok(!/keep-z-motion/.test(gcode), 'piatto: niente keep-z-motion (il probe è normale)');
  assert.ok(!/\bA-?\d/.test(gcode), 'nessun asse A: è piatto X/Y');
  assert.ok(/^G1 X-?[\d.]+ Y-?[\d.]+ F/m.test(gcode), 'moti di taglio X/Y con feed');
  assert.ok(gcode.trimEnd().endsWith('M2'));
  assert.ok(info.includes('kerf'));
  // il G-code piatto è NC standard → deve parsare e produrre un toolpath simulabile
  const model = parseNC(gcode, name);
  assert.ok(model.segments.length > 100, 'toolpath parsato per la simulazione');
});

test('sheetCut: kerf compensation REALE sul piatto (perimetro cresce di ~kerf)', async () => {
  // lead:'none' per isolare il solo effetto del kerf (il lead-in sporge fuori e falserebbe il bbox)
  const k0 = await sheetCutFromModel(dxf(), { thickness: 4, kerf: 0, dialect: 'grbl', lead: 'none' });
  const k2 = await sheetCutFromModel(dxf(), { thickness: 4, kerf: 2, dialect: 'grbl', lead: 'none' });
  const b0 = bbox(parseNC(k0.gcode, 'a.ngc'));
  const b2 = bbox(parseNC(k2.gcode, 'b.ngc'));
  // perimetro (sheet) offset +kerf/2 per lato → larghezza/altezza +~kerf
  assert.ok(b2.w - b0.w > 1.4 && b2.w - b0.w < 2.6, `Δw ≈ kerf: ${(b2.w - b0.w).toFixed(2)}`);
  assert.ok(b2.h - b0.h > 1.4 && b2.h - b0.h < 2.6, `Δh ≈ kerf: ${(b2.h - b0.h).toFixed(2)}`);
});

test('sheetCut: i TAB aumentano le accensioni sul perimetro (pezzo tenuto nel grezzo)', async () => {
  const noTab = await sheetCutFromModel(dxf(), { thickness: 4, dialect: 'qtplasmac', tabCount: 0 });
  const tab4 = await sheetCutFromModel(dxf(), { thickness: 4, dialect: 'qtplasmac', tabCount: 4 });
  const on = (g) => (g.match(/^M03 \$0 S1$/gm) || []).length;
  // 4 tab sul perimetro → il perimetro si spezza in 5 run → +4 accensioni rispetto a 0 tab
  assert.equal(on(tab4.gcode) - on(noTab.gcode), 4, 'un tab in più = un riattacco in più');
});

test('sheetCut: dialetto GRBL/laser — niente M190, M3 S + G4 pierce', async () => {
  const { gcode } = await sheetCutFromModel(dxf(), { thickness: 3, dialect: 'grbl', power: 900 });
  assert.ok(!/M190/.test(gcode), 'laser: niente material file');
  assert.ok(/^M3 S900$/m.test(gcode), 'sorgente con potenza S');
  assert.ok(/^G4 P/m.test(gcode), 'pierce delay G4');
  assert.ok(gcode.trimEnd().endsWith('M2'));
});

test('planTabRuns: N tab → N+1 run; troppo piccolo → 1 run', () => {
  // quadrato 100×100 (perimetro 400): 4 tab → 5 run
  const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 0 }];
  assert.equal(planTabRuns(sq, 4, 3).length, 5);
  assert.equal(planTabRuns(sq, 0, 3).length, 1);
  // perimetro troppo corto per 10 tab da 30 mm → nessun tab
  assert.equal(planTabRuns(sq, 10, 30).length, 1);
});

test('sheetCut: dialetti Mach3/Mach4/UCCNC — M3/M5 + M30, niente material file', async () => {
  for (const d of ['mach3', 'mach4', 'uccnc']) {
    const { gcode } = await sheetCutFromModel(dxf(), { thickness: 3, dialect: d, tabCount: 0 });
    assert.ok(/^M3$/m.test(gcode), `${d}: torcia M3`);
    assert.ok(/^M5$/m.test(gcode), `${d}: torcia M5`);
    assert.ok(/^M30$/m.test(gcode), `${d}: fine M30`);
    assert.ok(!/M190/.test(gcode), `${d}: niente material file`);
  }
});

test('sheetCut: regola fori piccoli — feed ridotto sotto soglia Ø', async () => {
  const feed = 4220;
  const { gcode, info } = await sheetCutFromModel(dxf(), {
    thickness: 4, dialect: 'mach3', kerf: 1.4, feed, smallHoleDia: 300, smallHoleFactor: 0.5, tabCount: 0,
  });
  assert.ok(info.includes('fori piccoli'), info);
  assert.ok(new RegExp(`\\bF${Math.round(feed * 0.5)}\\b`).test(gcode), 'feed ridotto sui fori');
  assert.ok(new RegExp(`\\bF${feed}\\b`).test(gcode), 'feed pieno sul perimetro');
});

test('sheetCut: operazione ENGRAVE — scribe QtPlasmaC (M03 $1), on-line, niente pierce', async () => {
  const { gcode, info } = await sheetCutFromModel(dxf(), { thickness: 3, dialect: 'qtplasmac', operation: 'engrave' });
  assert.ok(/^M03 \$1 S1$/m.test(gcode), 'usa lo scribe (tool $1)');
  assert.ok(/^M05 \$1$/m.test(gcode));
  assert.ok(!/^M03 \$0 S1$/m.test(gcode), 'niente torcia da taglio $0');
  assert.ok(!/^G4 /m.test(gcode), 'niente pierce nella marcatura');
  assert.ok(info.includes('marcatura'));
});

test('sheetCut: operazione POCKET — passate concentriche (riuso offsetClosed)', async () => {
  const { gcode, cam, info } = await sheetCutFromModel(dxf(), { thickness: 3, dialect: 'grbl', operation: 'pocket', kerf: 4, stepover: 3 });
  assert.ok(cam.contours.length > 5, `molte passate concentriche, ottenute ${cam.contours.length}`);
  assert.ok(/^M3 S\d+$/m.test(gcode) && /^G1 X/m.test(gcode));
  assert.ok(info.includes('pocket'));
});

test('pocketRings: riempie un quadrato con anelli concentrici via via più interni', async () => {
  const sq = [{ pts: [{ u: 0, v: 0 }, { u: 100, v: 0 }, { u: 100, v: 100 }, { u: 0, v: 100 }, { u: 0, v: 0 }] }];
  const rings = await pocketRings(sq, { tool: 5, stepover: 4, finish: 2.5 });
  assert.ok(rings.length > 5, `attesi molti anelli, ottenuti ${rings.length}`);
  const w = (r) => Math.max(...r.map((p) => p.u)) - Math.min(...r.map((p) => p.u));
  assert.ok(w(rings[0]) > w(rings[rings.length - 1]), 'gli anelli rimpiccioliscono verso il centro');
});

test('sheetCut: nessun contorno chiuso → errore chiaro', async () => {
  const empty = { name: 'x.dxf', segments: [], meta: { dialect: 'DXF' } };
  await assert.rejects(() => sheetCutFromModel(empty, {}), /contorno CHIUSO/);
});
