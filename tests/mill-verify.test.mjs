// Verifica FRESATURA (tri-dexel): confronta il volume rimosso con l'atteso
// analitico su geometrie note, e — soprattutto — che l'asportazione vada nel VERSO
// GIUSTO (blocco pieno → materiale rimosso, non il contrario).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newBounds } from '../src/core/model.js';
import { MaterialSim5 } from '../src/sim/materialsim5.js';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `atteso ${b}, ottenuto ${a} (tol ${tol})`);
const seg = (a, b, type = 'feed') => ({ type, from: a, to: b, pts: [a, b], len: Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), tool: 1, feed: 500, block: 0 });

/** Modello di FACING: passate raster su un'area `size`×`size` a quota z. */
function facingModel(size, z, step) {
  const segs = [];
  let dir = 1;
  for (let y = -size / 2; y <= size / 2 + 1e-9; y += step) {
    const a = { x: -dir * size / 2, y, z }, b = { x: dir * size / 2, y, z };
    segs.push(seg(a, b)); dir = -dir;
  }
  const bb = newBounds(); for (const s of segs) { bb.add(s.from); bb.add(s.to); }
  return { segments: segs, bounds: bb.result(), meta: {}, drillPoints: [], warnings: [], stats: {} };
}

const TOOL = { diameter: 4, type: 'flat' };

test('DIREZIONE: il volume solido è monotòno NON crescente con l\'avanzamento (non al contrario)', () => {
  const model = facingModel(40, 0, 3);
  const total = model.segments.reduce((a, s) => a + s.len, 0);
  let prev = Infinity;
  const vols = [];
  for (const pct of [0, 25, 50, 75, 100]) {
    const sim = new MaterialSim5(model, { tool: TOOL, allowance: 6, cellsTarget: 50 });
    sim.carveTo(pct === 100 ? null : total * pct / 100);
    const v = sim.td.solidVolume();
    vols.push(Math.round(v));
    assert.ok(v <= prev + 1, `il volume NON deve crescere: ${v} > ${prev} a ${pct}%`);
    prev = v;
  }
  // e a fine deve aver rimosso davvero materiale (non pochissimo)
  assert.ok(vols[vols.length - 1] < vols[0] * 0.85, `poco rimosso: ${vols.join(', ')}`);
});

test('FACING: volume rimosso ≈ area coperta × profondità (confronto analitico)', () => {
  // stock top = z_cut + allowance; facendo il facing a z=0 con allowance A si
  // rimuove uno strato ~A su tutta l'area spazzata (≈ (size+dia)² per il raggio)
  const size = 40, A = 5;
  const model = facingModel(size, 0, TOOL.diameter * 0.6);   // passo < diametro → copertura piena
  const sim = new MaterialSim5(model, { tool: TOOL, allowance: A, margin: 3, cellsTarget: 70 });
  const v0 = sim.td.solidVolume();
  sim.carveTo(null);
  const removed = v0 - sim.td.solidVolume();
  const area = (size + TOOL.diameter) * (size + TOOL.diameter);   // area spazzata (bordo = raggio)
  near(removed, area * A, area * A * 0.25);                        // ±25% (discretizzazione + bordi)
});

test('PLUNGE: una picchiata rimuove ≈ un cilindro (πr²·h)', () => {
  const r = TOOL.diameter / 2, depth = 8;
  // punto singolo: picchiata a z=-depth in un blocco alto `depth` sopra
  const p = { x: 0, y: 0, z: -depth };
  const model = { segments: [seg({ x: 0, y: 0, z: 0.01 }, p), seg(p, { x: 0.01, y: 0, z: -depth })],
    bounds: newBounds().result === undefined ? null : (() => { const b = newBounds(); b.add({ x: -1, y: -1, z: -depth }); b.add({ x: 1, y: 1, z: 0 }); return b.result(); })(),
    meta: {}, drillPoints: [], warnings: [], stats: {} };
  const sim = new MaterialSim5(model, { tool: TOOL, allowance: 0.5, margin: 4, cellsTarget: 70 });
  const v0 = sim.td.solidVolume();
  sim.carveTo(null);
  const removed = v0 - sim.td.solidVolume();
  const cyl = Math.PI * r * r * depth;                            // cilindro rimosso
  near(removed, cyl, cyl * 0.35);                                 // ±35% (griglia grossa + arrotondamenti)
});
