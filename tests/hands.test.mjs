// Verifica la MAPPATURA gesti→camera (senza webcam): landmark sintetici di una
// mano che si muove devono produrre orbita/zoom. Blocca regressioni tipo il bug
// "start() lancia e il loop non parte / nulla si muove".
import test from 'node:test';
import assert from 'node:assert/strict';
import { stepGesture, newGestureState, stepTwoHand, newTwoHandState } from '../src/hands/handtracking.js';

// Costruisce i 21 landmark: centroide palmo in (cx,cy), dimensione mano 0.15,
// distanza pollice-indice = pinch*0.15 (pinch<0.55 ⇒ modalità zoom).
function makeHand(cx, cy, pinch) {
  const lm = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
  lm[0] = { x: cx, y: cy + 0.075 };   // polso
  lm[9] = { x: cx, y: cy - 0.075 };   // nocca medio  → d(0,9)=0.15
  const p = pinch * 0.15;
  lm[4] = { x: cx + p / 2, y: cy };   // pollice
  lm[8] = { x: cx - p / 2, y: cy };   // indice     → d(4,8)=pinch*0.15
  return lm;
}

test('ORBITA: mano aperta che si muove in orizzontale → orbitBy con dyaw non banale', () => {
  const S = newGestureState();
  stepGesture(makeHand(0.5, 0.5, 1.3), S);              // 1° frame = reset (nessuna azione)
  const a = stepGesture(makeHand(0.4, 0.5, 1.3), S);    // mano spostata
  assert.equal(a.mode, 'orbit');
  assert.ok(a.orbit, 'attesa un\'azione di orbita');
  assert.ok(Math.abs(a.orbit[0]) > 0.05, `dyaw troppo piccolo: ${a.orbit[0]}`);
});

test('ZOOM: pinch + movimento verticale verso l\'alto → zoomBy > 1 (avvicina)', () => {
  const S = newGestureState();
  stepGesture(makeHand(0.5, 0.5, 0.2), S);              // reset, modalità zoom
  const a = stepGesture(makeHand(0.5, 0.4, 0.2), S);    // mano su (y diminuisce)
  assert.equal(a.mode, 'zoom');
  assert.ok(a.zoom, 'atteso un fattore di zoom');
  assert.ok(a.zoom > 1, `su deve avvicinare (zoom>1): ${a.zoom}`);
});

test('DEADZONE: mano ferma → nessuna azione', () => {
  const S = newGestureState();
  stepGesture(makeHand(0.5, 0.5, 1.3), S);
  const a = stepGesture(makeHand(0.5, 0.5, 1.3), S);
  assert.ok(!a.orbit && !a.zoom, 'ferma non deve muovere nulla');
});

test('CAMBIO MODO: passare a pinch azzera il delta (nessun salto)', () => {
  const S = newGestureState();
  stepGesture(makeHand(0.5, 0.5, 1.3), S);
  stepGesture(makeHand(0.4, 0.5, 1.3), S);              // orbita in corso
  const a = stepGesture(makeHand(0.3, 0.5, 0.2), S);    // ora pinch → reset
  assert.equal(a.mode, 'zoom');
  assert.ok(!a.orbit && !a.zoom, 'al cambio modo non deve applicare azioni');
});

test('2 MANI — allargare le mani → zoomBy > 1 (avvicina)', () => {
  const S = newTwoHandState();
  stepTwoHand(makeHand(0.4, 0.5, 1), makeHand(0.6, 0.5, 1), S);        // reset (dist 0.2)
  const a = stepTwoHand(makeHand(0.3, 0.5, 1), makeHand(0.7, 0.5, 1), S); // allargate (dist 0.4)
  assert.ok(a.zoom && a.zoom > 1, `allargare deve zoomare in: ${a && a.zoom}`);
});

test('2 MANI — muovere entrambe le mani → orbitBy non banale, niente zoom', () => {
  const S = newTwoHandState();
  stepTwoHand(makeHand(0.4, 0.5, 1), makeHand(0.6, 0.5, 1), S);        // reset (mid 0.5, dist 0.2)
  const a = stepTwoHand(makeHand(0.5, 0.5, 1), makeHand(0.7, 0.5, 1), S); // spostate a dx (dist invariata)
  assert.ok(a.orbit && Math.abs(a.orbit[0]) > 0.05, `atteso orbita: ${a && a.orbit}`);
  assert.ok(!a.zoom, 'distanza invariata → niente zoom');
});
