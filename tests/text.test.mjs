// Incisione TESTO single-line (font Hershey futural, Public Domain vendorizzato).
// Verifica la resa in polilinee e il G-code di marcatura/scribe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { textToPolylines } from '../src/generator/text.js';
import { sheetTextGcode } from '../src/generator/sheetCut.js';
import { FUTURAL } from '../src/generator/hersheyFutural.js';

test('futural: font caricato con i glifi', () => {
  assert.ok(FUTURAL.chars && Object.keys(FUTURAL.chars).length > 90);
  assert.ok(FUTURAL.chars[String('A'.charCodeAt(0) - 33)].d, "glifo 'A' presente");
});

test('textToPolylines: rende tratti, altezza = size, larghezza cresce col testo', () => {
  const a = textToPolylines('A', { size: 20 });
  assert.ok(a.polylines.length >= 1);
  assert.ok(a.polylines.every((pl) => pl.length >= 2 && 'u' in pl[0] && 'v' in pl[0]));
  assert.ok(Math.abs(a.height - 20) < 1e-6);
  const ab = textToPolylines('AB', { size: 20 });
  assert.ok(ab.width > a.width, 'due lettere più larghe di una');
  // niente sovrapposizione grossolana: la 2ª lettera inizia dopo la 1ª
  const ha = textToPolylines('H', { size: 20 }).width;
  const hh = textToPolylines('HH', { size: 20 }).width;
  assert.ok(hh > ha * 1.5, 'spaziatura tra lettere presente');
});

test('textToPolylines: lo spazio avanza il cursore', () => {
  const w1 = textToPolylines('AA', { size: 20 }).width;
  const w2 = textToPolylines('A A', { size: 20 }).width;
  assert.ok(w2 > w1, 'lo spazio aggiunge larghezza');
});

test('sheetTextGcode: marcatura QtPlasmaC scribe (M03 $1), X/Y, fine M2', () => {
  const { gcode, info } = sheetTextGcode('CAM 123', { size: 15, dialect: 'qtplasmac' });
  assert.ok(/^M03 \$1 S1$/m.test(gcode), 'usa lo scribe');
  assert.ok(/^G1 X-?[\d.]+ Y-?[\d.]+/m.test(gcode), 'moti X/Y');
  assert.ok(!/^G4 /m.test(gcode), 'niente pierce');
  assert.ok(gcode.trimEnd().endsWith('M2'));
  assert.ok(info.includes('CAM 123') && info.includes('tratti'));
});

test('sheetTextGcode: laser GRBL — potenza S, niente material file', () => {
  const { gcode } = sheetTextGcode('OK', { dialect: 'grbl', power: 300 });
  assert.ok(/^M3 S300$/m.test(gcode) && !/M190/.test(gcode));
});
