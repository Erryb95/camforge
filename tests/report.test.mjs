// REPORT lavoro: stima tempo + costo dal G-code (per i preventivi). SheetCam dà
// solo il tempo; qui anche il costo (macchina + consumabili + materiale).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { estimateJob, reportText } from '../src/generator/report.js';
import { sheetCutFromModel } from '../src/generator/sheetCut.js';
import { parseDXF } from '../src/loaders/dxf/parser.js';

const DXF = fileURLToPath(new URL('../samples/dxf/piastra-4fori.dxf', import.meta.url));
const dxf = () => parseDXF(readFileSync(DXF, 'utf8'), 'piastra-4fori.dxf');

test('estimateJob: lunghezze, pierce e tempo dal G-code', async () => {
  const { gcode } = await sheetCutFromModel(dxf(), { thickness: 3, dialect: 'grbl', feed: 3000, tabCount: 0 });
  const e = estimateJob(gcode, { feed: 3000, pierceSec: 0.5 });
  assert.ok(e.cutLen > 500, `lunghezza taglio > 0 (ottenuto ${e.cutLen.toFixed(0)})`);
  assert.equal(e.pierces, 5, '5 pierce (perimetro + 4 fori)');
  assert.ok(e.timeMin > 0 && e.cutMin > 0);
});

test('estimateJob: costo con tariffe (macchina + consumabili + materiale)', async () => {
  const { gcode } = await sheetCutFromModel(dxf(), { thickness: 3, dialect: 'grbl', feed: 3000 });
  const e = estimateJob(gcode, { feed: 3000, ratePerHour: 60, costPerPierce: 0.1, materialCost: 5 });
  assert.ok(e.machineCost > 0, 'costo macchina dal tempo');
  assert.ok(Math.abs(e.consumables - 0.5) < 1e-9, '5 pierce × 0.1 = 0.5');
  assert.ok(e.total > 5, 'totale include il materiale');
});

test('estimateJob: solo tempo se nessuna tariffa (total 0)', () => {
  const e = estimateJob('G0 X0 Y0\nM3 S800\nG1 X100 Y0 F3000\nM5\n', { feed: 3000 });
  assert.equal(e.total, 0);
  assert.ok(e.timeMin > 0);
});

test('reportText: contiene tempo (sempre) e costo (se tariffe)', () => {
  const g = 'G0 X0 Y0\nM3 S800\nG1 X100 Y0 F3000\nG1 X100 Y100\nM5\n';
  assert.ok(reportText(estimateJob(g, { feed: 3000 }), { name: 'x.ngc' }).includes('TEMPO TOTALE'));
  const t = reportText(estimateJob(g, { feed: 3000, ratePerHour: 60, costPerPierce: 0.1 }), { name: 'x.ngc' });
  assert.ok(t.includes('COSTO TOTALE') && t.includes('x.ngc') && t.includes('Sfondamenti'));
});
