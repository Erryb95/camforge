// Test AUTOMATICO del contratto QtPlasmaC-NATIVO turnkey (rotary tubo) + del
// caricamento STEP reale in Node headless. Copre:
//   • generatore file-macchina parametrico (round, più misure) → contratto nativo
//   • post rettangolare (torcia che segue) → contratto nativo + Z
//   • parseStep (occt WASM) su STEP reali scaricati/committati, in Node
// Gira con `npm test` (node --test tests/*.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateMachineTest, machineTestPattern, assertNativeContract } from '../scripts/gen-machine-test.mjs';
import { postRotaryPlasmaC } from '../src/generator/post/plasmac.js';
import { circleUV } from '../src/generator/tubeWrap.js';
import { materialNumber } from '../src/generator/plasmacMaterial.js';
import { parseStep } from '../src/loaders/step/parser.js';

const step = (rel) => readFileSync(fileURLToPath(new URL('../samples/' + rel, import.meta.url)));

// --- contratto nativo sul file-macchina, a più misure reali ---
const SIZES = [
  { diameter: 50.8, length: 300, thickness: 2, material: 'mild_steel' },   // 2"
  { diameter: 48.3, length: 300, thickness: 2, material: 'mild_steel' },   // 1.5" pipe
  { diameter: 60.3, length: 400, thickness: 3, material: 'stainless' },
];

for (const s of SIZES) {
  test(`file-macchina Ø${s.diameter}×${s.length} ${s.material} ${s.thickness}mm: contratto QtPlasmaC-nativo`, async () => {
    const { gcode } = await generateMachineTest(s);
    const { ok, checks } = assertNativeContract(gcode);
    assert.ok(ok, 'contratto nativo fallito: ' + JSON.stringify(checks));
    // M190 coerente col numero materiale del material file esportato
    const p = +gcode.match(/M190 P(\d+)/)[1];
    assert.equal(p, materialNumber(s.material, s.thickness));
    // ogni moto è X…A… (rotary), niente Z senza follow (tondo a torcia fissa)
    assert.ok(/^G0 X-?[\d.]+ A-?[\d.]+$/m.test(gcode), 'rapid X/A presente');
    assert.ok(!/^G[01] .* Z/m.test(gcode), 'tondo senza follow → nessuna Z');
    // un M03/M05 per contorno (7 fori)
    assert.equal((gcode.match(/^M03 \$0 S1$/gm) || []).length, 7, 'una accensione per foro');
  });
}

test('machineTestPattern: 7 contorni (3 sommità + 3 fianco + 1 asola)', () => {
  const cs = machineTestPattern({ diameter: 50.8, length: 300 });
  assert.equal(cs.length, 7);
  assert.ok(cs.every((c) => c.pts.length >= 3 && 'u' in c.pts[0] && 'v' in c.pts[0]));
});

test('post rettangolare: contratto nativo + Z (torcia che segue)', () => {
  const rt = { shape: 'rect', width: 60, height: 40, length: 200 };
  const { text } = postRotaryPlasmaC([{ pts: circleUV(30, 10, 6) }], rt, { follow: true, material: 2 });
  const { ok, checks } = assertNativeContract(text);
  assert.ok(ok, 'contratto nativo fallito (rett): ' + JSON.stringify(checks));
  assert.ok(/^G1 .* Z-?[\d.]+ F/m.test(text), 'rett follow → Z sui moti di taglio');
});

// --- caricamento STEP reale in Node headless (occt WASM) ---
test('parseStep in Node: STEP reali si caricano headless (mesh + segmenti)', async () => {
  for (const rel of ['cad/pvc-tee-32mm.step', 'cad/plate-demo.step']) {
    const model = await parseStep(step(rel), rel.split('/').pop());
    assert.ok(model && Array.isArray(model.segments) && model.segments.length > 0, `${rel}: nessun segmento`);
    assert.ok(model.mesh, `${rel}: nessuna mesh`);
  }
});

test('parseStep: un tubo STEP viene auto-rilevato (unrollAvailable)', async () => {
  const model = await parseStep(step('tubi step/TUBE1.1.step'), 'TUBE1.1.step');
  assert.equal(model.meta?.unrollAvailable, true, 'il tubo STEP dovrebbe essere rilevato e srotolabile');
});
