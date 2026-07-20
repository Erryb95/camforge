// Loader SVG (2D vettoriale) → SceneModel come il DXF: apre path/rect/circle/
// ellipse/line/poly, tessella bezier/archi, ribalta Y (SVG y-down → CAD y-up).
// Verifica che i contorni siano chiusi e alimentino il taglio lamiera / rotary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseSVG, pathToPolylines } from '../src/loaders/svg/parser.js';
import { contoursFromModel } from '../src/generator/tubeWrap.js';
import { sheetCutFromModel } from '../src/generator/sheetCut.js';

const SVG = fileURLToPath(new URL('../samples/svg/plate.svg', import.meta.url));
const svg = () => parseSVG(readFileSync(SVG, 'utf8'), 'plate.svg');

test('parseSVG: apre le forme e chiude i contorni (rect+2 cerchi+ellisse+path+poly)', () => {
  const m = svg();
  assert.equal(m.meta.dialect, 'SVG');
  assert.ok(m.segments.length > 20);
  const cs = contoursFromModel(m);
  assert.equal(cs.length, 6, `attesi 6 contorni chiusi, ottenuti ${cs.length}`);
});

test('parseSVG: unità mm + viewBox → scala corretta (200mm / vb200 = 1)', () => {
  const m = svg();
  assert.equal(m.meta.unitScale, 1);
  const w = m.bounds.max.x - m.bounds.min.x;
  assert.ok(Math.abs(w - 180) < 1, `larghezza ≈ 180 mm (rect), ottenuto ${w.toFixed(1)}`);
});

test('parseSVG: scala da px/viewBox fisico (100mm / vb50 = 2×)', () => {
  const s = '<svg width="100mm" height="100mm" viewBox="0 0 50 50"><rect x="0" y="0" width="50" height="50"/></svg>';
  const m = parseSVG(s, 'a.svg');
  assert.equal(m.meta.unitScale, 2);
  assert.ok(Math.abs((m.bounds.max.x - m.bounds.min.x) - 100) < 1e-6, 'rect 50 user-unit → 100 mm');
});

test('pathToPolylines: M/L/Z chiude, C tessella, A produce un arco', () => {
  const sq = pathToPolylines('M0 0 L10 0 L10 10 L0 10 Z');
  assert.equal(sq.length, 1);
  assert.ok(sq[0].closed);
  assert.equal(sq[0].pts.length, 5);                 // 4 vertici + chiusura
  const cub = pathToPolylines('M0 0 C 10 0 10 10 0 10');
  assert.ok(cub[0].pts.length > 20, 'cubica tessellata');
  const arc = pathToPolylines('M0 0 A 10 10 0 0 1 10 10');
  assert.ok(arc[0].pts.length > 3, 'arco tessellato');
});

test('parseSVG → sheetCut: SVG genera un taglio lamiera valido', async () => {
  const r = await sheetCutFromModel(svg(), { thickness: 3, dialect: 'grbl', tabCount: 2 });
  assert.ok(/^M3 S\d+$/m.test(r.gcode) && /^G1 X-?[\d.]+ Y-?[\d.]+ F/m.test(r.gcode));
  assert.ok(r.info.includes('tagli'));
});

test('parseSVG: SVG vuoto → warning, nessun crash', () => {
  const m = parseSVG('<svg></svg>', 'e.svg');
  assert.equal(m.segments.length, 0);
  assert.ok(m.warnings.length >= 1);
});
