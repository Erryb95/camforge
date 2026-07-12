// Test routing .cn (LXD XML vs NC G-code) + coppie reali STEP↔NC (skip se assenti).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import '../src/loaders/nc/index.js';
import '../src/loaders/alma/index.js';
import '../src/loaders/step/index.js';
import { parseFile } from '../src/core/registry.js';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `atteso ${b}, ottenuto ${a}`);

// --- routing per contenuto (sempre eseguito) ---
test('.cn routing: G-code → parser NC', () => {
  const gcode = '% .cn\nG2292 Y-20 V20 Z-20 W20 I3 X0 U-6000\nG21 G90\nG1 X-10 Y0 Z20 F1000\nM30\n';
  const { model } = parseFile('x.cn', gcode);
  assert.equal(model.meta.tubeWidth, 40);
  assert.equal(model.meta.tubeHeight, 40);
  assert.ok(model.segments.length >= 1);
});

test('.cn routing: XML <LXDDocument> → parser AlmaCAM', () => {
  const xml = '<LXDDocument FileVer="1"><ExtMin X="-20" Y="-20" Z="0"/><ExtMax X="20" Y="20" Z="250"/>'
    + '<Segments TubeLength="250" TubeName="T"><GeoCurve><Polyline3D>'
    + '<Point3D X="0" Y="0" Z="10"/><Point3D X="10" Y="0" Z="10"/></Polyline3D></GeoCurve></Segments></LXDDocument>';
  const { model } = parseFile('y.cn', xml);
  assert.equal(model.meta.dialect, 'AlmaCAM');
});

test('dialetto .cn/.pgm: F(feed1) e X(kine_x) non generano avvisi, JMPF resta macro', async () => {
  const { parseNC } = await import('../src/loaders/nc/parser.js');
  const m = parseNC([
    '% .cn', 'G2292 Y-20 V20 Z-20 W20 I3 X0 U-6000',
    'JMPF(start_track)',
    'G800 D1 G10 X-0.95 Y0 Z20 F(feed1) T1 P1 R1',   // direttiva G>=100: nessun avviso
    'G1 X-5 Y0 Z20 F(feed1)',                          // F parametrico: nessun junk
  ].join('\n'), 't.cn');
  // solo l'avviso del salto JMPF (macro), niente "testo non riconosciuto"
  assert.ok(!m.warnings.some((w) => w.msg.includes('non riconosciuto')), JSON.stringify(m.warnings));
});

// --- coppie reali (skip se assenti) ---
const DIR = new URL('../COPPIE/TEST/', import.meta.url);
const have = (f) => existsSync(fileURLToPath(new URL(f, DIR)));

for (const n of ['TUBE1', 'TUBE2', 'TUBE3', 'TUBE4']) {
  test(`coppia ${n}: .cn NC pulito`, { skip: !have(`${n}.cn`) }, async () => {
    const { model: m } = parseFile(`${n}.cn`, await readFile(new URL(`${n}.cn`, DIR), 'utf8'));
    assert.equal(m.meta.tubeWidth, 40);
    assert.equal(m.meta.tubeHeight, 40);
    assert.ok(m.meta.unrollAvailable, 'unroll non attivo');
    assert.ok(m.mesh, 'mesh tubo assente');
    assert.ok(m.segments.length > 100, `pochi segmenti: ${m.segments.length}`);
    // solo avvisi strutturali (macro/salto), non "testo non riconosciuto"
    assert.ok(!m.warnings.some((w) => w.msg.includes('non riconosciuto')), JSON.stringify(m.warnings));
    assert.ok(m.warnings.length <= 2, `troppi avvisi: ${m.warnings.length}`);
  });

  test(`coppia ${n}: STEP ↔ .cn stessa sezione 40×40 e lunghezza ~250`, { skip: !have(`${n}.step`), timeout: 60000 }, async () => {
    const { model: st } = parseFile(`${n}.step`, await readFile(new URL(`${n}.step`, DIR), 'utf8'));
    const stm = await Promise.resolve(st);
    near(stm.bounds.max.y - stm.bounds.min.y, 40, 1);   // sezione 40 in Y
    near(stm.bounds.max.z - stm.bounds.min.z, 40, 1);   // sezione 40 in Z
    near(stm.bounds.max.x - stm.bounds.min.x, 250, 2);  // lunghezza 250
  });
}
