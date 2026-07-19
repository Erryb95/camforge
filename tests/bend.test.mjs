// Verifica la matematica di PIEGATURA (src/core/bend.js) contro i RIFERIMENTI
// SCARICATI reali (non prodotti da me):
//  - LAMIERA: numeri golden di FreeCAD SheetMetal `calc-unfold.py` (eseguito:
//    r=1.64,T=2,K=0.38,ML=50,90° → BA=3.77, flangia 51.76, leg 48.12, OSSB 3.64).
//  - TUBO: geometria del port di `convertX2L.py` (LRA↔XYZ) + round-trip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bendAllowance, unfoldSingleBend, lra2xyz, xyz2lra, tubeDevelopedLength } from '../src/core/bend.js';
import { parseLRA } from '../src/loaders/lra/index.js';
import { foldCenterline } from '../src/sim/tubebend.js';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `atteso ${b}, ottenuto ${a} (tol ${tol})`);

test('LAMIERA: sviluppo = golden FreeCAD calc-unfold.py (r1.64 T2 K0.38 ML50 90°)', () => {
  const u = unfoldSingleBend({ r: 1.64, T: 2.0, K: 0.38, ML: 50, angleDeg: 90 });
  near(u.BA, 3.77);            // Bend allowance
  near(u.outerRadius, 3.64);  // Effective outer radius (r+T)
  near(u.ossb, 3.64);
  near(u.legLength, 48.12);   // Leg length
  near(u.flangeLength, 51.76);// Flange length
  near(u.flangeDiff, 1.76);   // Flange diff
});

test('LAMIERA: bend allowance = (angolo/360)·2π·(r+K·T)', () => {
  near(bendAllowance(90, 1.64, 2.0, 0.38), 3.77);
  near(bendAllowance(180, 5, 2, 0.44), Math.PI * (5 + 0.88));  // 180° = mezza circonferenza asse neutro
});

const angBetween = (a, b, c) => {
  const v1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v2 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
  const n1 = Math.hypot(...v1), n2 = Math.hypot(...v2);
  return Math.acos(Math.max(-1, Math.min(1, dot / (n1 * n2)))) * 180 / Math.PI;
};

test('TUBO: LRA → XYZ ricostruisce una piega a 90° corretta', () => {
  // programma: dritto 100, piega 90°, dritto 100 (clr=0 → niente correzione tangente)
  const xyz = lra2xyz([[100, 0, 0], [100, 0, 90], [100, 0, 0]], 0);
  assert.equal(xyz.length, 4);
  near(xyz[3][0], 200); near(xyz[3][1], 0); near(xyz[3][2], -100);   // gira in -Z
  near(angBetween(xyz[1], xyz[2], xyz[3]), 90);                       // angolo di piega 90°
});

test('TUBO: XYZ → LRA misura correttamente gli angoli di piega', () => {
  // centerline con due pieghe nette da 90°: +X, +X, poi -Z, poi -X
  const xyz = [[0, 0, 0], [100, 0, 0], [200, 0, 0], [200, 0, -100], [100, 0, -100]];
  const lra = xyz2lra(xyz, 0);
  const angles = lra.map((e) => Math.round(e[2]));
  assert.equal(angles.filter((a) => a === 90).length, 2, `attese due pieghe 90°: ${angles}`);
});

test('TUBO: sviluppo di una barra dritta = somma dei tratti', () => {
  near(tubeDevelopedLength([[100, 0, 0], [50, 0, 0]], 30), 150);
});

test('LOADER piegatubo: centerline XYZ REALE (tayfurcnr/LRA example_xyz) → 4 pieghe + mesh', () => {
  const f = join(dirname(fileURLToPath(import.meta.url)), '..', 'samples', 'bend', 'pipe_example.xyz');
  if (!existsSync(f)) return;                                   // dato di test scaricato
  const m = parseLRA(readFileSync(f, 'utf8'), 'pipe_example.xyz');
  assert.equal(m.meta.bend.format, 'XYZ');                      // rilevato come centerline
  assert.equal(m.meta.bend.nBends, 4, `pieghe: ${m.meta.bend.nBends}`);
  assert.ok(m.meta.foldAvailable && m.mesh.indices.length > 0, 'mesh non generata');
  assert.ok(Math.abs(m.meta.bend.dev - 3138) < 60, `sviluppo atteso ~3138, ottenuto ${m.meta.bend.dev.toFixed(0)}`);
});

test('FOLD: t=0 raddrizza (collineare), t=1 riproduce la centerline', () => {
  const pts = [[0, 0, 0], [100, 0, 0], [100, 100, 0], [200, 100, 0]];   // due pieghe a 90°
  const straight = foldCenterline(pts, 0);
  // tutti i punti sull'asse X (nessuna piega)
  for (const p of straight) assert.ok(Math.abs(p[1]) < 1e-6 && Math.abs(p[2]) < 1e-6, `non dritto: ${p}`);
  const full = foldCenterline(pts, 1);
  for (let i = 0; i < pts.length; i++) for (let k = 0; k < 3; k++) assert.ok(Math.abs(full[i][k] - pts[i][k]) < 1e-6, 't=1 deve riprodurre l\'originale');
});
