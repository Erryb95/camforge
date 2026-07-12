// Test loader STEP (occt WASM) e ActTubes — eseguire con:  node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';

const near = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `atteso ${b}, ottenuto ${a} (tol ${tol})`);

const REAL_DIR = new URL('../CAD-CAM/CAD-CAM/', import.meta.url);
const VENDOR = new URL('../vendor/occt/occt-import-js.wasm', import.meta.url);
const { existsSync } = await import('node:fs');
const { fileURLToPath } = await import('node:url');
const hasReal = existsSync(fileURLToPath(REAL_DIR));
const hasOcct = existsSync(fileURLToPath(VENDOR));

test('ATD: metadati tubo e avviso Parasolid', () => {
  const xml = '<TUBES VERSION="31.4"><MASTER NAME="M" KEY="MAIN">'
    + '<PARAM TYPE="LENGTH"> 5.95</PARAM><PARAM TYPE="MATERIAL">_Inox</PARAM>'
    + '<PARAM TYPE="THICKNESS"> .002</PARAM><PARAM TYPE="ID">T_1_2_154</PARAM>'
    + '<SECTION TYPE="0"><PARAM TYPE="TYPE_KEY">STD_ROUND_TUBE</PARAM>'
    + '<PARAM TYPE="DIAMETER"> .154</PARAM></SECTION><BREP></BREP></MASTER></TUBES>';
  return import('../src/loaders/atd/parser.js').then(({ parseAtd }) => {
    const m = parseAtd(xml, 'test.atd');
    near(m.meta.tubeLength, 5950);
    near(m.meta.tubeDiameter, 154);
    assert.equal(m.meta.tubeName, 'T_1_2_154');
    assert.equal(m.segments.length, 0);
    assert.ok(m.warnings[0].msg.includes('Parasolid'));
  });
});

test('STEP reale: P26015-mi-T005_1.stp → wireframe spigoli', { skip: !hasReal || !hasOcct }, async () => {
  const { readFile } = await import('node:fs/promises');
  const { parseStep } = await import('../src/loaders/step/parser.js');
  const text = await readFile(new URL('P26015-mi-T005_1.stp', REAL_DIR), 'utf8');
  const m = await parseStep(text, 'P26015-mi-T005_1.stp');
  assert.equal(m.warnings.length, 0, JSON.stringify(m.warnings));
  assert.ok(m.segments.length > 50, `pochi spigoli: ${m.segments.length}`);
  assert.ok(m.stats.tools.length >= 1, 'nessun solido');
  assert.ok(m.bounds, 'bounds nulli');
  const dx = m.bounds.max.x - m.bounds.min.x;
  const dy = m.bounds.max.y - m.bounds.min.y;
  const dz = m.bounds.max.z - m.bounds.min.z;
  assert.ok(Math.max(dx, dy, dz) > 1 && Math.max(dx, dy, dz) < 100000,
    `dimensioni sospette: ${dx} × ${dy} × ${dz}`);
});
