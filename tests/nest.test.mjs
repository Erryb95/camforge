// NESTING lamiera (parità SheetCam: array/griglia a bounding-box). Verifica il
// packing (posizioni, niente sovrapposizioni, capacità del foglio) e l'integrazione
// col taglio lamiera (N copie → N pezzi tagliati sul foglio).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nestGrid, boundingBox, translateContours, rotateContours } from '../src/generator/nest.js';
import { sheetCutFromModel } from '../src/generator/sheetCut.js';
import { parseDXF } from '../src/loaders/dxf/parser.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `atteso ${b}, ottenuto ${a}`);
const square = (s, ox = 0, oy = 0) => [{ pts: [
  { u: ox, v: oy }, { u: ox + s, v: oy }, { u: ox + s, v: oy + s }, { u: ox, v: oy + s }, { u: ox, v: oy },
], tag: 'sq' }];

// bbox di UN placement (istanza)
const instBB = (placement) => boundingBox(placement);
const overlap = (a, b) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

test('boundingBox / translate / rotate: geometria base', () => {
  const p = square(100, 10, 20);
  const bb = boundingBox(p);
  near(bb.w, 100); near(bb.h, 100); near(bb.minX, 10); near(bb.minY, 20);
  const t = boundingBox(translateContours(p, 5, -5));
  near(t.minX, 15); near(t.minY, 15);
  // rotazione 90° attorno all'origine: (x,y)→(−y,x)
  const r = rotateContours([{ pts: [{ u: 2, v: 0 }] }], 90)[0].pts[0];
  near(r.u, 0); near(r.v, 2);
});

test('nestGrid: N copie in griglia, capacità corretta, niente sovrapposizioni', () => {
  const part = square(100);
  const n = nestGrid(part, { count: 4, sheetW: 250, sheetH: 250, gap: 10, margin: 5, allowRotate: false });
  assert.equal(n.cols, 2);          // floor((250-10+10)/(100+10)) = 2
  assert.equal(n.rows, 2);
  assert.equal(n.placed, 4);
  assert.equal(n.placements.length, 4);
  // niente sovrapposizioni tra i bounding box dei pezzi
  const bbs = n.placements.map(instBB);
  for (let i = 0; i < bbs.length; i++) for (let j = i + 1; j < bbs.length; j++) {
    assert.ok(!overlap(bbs[i], bbs[j]), `pezzi ${i},${j} si sovrappongono`);
  }
  // tutti dentro il foglio (con margine)
  for (const bb of bbs) {
    assert.ok(bb.minX >= 5 - 1e-6 && bb.maxX <= 250 - 5 + 1e-6);
    assert.ok(bb.minY >= 5 - 1e-6 && bb.maxY <= 250 - 5 + 1e-6);
  }
});

test('nestGrid: se il foglio non basta, piazza solo quelli che entrano', () => {
  const n = nestGrid(square(100), { count: 20, sheetW: 250, sheetH: 250, gap: 10, margin: 5, allowRotate: false });
  assert.equal(n.capacity, 4);
  assert.equal(n.placed, 4);        // 20 richiesti, 4 entrano
  assert.equal(n.requested, 20);
});

// integrazione: N copie del DXF → N pezzi tagliati
const DXF = fileURLToPath(new URL('../samples/dxf/piastra-4fori.dxf', import.meta.url));
const dxf = () => parseDXF(readFileSync(DXF, 'utf8'), 'piastra-4fori.dxf');

test('sheetCutFromModel: nesting di 4 copie → più tagli + info uso foglio', async () => {
  const one = await sheetCutFromModel(dxf(), { thickness: 4, dialect: 'qtplasmac', tabCount: 0, count: 1 });
  const four = await sheetCutFromModel(dxf(), { thickness: 4, dialect: 'qtplasmac', tabCount: 0, count: 4, sheetW: 2000, sheetH: 2000 });
  const on = (g) => (g.match(/^M03 \$0 S1$/gm) || []).length;
  // ogni pezzo = 1 perimetro + 4 fori = 5 accensioni; 4 copie → 4×
  assert.equal(on(four.gcode), on(one.gcode) * 4, '4 copie = 4× i tagli di 1 pezzo');
  assert.ok(four.info.includes('nesting') && four.info.includes('uso'), four.info);
});
