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

test('STEP reale: P26015-mi-T005_1.stp → mesh + spigoli sequenziati', { skip: !hasReal || !hasOcct }, async () => {
  const { readFile } = await import('node:fs/promises');
  const { parseStep } = await import('../src/loaders/step/parser.js');
  const text = await readFile(new URL('P26015-mi-T005_1.stp', REAL_DIR), 'utf8');
  const m = await parseStep(text, 'P26015-mi-T005_1.stp');
  assert.equal(m.warnings.length, 0, JSON.stringify(m.warnings));
  assert.ok(m.segments.length > 50, `pochi spigoli: ${m.segments.length}`);
  assert.ok(m.mesh && m.mesh.indices.length > 100, 'mesh solida assente');
  assert.ok(m.stats.tools.length >= 1, 'nessun solido');
  const dMax = Math.max(m.bounds.max.x - m.bounds.min.x, m.bounds.max.y - m.bounds.min.y, m.bounds.max.z - m.bounds.min.z);
  assert.ok(dMax > 1 && dMax < 100000, `dimensioni sospette: ${dMax}`);
  // sequenza ordinata: il salto medio tra segmenti consecutivi è contenuto
  let jump = 0;
  for (let i = 1; i < m.segments.length; i++) {
    const a = m.segments[i - 1].to, b = m.segments[i].from;
    jump += Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }
  assert.ok(jump / m.segments.length < 40, `sequenza non ordinata: salto medio ${jump / m.segments.length}`);
});

const IGS = new URL('../samples/cad/cube.igs', import.meta.url);
const hasIges = existsSync(fileURLToPath(IGS));
test('IGES: cube.igs → solido 10×10×10', { skip: !hasIges || !hasOcct }, async () => {
  const { readFile } = await import('node:fs/promises');
  const { parseStep } = await import('../src/loaders/step/parser.js');
  const m = await parseStep(await readFile(IGS, 'utf8'), 'cube.igs');
  assert.equal(m.meta.dialect, 'IGES');
  assert.ok(m.mesh && m.mesh.indices.length === 36, `mesh cubo attesa 12 tri, avute ${m.mesh ? m.mesh.indices.length / 3 : 0}`);
  near(m.bounds.max.x - m.bounds.min.x, 10, 0.01);
  near(m.bounds.max.y - m.bounds.min.y, 10, 0.01);
  near(m.bounds.max.z - m.bounds.min.z, 10, 0.01);
});
