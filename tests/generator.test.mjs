// Validazione generatore STEP → NC contro la coppia reale TUBE1 (skip se wasm/COPPIE assenti).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sectionPath, generateTubeNc } from '../src/generator/tubeNc.js';
import { parseNC } from '../src/loaders/nc/parser.js';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `atteso ${b}, ottenuto ${a} (tol ${tol})`);

// --- test unitari del generatore (sempre) ---
test('sectionPath: perimetro rett 40×40 r3 chiuso, normali coerenti', () => {
  const p = sectionPath(40, 40, 3, 6);
  assert.ok(p.length > 8);
  near(p[0].y, 0, 1e-9); near(p[0].z, 20, 1e-9);          // parte dal centro faccia sup
  near(p[0].nz, 1, 1e-9);                                  // normale +Z
  near(p.at(-1).y, 0, 1e-9); near(p.at(-1).z, 20, 1e-9);  // chiude al punto di partenza
  for (const q of p) near(Math.hypot(q.ny, q.nz), 1, 1e-6); // normali unitarie
});

test('generateTubeNc: header G2292 corretto + un foro → NC parsabile', () => {
  const nc = generateTubeNc({ sectionW: 40, sectionH: 40, cornerR: 3, length: 250, holes: [{ xStep: 125, yStep: 0, r: 10, faceZ: 1 }] });
  assert.ok(/G2292 Y-20 V20 Z-20 W20/.test(nc));
  const m = parseNC(nc, 'gen.cn');
  assert.equal(m.meta.tubeWidth, 40);
  assert.equal(m.meta.tubeHeight, 40);
  assert.ok(m.meta.unrollAvailable);
  near(m.bounds.min.x, -255, 1);   // taglio posteriore a ~-(250+trim)
  near(m.bounds.max.x, 0, 1);
});

// --- validazione contro il file macchina reale ---
const WASM = new URL('../vendor/occt-full/opencascade.wasm.wasm', import.meta.url);
const DIR = new URL('../COPPIE/TEST/', import.meta.url);
const ready = existsSync(fileURLToPath(WASM)) && existsSync(fileURLToPath(new URL('TUBE1.step', DIR)));

test('STEP→NC generato ≈ TUBE1.cn reale (geometria)', { skip: !ready, timeout: 120000 }, async () => {
  const { extractBrep } = await import('../src/loaders/step/brep.js');
  const { featuresFromBrep } = await import('../src/generator/features.js');
  const feat = featuresFromBrep(await extractBrep(await readFile(fileURLToPath(new URL('TUBE1.step', DIR)), 'utf8')));
  assert.equal(feat.sectionW, 40);
  assert.equal(feat.sectionH, 40);
  assert.equal(feat.holes.length, 1);
  near(feat.holes[0].r, 10, 0.1);
  near(feat.holes[0].xStep, 125, 1);

  const gen = parseNC(generateTubeNc(feat), 'gen.cn');
  const real = parseNC(await readFile(fileURLToPath(new URL('TUBE1.cn', DIR)), 'utf8'), 'TUBE1.cn');
  // stessa sezione e stesso ingombro (la geometria coincide; il numero di punti
  // differisce solo per densità di tessellazione)
  assert.equal(gen.meta.tubeWidth, real.meta.tubeWidth);
  assert.equal(gen.meta.tubeHeight, real.meta.tubeHeight);
  for (const ax of ['x', 'y', 'z']) {
    near(gen.bounds.min[ax], real.bounds.min[ax], 1.5);
    near(gen.bounds.max[ax], real.bounds.max[ax], 1.5);
  }
});
