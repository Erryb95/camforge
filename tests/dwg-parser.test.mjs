// Test del loader DWG (libredwg WASM) su file reali multi-versione.
// I DWG di esempio (samples/dwg/) vengono dal test-suite LibreDWG (GPL).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseDwg } from '../src/loaders/dwg/parser.js';

const dir = new URL('../samples/dwg/', import.meta.url);
const have = (f) => existsSync(fileURLToPath(new URL(f, dir)));

for (const f of ['sample_2000.dwg', 'sample_2018.dwg']) {
  test(`DWG reale: ${f}`, { skip: !have(f) }, async () => {
    const bytes = new Uint8Array(await readFile(new URL(f, dir)));
    const m = await parseDwg(bytes, f);
    assert.ok(m.segments.length > 50, `pochi segmenti: ${m.segments.length}`);
    assert.equal(m.warnings.length, 0, JSON.stringify(m.warnings));
    assert.ok(m.stats.tools.length >= 1, 'nessun layer');
    assert.ok(m.bounds, 'bounds nulli');
    const w = m.bounds.max.x - m.bounds.min.x;
    assert.ok(w > 1 && w < 1e6, `larghezza sospetta: ${w}`);
    // ogni segmento deve appartenere a un layer con nome
    for (const s of m.segments) assert.ok(m.toolNames[s.tool], 'segmento senza layer');
  });
}

test('DWG: versioni 2000 e 2018 danno la stessa geometria', { skip: !have('sample_2000.dwg') || !have('sample_2018.dwg') }, async () => {
  const a = await parseDwg(new Uint8Array(await readFile(new URL('sample_2000.dwg', dir))), 'a.dwg');
  const b = await parseDwg(new Uint8Array(await readFile(new URL('sample_2018.dwg', dir))), 'b.dwg');
  assert.equal(a.segments.length, b.segments.length);
  assert.ok(Math.abs((a.bounds.max.x - a.bounds.min.x) - (b.bounds.max.x - b.bounds.min.x)) < 1e-6);
});
