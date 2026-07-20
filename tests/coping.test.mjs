// COPING / fish-mouth tubo-tubo: il profilo di intaglio SVILUPPATO è verificato
// contro la FORMA CHIUSA analitica dell'intersezione di cilindri (ground truth) —
// nessun taglio reale necessario per validare la geometria. Più: il coping produce
// G-code QtPlasmaC-nativo e un modello 3D avvolto (per la simulazione).
import test from 'node:test';
import assert from 'node:assert/strict';
import { copeProfile, copeToRotary } from '../src/generator/coping.js';
import { assertNativeContract } from '../scripts/gen-machine-test.mjs';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `atteso ${b}, ottenuto ${a} (tol ${tol})`);

test('copeProfile 90°: coincide con √(R²−r²·sin²φ) su TUTTO il giro', () => {
  const R = 30, r = 20;
  const p = copeProfile({ branchDiameter: 2 * r, mainDiameter: 2 * R, angleDeg: 90, points: 360 });
  for (const pt of p.pts) {
    const phi = pt.v / r;                                   // v = r·φ
    near(pt.u, Math.sqrt(R * R - r * r * Math.sin(phi) ** 2), 1e-9);
  }
  near(p.pts[0].u, R, 1e-9);                                // corno φ=0 → u=R
  near(p.notchDepth, R - Math.sqrt(R * R - r * r), 1e-9);   // profondità intaglio
});

test('copeProfile diametri uguali (Steinmetz): u = R·|cosφ|', () => {
  const R = 25;
  const p = copeProfile({ branchDiameter: 2 * R, mainDiameter: 2 * R, angleDeg: 90, points: 360 });
  for (const pt of p.pts) {
    const phi = pt.v / R;
    near(pt.u, R * Math.abs(Math.cos(phi)), 1e-9);
  }
  near(p.notchDepth, R, 1e-9);                              // da 0 (valle) a R (corno)
  assert.ok(!p.warning);
});

test('copeProfile obliquo: periodico, si riduce al 90°, intaglio più profondo', () => {
  const R = 30, r = 18;
  const p90 = copeProfile({ branchDiameter: 2 * r, mainDiameter: 2 * R, angleDeg: 90, points: 180 });
  near(p90.notchDepth, R - Math.sqrt(R * R - r * r), 1e-9);
  near(p90.pts[0].u, p90.pts.at(-1).u, 1e-9);              // periodico
  const p60 = copeProfile({ branchDiameter: 2 * r, mainDiameter: 2 * R, angleDeg: 60, points: 180 });
  assert.ok(p60.pts.every((pt) => Number.isFinite(pt.u)));
  near(p60.pts[0].u, p60.pts.at(-1).u, 1e-6);              // periodico anche obliquo
  assert.ok(p60.notchDepth > p90.notchDepth, `obliquo più profondo: 60°=${p60.notchDepth.toFixed(2)} > 90°=${p90.notchDepth.toFixed(2)}`);
  // obliquo asimmetrico avanti/indietro (corna a u diversi): B≠0
  assert.ok(Math.abs(p60.pts[0].u - p60.pts[90].u) > 1, 'profilo obliquo asimmetrico');
});

test('copeProfile: branch > main → warning, nessun NaN', () => {
  const p = copeProfile({ branchDiameter: 80, mainDiameter: 40, angleDeg: 90, points: 120 });
  assert.ok(p.warning, 'atteso warning per branch troppo grande');
  assert.ok(p.pts.every((pt) => Number.isFinite(pt.u)));
});

test('copeToRotary: G-code QtPlasmaC-nativo + wrap A 0→360 + modello sim', () => {
  const { gcode, model, info } = copeToRotary({ branchDiameter: 50, mainDiameter: 60, angleDeg: 90, thickness: 2 });
  const { ok, checks } = assertNativeContract(gcode);
  assert.ok(ok, 'contratto nativo: ' + JSON.stringify(checks));
  const As = [...gcode.matchAll(/A(-?[\d.]+)/g)].map((m) => +m[1]);
  assert.ok(Math.max(...As) - Math.min(...As) > 350, 'il coping avvolge un giro intero (~360°)');
  assert.ok(model.segments.length > 50 && model.mesh.indices.length > 0, 'modello 3D avvolto per la sim');
  assert.ok(info.includes('coping'));
});
