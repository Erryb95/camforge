// DXF OCS / extrusion (group code 210/220/230) → WCS via Arbitrary Axis Algorithm.
// Bug (ora corretto): le parti SPECCHIATE (extrusion (0,0,-1)) o disegnate in un UCS
// importavano storte IN SILENZIO — un taglio all'apparenza valido ma sbagliato. Il caso
// più comune e pericoloso è l'estrusione (0,0,-1) di AutoCAD che specchia la X.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDXF } from '../src/loaders/dxf/parser.js';

const circleDXF = (cx, cy, extZ) => {
  const ext = extZ !== undefined ? `210\n0.0\n220\n0.0\n230\n${extZ}\n` : '';
  return `0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n8\n0\n10\n${cx}\n20\n${cy}\n40\n2.0\n${ext}0\nENDSEC\n0\nEOF\n`;
};
// polilinea chiusa quadrata (0..w) con extrusion opzionale
const squareLW = (w, extZ) => {
  const ext = extZ !== undefined ? `210\n0.0\n220\n0.0\n230\n${extZ}\n` : '';
  return `0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n8\n0\n90\n4\n70\n1\n` +
    `10\n0\n20\n0\n10\n${w}\n20\n0\n10\n${w}\n20\n${w}\n10\n0\n20\n${w}\n${ext}0\nENDSEC\n0\nEOF\n`;
};
const cx = (m) => (m.bounds.min.x + m.bounds.max.x) / 2;
const cy = (m) => (m.bounds.min.y + m.bounds.max.y) / 2;

test('DXF OCS: cerchio con extrusion (0,0,-1) è specchiato su X in WCS', () => {
  const normal = parseDXF(circleDXF(10, 5), 'n.dxf');
  const mirrored = parseDXF(circleDXF(10, 5, '-1.0'), 'm.dxf');
  assert.ok(Math.abs(cx(normal) - 10) < 1e-6, `normale x=10, ottenuto ${cx(normal)}`);
  assert.ok(Math.abs(cy(normal) - 5) < 1e-6);
  // (0,0,-1): X specchiata → centro a -10; Y invariata
  assert.ok(Math.abs(cx(mirrored) - (-10)) < 1e-6, `specchiato x=-10, ottenuto ${cx(mirrored)}`);
  assert.ok(Math.abs(cy(mirrored) - 5) < 1e-6, `Y invariata =5, ottenuto ${cy(mirrored)}`);
});

test('DXF OCS: extrusion di default (0,0,1) NON altera le coordinate', () => {
  const senza = parseDXF(circleDXF(7, 3), 'a.dxf');
  const con = parseDXF(circleDXF(7, 3, '1.0'), 'b.dxf');
  assert.ok(Math.abs(cx(senza) - 7) < 1e-6 && Math.abs(cx(con) - 7) < 1e-6, 'entrambi x=7');
  assert.ok(Math.abs(cy(senza) - 3) < 1e-6 && Math.abs(cy(con) - 3) < 1e-6, 'entrambi y=3');
});

test('DXF OCS: LWPOLYLINE specchiata (contorno) — X ribaltata, larghezza preservata', () => {
  const normal = parseDXF(squareLW(20), 'sq.dxf');            // 0..20 → centro x=10
  const mirrored = parseDXF(squareLW(20, '-1.0'), 'sqm.dxf'); // specchiata → centro x=-10
  const w = (m) => m.bounds.max.x - m.bounds.min.x;
  assert.ok(Math.abs(cx(normal) - 10) < 1e-6, `normale centro x=10, ottenuto ${cx(normal)}`);
  assert.ok(Math.abs(cx(mirrored) - (-10)) < 1e-6, `specchiata centro x=-10, ottenuto ${cx(mirrored)}`);
  assert.ok(Math.abs(w(normal) - w(mirrored)) < 1e-6, 'la larghezza (20) è preservata dallo specchio');
});
