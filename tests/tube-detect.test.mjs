// Svolto per file CAD 3D (.stp/.step): rilevamento tubo + seg.uv, con la
// stessa resa allineata a UNA sezione dei file NC (foldToStrip nei renderer).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { applyCadTubeUnroll } from '../src/loaders/cad/tubeDetect.js';
import { foldToStrip } from '../src/core/unroll.js';

// --- unitario: tubo sintetico rettangolare 40×20, L=200, asse X ---
function syntheticTube() {
  /** @type {import('../src/core/model.js').Segment[]} */
  const segs = [];
  const add = (from, to) => segs.push({ type: 'feed', from, to, pts: [from, to], line: 1, tool: 1, feed: null, len: 1 });
  // spigoli longitudinali del parallelepipedo 40(y)×20(z), campionati
  for (let x = 0; x <= 200; x += 10) {
    for (const [y, z] of [[-20, 10], [20, 10], [20, -10], [-20, -10]]) {
      add({ x, y, z }, { x: x + 5, y, z });
    }
  }
  // un "foro" quadrato sulla faccia superiore z=+10
  for (const [a, b] of [[[90, -5], [110, -5]], [[110, -5], [110, 5]], [[110, 5], [90, 5]], [[90, 5], [90, -5]]]) {
    add({ x: a[0], y: a[1], z: 10 }, { x: b[0], y: b[1], z: 10 });
  }
  return segs;
}

test('applyCadTubeUnroll: rileva tubo rett 40×20 e calcola seg.uv', () => {
  const segs = syntheticTube();
  const meta = {};
  const ok = applyCadTubeUnroll(segs, meta);
  assert.ok(ok, 'tubo non rilevato');
  assert.ok(meta.unrollAvailable);
  // sezione 40×20 (l'assegnazione degli assi può scambiare w/h)
  const dims = [meta.tubeWidth, meta.tubeHeight].sort((a, b) => a - b);
  assert.ok(Math.abs(dims[0] - 20) < 0.5 && Math.abs(dims[1] - 40) < 0.5, `sezione ${dims}`);
  assert.ok(Math.abs(meta.perimeter - 120) < 1, `perimetro ${meta.perimeter}`);
  assert.ok(segs.every((s) => s.uv && s.uv.length === s.pts.length));
  // u dal fondo: [0, 205] (tolleranza: l'asse PCA può avere una deriva infinitesima)
  let uMin = Infinity, uMax = -Infinity;
  for (const s of segs) for (const q of s.uv) { uMin = Math.min(uMin, q.u); uMax = Math.max(uMax, q.u); }
  assert.ok(Math.abs(uMin) < 0.1 && Math.abs(uMax - 205) < 0.1, `u [${uMin},${uMax}]`);
});

test('applyCadTubeUnroll: NON scatta su un pezzo piatto', () => {
  /** @type {any[]} */
  const segs = [];
  for (let x = 0; x <= 100; x += 5) {
    segs.push({ type: 'feed', from: { x, y: 0, z: 0 }, to: { x, y: 60, z: 0 }, pts: [{ x, y: 0, z: 0 }, { x, y: 60, z: 0 }], line: 1, tool: 1, feed: null, len: 60 });
  }
  const meta = {};
  assert.equal(applyCadTubeUnroll(segs, meta), false);
  assert.ok(!meta.unrollAvailable);
});

// --- e2e: TUBE1.step svolto ≈ TUBE1.cn svolto (skip senza wasm/COPPIE) ---
const OCCT = fileURLToPath(new URL('../vendor/occt/occt-import-js.wasm', import.meta.url));
const DIR = new URL('../COPPIE/TEST/', import.meta.url);
const ready = existsSync(OCCT) && existsSync(fileURLToPath(new URL('TUBE1.step', DIR)));

test('TUBE1.step: svolto attivo con perimetro identico a TUBE1.cn', { skip: !ready, timeout: 120000 }, async () => {
  const { parseStep } = await import('../src/loaders/step/parser.js');
  const { parseNC } = await import('../src/loaders/nc/parser.js');
  const step = await parseStep(await readFile(fileURLToPath(new URL('TUBE1.step', DIR)), 'utf8'), 'TUBE1.step');
  const cn = parseNC(await readFile(fileURLToPath(new URL('TUBE1.cn', DIR)), 'utf8'), 'TUBE1.cn');

  assert.ok(step.meta.unrollAvailable, 'svolto non attivo sul .step');
  assert.equal(step.meta.perimeter, cn.meta.perimeter);          // 160 (40×40)
  assert.deepEqual(step.meta.unrollGuides, cn.meta.unrollGuides);

  // il foro Ø20: nello svolto STEP deve esistere un gruppo di punti con
  // escursione v ≈ 20 mm (il diametro), come nel .cn (a meno della banda:
  // la scelta della faccia "top" da pura geometria è arbitraria mod 90°)
  const vs = [];
  for (const s of step.segments) {
    if (!s.uv) continue;
    for (const q of s.uv) vs.push(foldToStrip(q.v, step.meta.perimeter));
  }
  assert.ok(vs.length > 50);
  // lo sviluppo copre la sezione: gli spigoli-linea sono campionati agli
  // ESTREMI (i vertici agli spigoli della sezione arrivano a ±(per/2 − h/2−r)),
  // quindi l'escursione attesa è ≥ ~0.75·perimetro, non il perimetro pieno
  const span = Math.max(...vs) - Math.min(...vs);
  assert.ok(span > 0.7 * step.meta.perimeter, `escursione v ${span}`);
});
