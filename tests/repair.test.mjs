// RIPARAZIONE contorni DXF: i disegni reali hanno micro-gap tra i segmenti e loop
// quasi-chiusi. weldSegments "salda" gli estremi entro tolleranza → i contorni si
// chiudono comunque (come l'auto-close di SheetCam), senza il quale non si tagliano.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closedRingsFromDxf, weldSegments } from '../src/generator/dxfmill.js';
import { contoursFromModel } from '../src/generator/tubeWrap.js';

const seg = (x1, y1, x2, y2) => ({ type: 'feed', from: { x: x1, y: y1, z: 0 }, to: { x: x2, y: y2, z: 0 } });
// quadrato 100×100 in 4 LINE, con l'ultimo estremo spostato di `gap` (loop non chiuso esatto)
const squareWithGap = (gap) => ({
  meta: { dialect: 'DXF' },
  segments: [
    seg(0, 0, 100, 0), seg(100, 0, 100, 100), seg(100, 100, 0, 100), seg(0, 100, gap, gap),
  ],
});

test('closedRingsFromDxf: un gap di 0.03 mm NON chiude senza riparazione', () => {
  const rings = closedRingsFromDxf(squareWithGap(0.03), { repairTol: 0 });
  assert.equal(rings.length, 0, 'senza riparazione il loop resta aperto');
});

test('closedRingsFromDxf: con la riparazione (default 0.05 mm) il contorno si chiude', () => {
  const rings = closedRingsFromDxf(squareWithGap(0.03));   // default repairTol 0.05
  assert.equal(rings.length, 1, 'gap saldato → 1 contorno chiuso');
  assert.ok(Math.abs(Math.abs(signedArea(rings[0])) - 10000) < 50, 'area ≈ 100×100');
});

test('weldSegments: conta gli estremi saldati e non muta oltre tolleranza', () => {
  const { welded } = weldSegments(squareWithGap(0.03).segments, 0.05);
  assert.ok(welded >= 1, 'almeno un estremo saldato (il gap)');
  // gap troppo grande per la tolleranza → non salda
  const far = weldSegments(squareWithGap(1.0).segments, 0.05);
  assert.equal(far.welded, 0, 'gap 1 mm > tol 0.05 → nessuna saldatura');
});

test('contoursFromModel: sfrutta la riparazione automatica (DXF sporco → contorno usabile)', () => {
  const cs = contoursFromModel(squareWithGap(0.03));
  assert.equal(cs.length, 1, 'il taglio lamiera riceve il contorno chiuso riparato');
  assert.ok(cs[0].pts.length >= 4);
});

function signedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}
