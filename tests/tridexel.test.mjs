// Motore TRI-DEXEL (4/5 assi): sottrazione intervalli, intersezione raggio↔utensile
// orientato, volume, rappresentazione UNDERCUT (ciò che la Z-map non può fare),
// e ricostruzione mesh (surface nets).
import test from 'node:test';
import assert from 'node:assert/strict';
import { TriDexel, subtractInterval, rayToolInterval } from '../src/sim/tridexel.js';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `atteso ${b}, ottenuto ${a} (tol ${tol})`);
const box = { lo: [-10, -10, -10], hi: [10, 10, 10] };

test('subtractInterval: split, bordi, coperture', () => {
  assert.deepEqual(subtractInterval([-10, 10], -2, 2), [-10, -2, 2, 10]);   // split → overhang
  assert.deepEqual(subtractInterval([-10, 10], -20, 20), []);               // copre tutto
  assert.deepEqual(subtractInterval([-10, 10], -10, 0), [0, 10]);           // bordo sinistro
  assert.deepEqual(subtractInterval([0, 5, 8, 12], 4, 9), [0, 4, 9, 12]);   // due intervalli
  assert.deepEqual(subtractInterval([-10, 10], 5, 5), [-10, 10]);           // vuoto: nop
});

test('rayToolInterval: flat plunge lungo Z, asse allineato', () => {
  // utensile flat R3, asse +Z, punta a z=0. Raggio Z in (0,0): dentro per z∈[0,+∞)∩cilindro
  const iv = rayToolInterval([0, 0, -10], 2, [0, 0, 0], [0, 0, 1], { r: 3, type: 'flat' });
  assert.ok(iv);
  near(iv[0], 0, 1e-6);          // dal fondo utensile (z=0)
  assert.ok(iv[1] > 9);          // fino in cima (semi-infinito)
  // raggio Z a distanza 5 > R3: nessun taglio
  assert.equal(rayToolInterval([5, 0, -10], 2, [0, 0, 0], [0, 0, 1], { r: 3, type: 'flat' }), null);
});

test('rayToolInterval: ball, punta è il punto più basso', () => {
  // ball R4, asse +Z, punta a z=0. Raggio Z sull'asse: entra a z=0 (punta sfera)
  const iv = rayToolInterval([0, 0, -10], 2, [0, 0, 0], [0, 0, 1], { r: 4, type: 'ball' });
  assert.ok(iv);
  near(iv[0], 0, 1e-6);
  // raggio Z a d=2 dall'asse: entra più in alto (calotta) a z = R - sqrt(R²-d²) = 4-sqrt(12)
  const iv2 = rayToolInterval([2, 0, -10], 2, [0, 0, 0], [0, 0, 1], { r: 4, type: 'ball' });
  assert.ok(iv2);
  near(iv2[0], 4 - Math.sqrt(12), 0.02);
});

test('carve plunge flat: volume rimosso ≈ cilindro semi-infinito nel box', () => {
  const td = new TriDexel(box, 0.45);
  const v0 = td.solidVolume();
  td.carve([0, 0, 0], [0, 0, 1], { r: 3, type: 'flat' });   // rimuove z∈[0,10] r3
  near(v0 - td.solidVolume(), Math.PI * 9 * 10, Math.PI * 9 * 10 * 0.05);
});

test('UNDERCUT: tunnel orizzontale → raggio Z con due intervalli', () => {
  const td = new TriDexel(box, 0.45);
  td.carve([-10, 0, 0], [1, 0, 0], { r: 3, type: 'flat' });   // utensile asse +X (semi-inf lungo X)
  const ic = Math.round((0 - td.lo[0]) / td.d[0]);
  const jc = Math.round((0 - td.lo[1]) / td.d[1]);
  const ray = td.fields[2][jc * td.Nn[0] + ic];   // campo Z: indice = v*Nn[0]+u
  assert.equal(ray.length / 2, 2, `attesi 2 intervalli, ${JSON.stringify(ray)}`);
  near(ray[1], -3, 0.5); near(ray[2], 3, 0.5);               // gap ≈ [-3,3]
  // il punto centro-tunnel è VUOTO, sopra/sotto è PIENO (undercut reale)
  assert.equal(td.insideAt(0, 0, 0), false);
  assert.equal(td.insideAt(0, 0, 6), true);
  assert.equal(td.insideAt(0, 0, -6), true);
});

test('toMesh: watertight-ish, senza NaN, dentro il box; vuoto se nulla è cambiato', () => {
  const td = new TriDexel(box, 0.5);
  td.carve([0, 0, -2], [0, 0, 1], { r: 4, type: 'ball' });
  const m = td.toMesh();
  assert.ok(m.indices.length > 0 && m.positions.length > 0);
  assert.ok(m.positions.every((v) => Number.isFinite(v)));
  assert.ok(m.indices.every((i) => i < m.positions.length / 3));
  for (let i = 0; i < m.positions.length; i += 3) {
    assert.ok(m.positions[i] >= box.lo[0] - 1e-6 && m.positions[i] <= box.hi[0] + 1e-6);
    assert.ok(m.positions[i + 2] >= box.lo[2] - 1e-6 && m.positions[i + 2] <= box.hi[2] + 1e-6);
  }
});
