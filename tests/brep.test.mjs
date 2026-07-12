// Test estrazione B-rep esatta via opencascade.js (skip se wasm/COPPIE assenti).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const WASM = new URL('../vendor/occt-full/opencascade.wasm.wasm', import.meta.url);
const STEP = new URL('../COPPIE/TEST/TUBE1.step', import.meta.url);
const ready = existsSync(fileURLToPath(WASM)) && existsSync(fileURLToPath(STEP));

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `atteso ${b}, ottenuto ${a}`);

test('B-rep TUBE1: bbox 250×40×40, foro Ø20 radiale esatto, raccordi distinti', { skip: !ready, timeout: 120000 }, async () => {
  const { extractBrep } = await import('../src/loaders/step/brep.js');
  const b = await extractBrep(await readFile(fileURLToPath(STEP), 'utf8'));
  near(b.bbox.max.x - b.bbox.min.x, 250, 1);
  near(b.bbox.max.y - b.bbox.min.y, 40, 1);
  near(b.bbox.max.z - b.bbox.min.z, 40, 1);
  assert.ok(b.edges.length > 50, `pochi spigoli: ${b.edges.length}`);
  // foro Ø20 = cilindro r=10 con asse radiale (non lungo X)
  const holes = b.cylinders.filter((c) => Math.abs(c.r - 10) < 0.1 && Math.abs(c.dir.x) < 0.3);
  assert.ok(holes.length >= 1, 'foro Ø20 non trovato');
  near(holes[0].c.x, 125, 1);   // a metà tubo
  near(holes[0].c.y, 0, 1);     // centrato
  // i raccordi spigolo (r=3, r=1) hanno asse ASSIALE (lungo X): non sono fori
  const fillets = b.cylinders.filter((c) => c.r < 5 && Math.abs(c.dir.x) > 0.9);
  assert.ok(fillets.length >= 4, 'raccordi spigolo non riconosciuti');
});
