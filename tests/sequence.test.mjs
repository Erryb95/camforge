// Test dell'ordinamento sequenza di taglio (chaining + nearest-neighbor).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainSegments, sequenceSegments } from '../src/loaders/cad/sequence.js';

const seg = (x0, y0, x1, y1) => ({
  type: 'feed', from: { x: x0, y: y0, z: 0 }, to: { x: x1, y: y1, z: 0 },
  pts: [{ x: x0, y: y0, z: 0 }, { x: x1, y: y1, z: 0 }], line: 0, tool: 1, feed: null,
  len: Math.hypot(x1 - x0, y1 - y0),
});

const totalJump = (segs) => {
  let j = 0;
  for (let i = 1; i < segs.length; i++) {
    j += Math.hypot(segs[i].from.x - segs[i - 1].to.x, segs[i].from.y - segs[i - 1].to.y);
  }
  return j;
};

test('chaining: un quadrato chiuso diventa una sola catena', () => {
  const square = [seg(0, 0, 10, 0), seg(10, 0, 10, 10), seg(10, 10, 0, 10), seg(0, 10, 0, 0)];
  const chains = chainSegments(square);
  assert.equal(chains.length, 1);
  assert.equal(chains[0].segs.length, 4);
});

test('chaining: due contorni separati = due catene', () => {
  const a = [seg(0, 0, 5, 0), seg(5, 0, 5, 5), seg(5, 5, 0, 0)];
  const b = [seg(100, 0, 105, 0), seg(105, 0, 105, 5), seg(105, 5, 100, 0)];
  const chains = chainSegments([...a, ...b]);
  assert.equal(chains.length, 2);
});

test('sequenza: riduce drasticamente il salto rispetto all\'ordine casuale', () => {
  // 5 contorni (quadratini) distribuiti lungo X, forniti in ordine sparso
  const squares = [];
  const order = [3, 0, 4, 1, 2];   // sparso
  for (const k of order) {
    const x = k * 50;
    squares.push(seg(x, 0, x + 10, 0), seg(x + 10, 0, x + 10, 10),
      seg(x + 10, 10, x, 10), seg(x, 10, x, 0));
  }
  const jumpBefore = totalJump(squares);
  const ordered = sequenceSegments(squares);
  const jumpAfter = totalJump(ordered);
  assert.equal(ordered.length, squares.length, 'nessun segmento perso');
  assert.ok(jumpAfter < jumpBefore * 0.5, `atteso miglioramento: prima ${jumpBefore}, dopo ${jumpAfter}`);
});

test('sequenza: parte da un\'estremità (X minima)', () => {
  const squares = [];
  for (const k of [2, 0, 1]) {
    const x = k * 100;
    squares.push(seg(x, 0, x + 10, 0), seg(x + 10, 0, x + 10, 10),
      seg(x + 10, 10, x, 10), seg(x, 10, x, 0));
  }
  const ordered = sequenceSegments(squares);
  // il primo segmento deve toccare l'estremità X=0 (il contorno più a sinistra)
  const firstMinX = Math.min(ordered[0].from.x, ordered[0].to.x);
  assert.ok(firstMinX < 1e-6, `parte da x=${firstMinX}, atteso ~0`);
});

test('sequenza: lista corta invariata', () => {
  const s = [seg(0, 0, 1, 0), seg(1, 0, 2, 0)];
  assert.equal(sequenceSegments(s).length, 2);
});
