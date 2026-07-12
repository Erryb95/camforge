// Test integrazione Clipper (vendor/clipper) — offset kerf.
import test from 'node:test';
import assert from 'node:assert/strict';
import { offsetClosed, pathArea } from '../src/loaders/cad/offset.js';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `atteso ${b}, ottenuto ${a} (tol ${tol})`);

const square = (s) => [[0, 0], [s, 0], [s, s], [0, s]];

test('offset esterno (+): quadrato 40 → 42 (kerf/2 = 1)', async () => {
  const out = await offsetClosed([square(40)], 1, { join: 'miter' });
  assert.equal(out.length, 1);
  const area = Math.abs(await pathArea(out[0]));
  near(area, 42 * 42, 20);   // 1764 mm²
});

test('offset interno (−): quadrato 40 → 38', async () => {
  const out = await offsetClosed([square(40)], -1, { join: 'miter' });
  const area = Math.abs(await pathArea(out[0]));
  near(area, 38 * 38, 20);   // 1444 mm²
});

test('area con segno del quadrato 40', async () => {
  const a = await pathArea(square(40));
  near(Math.abs(a), 1600, 1e-6);
});

test('offset con giunti tondi arrotonda gli spigoli (area < miter)', async () => {
  const round = await offsetClosed([square(40)], 3, { join: 'round' });
  const miter = await offsetClosed([square(40)], 3, { join: 'miter' });
  const aRound = Math.abs(await pathArea(round[0]));
  const aMiter = Math.abs(await pathArea(miter[0]));
  assert.ok(aRound < aMiter, `round ${aRound} dovrebbe essere < miter ${aMiter}`);
});
