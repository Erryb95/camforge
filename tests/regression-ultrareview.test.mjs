// REGRESSIONI — bug CONFERMATI dalla ultra-review avversariale (2026-07).
// Ogni test riproduce un difetto reale trovato e ora corretto: serve a impedirne
// il ritorno. Ognuno cita in commento il sintomo originale.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { copeProfile, copeToRotary } from '../src/generator/coping.js';
import { pathToPolylines } from '../src/loaders/svg/parser.js';
import { textToPolylines } from '../src/generator/text.js';
import { estimateJob } from '../src/generator/report.js';
import { sheetCutFromModel } from '../src/generator/sheetCut.js';
import { parseDXF } from '../src/loaders/dxf/parser.js';

const DXF = fileURLToPath(new URL('../samples/dxf/piastra-4fori.dxf', import.meta.url));
const dxf = () => parseDXF(readFileSync(DXF, 'utf8'), 'piastra-4fori.dxf');

// BUG: angolo ~0/180° (assi paralleli) → sinθ→0 → t(φ) = …/sinθ = ±Infinity/NaN →
// NGC con lunghezza negativa/NaN. Ora: warning + profilo NaN-safe + copeToRotary lancia.
test('coping: angolo degenere (assi paralleli) → warning, nessun NaN, errore chiaro', () => {
  const p = copeProfile({ branchDiameter: 40, mainDiameter: 60, angleDeg: 0, points: 180 });
  assert.ok(p.warning, 'atteso warning per angolo degenere');
  assert.ok(Number.isFinite(p.tMin) && Number.isFinite(p.tMax), 'niente Infinity/NaN a valle');
  assert.ok(Number.isFinite(p.notchDepth));
  assert.throws(() => copeToRotary({ branchDiameter: 40, mainDiameter: 60, angleDeg: 0 }),
    /degener|angolo|paralleli/i, 'niente NGC con geometria degenere');
});

// BUG: SVGO comprime i flag d'arco ("A10 10 0 0 1 10 10" → "A10 10 0 0110 10", cioè
// large=0,sweep=1 attaccati alla X). Il vecchio parser leggeva "0110" come un numero →
// arco stravolto. Ora flag() legge una cifra 0/1 per volta.
test('SVG: flag d\'arco compattati (0110) danno lo stesso arco della forma spaziata', () => {
  const spaced = pathToPolylines('M0 0 A 10 10 0 0 1 10 10');
  const packed = pathToPolylines('M0 0 A 10 10 0 0110 10');
  assert.ok(packed[0].pts.length > 3, 'arco compattato tessellato (non un segmento dritto)');
  const eSpaced = spaced[0].pts.at(-1);   // punti = [x, y]
  const ePacked = packed[0].pts.at(-1);
  assert.ok(Math.hypot(eSpaced[0] - ePacked[0], eSpaced[1] - ePacked[1]) < 1e-6, 'stesso endpoint');
});

// BUG: campo feed vuoto nell'UI → opts.feed = NaN → "G1 X.. FNaN" (G-code non valido).
// Ora Number.isFinite gate → ripiego sul preset; mai "NaN" nel programma.
test('sheetCut: feed NaN (campo UI vuoto) → nessun "NaN" nel G-code', async () => {
  const { gcode } = await sheetCutFromModel(dxf(), { thickness: 4, dialect: 'grbl', feed: NaN });
  assert.ok(!/NaN/.test(gcode), 'nessun token NaN');
  assert.ok(/\bF\d+/.test(gcode), 'feed numerico valido presente');
});

// BUG: il conteggio pierce contava anche lo scribe/marcatura (M03 $1) come foratura →
// consumabili/tempo gonfiati. Ora solo la torcia da taglio ($0 o senza $) conta.
test('report: lo scribe (M03 $1) NON è contato come pierce', () => {
  const g = [
    'G0 X0 Y0', 'M03 $0 S1', 'G1 X10 Y0 F3000', 'M05 $0',   // 1 taglio → 1 pierce
    'G0 X0 Y5', 'M03 $1 S1', 'G1 X10 Y5 F2000', 'M05 $1',   // scribe → 0 pierce
  ].join('\n');
  const e = estimateJob(g, { feed: 3000, pierceSec: 0.5 });
  assert.equal(e.pierces, 1, 'solo la torcia da taglio conta come pierce');
});

// BUG: size ≤ 0 (o non numerico) → divisione per 0 nella scala → coordinate NaN.
// Ora size si riduce a un default > 0 e il testo si rende comunque.
test('text: size = 0 → ripiego valido, nessun NaN nelle coordinate', () => {
  const t = textToPolylines('A', { size: 0 });
  assert.ok(t.polylines.length > 0, 'rende comunque il tratto');
  assert.ok(t.width > 0 && t.height > 0, 'dimensioni positive');
  for (const pl of t.polylines) for (const p of pl) assert.ok(Number.isFinite(p.u) && Number.isFinite(p.v));   // punti = {u, v}
});
