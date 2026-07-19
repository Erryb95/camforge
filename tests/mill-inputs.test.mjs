// Ingressi fresatura: FRESE parametriche per materiale (bitgen) + DXF 2.5D
// fresabile (dxfmill). Verifica che ogni materiale generi una punta con geometria
// DIVERSA (n. lobi = n. taglienti) e che un DXF con contorni chiusi diventi una
// lastra solida con fori, digeribile da partToMillGcode.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeEndmill, bitSpecForMaterial, helixFromGeom } from '../src/sim/bitgen.js';
import { MATERIALS, materialById } from '../src/sim/materials.js';
import { parseDXF } from '../src/loaders/dxf/parser.js';
import { closedRingsFromDxf, dxfToPartMesh } from '../src/generator/dxfmill.js';
import { partToMillGcode } from '../src/generator/partmill.js';

// conta i lobi (lands) sul primo anello di taglio: massimi locali del raggio
function countLobes(bit, seg) {
  const R = [];
  const start = 1;   // primo anello dopo il vertice-punta
  for (let a = 0; a < seg; a++) {
    const i = (start * seg + 1 + a) * 3;
    R.push(Math.hypot(bit.positions[i], bit.positions[i + 2]));
  }
  let peaks = 0;
  for (let a = 0; a < seg; a++) {
    const p = R[a], pl = R[(a + seg - 1) % seg], pn = R[(a + 1) % seg];
    if (p > pl && p >= pn && p > 2.85) peaks++;
  }
  return peaks;
}

test('makeEndmill: mesh valida (niente NaN, indici in range, punta a Y-min)', () => {
  for (const tip of ['flat', 'ball', 'vee']) {
    const g = makeEndmill({ dia: 6, flutes: 3, tip });
    for (const v of g.positions) assert.ok(Number.isFinite(v), 'nessun NaN');
    const nv = g.positions.length / 3;
    let maxIdx = 0;
    for (const i of g.indices) if (i > maxIdx) maxIdx = i;
    assert.equal(maxIdx, nv - 1, 'indici entro i vertici');
    assert.equal(g.triTool.length, g.indices.length / 3, 'triTool per triangolo');
    assert.equal(g.dia, 6);
    assert.deepEqual(g.tip, [0, 0, 0], 'tagliente all\'origine (Y-min)');
  }
});

test('makeEndmill: il n. di lobi = n. di taglienti', () => {
  const seg = Math.max(56, 2 * 18);
  assert.equal(countLobes(makeEndmill({ dia: 6, flutes: 2, tip: 'flat' }), seg), 2);
  assert.equal(countLobes(makeEndmill({ dia: 6, flutes: 3, tip: 'flat' }), Math.max(56, 3 * 18)), 3);
  assert.equal(countLobes(makeEndmill({ dia: 6, flutes: 5, tip: 'flat' }), 5 * 18), 5);
});

test('makeEndmill: geometrie diverse per taglienti diversi', () => {
  const sum = (b) => { let s = 0; for (let i = 0; i < b.positions.length; i++) s = (s + Math.round(b.positions[i] * 1000)) % 1000000007; return s; };
  const a = makeEndmill({ dia: 6, flutes: 2, tip: 'flat', helixDeg: 40 });
  const b = makeEndmill({ dia: 6, flutes: 4, tip: 'flat', helixDeg: 30 });
  assert.notEqual(sum(a), sum(b), 'mesh distinte, non ricolorate');
});

test('helixFromGeom: estrae l\'angolo d\'elica dalla descrizione', () => {
  assert.equal(helixFromGeom('high-helix 40°'), 40);
  assert.equal(helixFromGeom('elica bassa 15°'), 15);
  assert.equal(helixFromGeom('O-flute single-flute'), 30);   // default
});

test('bitSpecForMaterial: ogni materiale ha una spec coerente coi suoi taglienti', () => {
  for (const m of MATERIALS) {
    const s = bitSpecForMaterial(m);
    assert.equal(s.flutes, m.flutes);
    assert.ok(s.helixDeg >= 10 && s.helixDeg <= 50);
    assert.ok(makeEndmill(s).positions.length > 0);
  }
  // le plastiche O-flute hanno 1 tagliente
  assert.equal(bitSpecForMaterial(materialById('pom')).flutes, 1);
});

test('dxfmill: DXF con contorni chiusi → lastra solida con fori, fresabile', () => {
  const model = parseDXF(readFileSync('samples/dxf/piastra-4fori.dxf', 'utf8'), 'piastra-4fori.dxf');
  const rings = closedRingsFromDxf(model);
  assert.ok(rings.length >= 2, 'almeno esterno + un foro');
  const g = dxfToPartMesh(model);
  assert.ok(g.holes >= 1, 'almeno un foro rilevato dentro l\'esterno');
  assert.ok(g.thickness > 0);
  for (const v of g.positions) assert.ok(Number.isFinite(v));
  // la mesh estrusa è digeribile dal generatore di fresatura
  const mill = partToMillGcode({ positions: g.positions, indices: g.indices }, { allowance: 2 });
  assert.ok(mill.moves > 100, 'genera un percorso di fresatura');
  assert.ok(/G1/.test(mill.gcode), 'contiene movimenti di lavoro');
});

test('dxfmill: DXF senza contorni chiusi → errore chiaro', () => {
  const open = '0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n0\n20\n0\n11\n50\n21\n0\n0\nENDSEC\n0\nEOF\n';
  const model = parseDXF(open, 'open.dxf');
  assert.throws(() => dxfToPartMesh(model), /contorno chiuso/);
});
