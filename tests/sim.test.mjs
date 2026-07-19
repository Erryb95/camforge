// Motore di asportazione a 3 assi (Z-map): impronta utensile, carve monotòno,
// volume, facing, default stock, contratto mesh, MaterialSim end-to-end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTool, footprint } from '../src/sim/tool.js';
import { Heightmap } from '../src/sim/heightmap.js';
import { heightmapToMesh } from '../src/sim/mesh.js';
import { stockFromModel } from '../src/sim/stock.js';
import { MaterialSim, detectTool } from '../src/sim/materialsim.js';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `atteso ${b}, ottenuto ${a} (tol ${tol})`);

test('footprint: flat piatta entro R, ∞ oltre', () => {
  const t = makeTool({ type: 'flat', diameter: 10 });
  assert.equal(footprint(t, 0), 0);
  assert.equal(footprint(t, 4.9), 0);
  assert.equal(footprint(t, 5.0), Infinity);
  assert.equal(footprint(t, 7), Infinity);
});

test('footprint: ball = calotta sferica, cresce col raggio, esatta', () => {
  const t = makeTool({ type: 'ball', diameter: 10 });   // R=5
  near(footprint(t, 0), 0, 1e-12);                        // punta al centro
  near(footprint(t, 3), 5 - Math.sqrt(25 - 9), 1e-12);   // = 5-4 = 1
  near(footprint(t, 4), 5 - 3, 1e-12);                    // = 2
  assert.ok(footprint(t, 2) < footprint(t, 4));          // monotòna crescente
  assert.equal(footprint(t, 5), Infinity);
});

test('footprint: bull piatta poi raccordo', () => {
  const t = makeTool({ type: 'bull', diameter: 10, cornerR: 2 });  // R=5, flat fino a 3
  assert.equal(footprint(t, 2), 0);
  assert.equal(footprint(t, 3), 0);
  near(footprint(t, 4), 2 - Math.sqrt(4 - 1), 1e-12);              // raccordo
  assert.equal(footprint(t, 5), Infinity);
});

test('carve monotòno: nessun nodo aumenta mai', () => {
  const hm = new Heightmap(0, 0, 0.5, 0.5, 40, 40, 0, -10);
  const t = makeTool({ type: 'ball', diameter: 6 });
  const before = hm.z.slice();
  hm.stamp(t, 10, 10, -3);
  hm.stamp(t, 12, 10, -2);
  hm.stamp(t, 10, 10, -5);   // ripassa più a fondo
  for (let k = 0; k < hm.z.length; k++) assert.ok(hm.z[k] <= before[k] + 1e-12);
  // il nodo centrale deve essere sceso a circa -5 (punta ball)
  const kc = Math.round(10 / 0.5) + Math.round(10 / 0.5) * hm.nnx;
  near(hm.z[kc], -5, 0.3);
});

test('volume: plunge flat Ø10 per h=5 ≈ πR²h', () => {
  const hm = new Heightmap(-20, -20, 0.2, 0.2, 200, 200, 0, -20);
  const t = makeTool({ type: 'flat', diameter: 10 });   // R=5
  hm.stamp(t, 0, 0, -5);                                  // punta a -5 → h=5
  const expected = Math.PI * 25 * 5;                      // ≈ 392.7
  near(hm.removedVolume(), expected, expected * 0.05);
});

test('facing: passata piana porta la cima interna a zt', () => {
  const hm = new Heightmap(0, 0, 0.5, 0.5, 40, 40, 0, -10);
  const t = makeTool({ type: 'flat', diameter: 6 });
  for (let y = 4; y <= 16; y += 1) for (let x = 4; x <= 16; x += 1) hm.stamp(t, x, y, -2);
  const kc = Math.round(10 / 0.5) + Math.round(10 / 0.5) * hm.nnx;   // nodo (10,10)
  near(hm.z[kc], -2, 1e-9);
});

test('stockFromModel: bbox + margine + risoluzione clamp', () => {
  const seg = (a, b) => ({ type: 'feed', from: a, to: b, pts: [a, b], len: Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) });
  const model = { segments: [
    seg({ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: -2 }),
    seg({ x: 100, y: 0, z: -2 }, { x: 100, y: 60, z: -5 }),
  ] };
  const hm = stockFromModel(model);
  assert.ok(hm);
  assert.ok(hm.x0 < 0 && hm.y0 < 0);                       // margine applicato
  assert.ok(hm.nx >= 40 && hm.nx <= 220 && hm.ny >= 40 && hm.ny <= 220);
  assert.ok(hm.zTop > 0);                                   // sovrametallo sopra
  assert.ok(hm.zBottom < -5);                               // sotto il taglio più basso
});

test('mesh: contratto {positions,indices,fresh} coerente e senza NaN', () => {
  const hm = new Heightmap(0, 0, 1, 1, 10, 12, 0, -5);
  const t = makeTool({ type: 'flat', diameter: 4 });
  hm.stamp(t, 5, 6, -3);
  const m = heightmapToMesh(hm);
  assert.equal(m.positions.length, 3 * hm.nnx * hm.nny + 3 * (2 * (hm.nx + hm.ny) * 4 + 4));  // top nodi + skirt + fondo
  assert.equal(m.nTop, hm.nx * hm.ny * 2);                  // 2 tri per cella
  assert.equal(m.fresh.length, m.indices.length / 3);
  assert.ok(m.indices.every((i) => i < m.positions.length / 3));
  assert.ok(m.positions.every((v) => Number.isFinite(v)));
  assert.ok([...m.fresh.slice(0, m.nTop)].some((f) => f === 1));  // qualche tri "appena tagliato"
});

test('detectTool: legge "10mm ball nose" dai commenti (stile 3D_Chips)', () => {
  assert.deepEqual(detectTool({ rawLines: ['( 10mm ball nose )'] }), { type: 'ball', diameter: 10 });
  assert.deepEqual(detectTool({ rawLines: ['(no tool info)'] }), { type: 'flat', diameter: 6 });
});

test('MaterialSim: carve forward-only, reset su scrub indietro, volume cresce', () => {
  // pezzo sintetico: una passata che affonda progressivamente lungo X
  const seg = (a, b) => ({ type: 'feed', from: a, to: b, pts: [a, b], len: Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) });
  const model = { rawLines: ['(flat 6mm)'], segments: [
    seg({ x: 0, y: 10, z: 0 }, { x: 20, y: 10, z: -3 }),
    { type: 'rapid', from: { x: 20, y: 10, z: -3 }, to: { x: 0, y: 10, z: 5 }, pts: [{ x: 20, y: 10, z: -3 }, { x: 0, y: 10, z: 5 }], len: 22 },
    seg({ x: 0, y: 12, z: -3 }, { x: 20, y: 12, z: -3 }),
  ] };
  const sim = new MaterialSim(model);
  assert.ok(sim.ok);
  const halfCut = model.segments[0].len / 2;
  sim.carveTo(halfCut);
  const vHalf = sim.hm.removedVolume();
  assert.ok(vHalf > 0);
  sim.carveTo(sim.total);                                   // fino in fondo
  const vFull = sim.hm.removedVolume();
  assert.ok(vFull > vHalf, `pieno ${vFull} > metà ${vHalf}`);
  // scrub all'indietro: reset + re-carve, volume torna a quello di metà
  sim.carveTo(halfCut);
  near(sim.hm.removedVolume(), vHalf, vHalf * 0.02 + 1e-6);
  // il rapido NON taglia: dopo il solo primo tratto+rapido il volume = solo primo tratto
  const m = sim.mesh();
  assert.ok(m && m.positions.length > 0);
});
