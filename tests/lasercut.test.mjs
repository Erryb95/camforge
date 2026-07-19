// Motore TAGLIO LASER LAMIERA: offset path aperto (kerf), boolean con separazione
// pezzi, estrusione earcut, estrazione contorni chiusi, separatingDist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { offsetOpen, cutRegions, pathArea } from '../src/loaders/cad/offset.js';
import { extrudeRegion } from '../src/sim/triangulate.js';
import { extractContours, LaserSheetSim } from '../src/sim/lasercut.js';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `atteso ${b}, ottenuto ${a} (tol ${tol})`);
const seg = (pts, type = 'feed') => {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return { type, from: pts[0], to: pts[pts.length - 1], pts, len, line: 1, tool: 0, feed: 1000 };
};
const P = (x, y) => ({ x, y, z: 0 });

test('offsetOpen: linea → banda kerf, area ≈ lunghezza × kerf', async () => {
  const sw = await offsetOpen([[[0, 0], [100, 0]]], 0.2, { cap: 'butt' });
  assert.equal(sw.length, 1);
  near(await pathArea(sw[0]), 40, 0.5);        // 100 × 0.4
});

test('cutRegions: blank − anello foro → 2 regioni (lamiera forata + slug)', async () => {
  const circle = [];
  for (let i = 0; i < 48; i++) { const t = 2 * Math.PI * i / 48; circle.push([50 + 10 * Math.cos(t), 30 + 10 * Math.sin(t)]); }
  circle.push(circle[0]);
  const swath = await offsetOpen([circle], 0.2);
  const regions = await cutRegions([[[0, 0], [100, 0], [100, 60], [0, 60]]], swath);
  assert.equal(regions.length, 2);            // lamiera con foro + dischetto separato
  const withHole = regions.find((r) => r.holes.length > 0);
  assert.ok(withHole, 'una regione deve avere un foro');
});

test('extrudeRegion: quadro con foro → mesh valida entro z0..z1', () => {
  const outer = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const hole = [[3, 3], [7, 3], [7, 7], [3, 7]];
  const m = extrudeRegion(outer, [hole], 0, 2);
  assert.ok(m.indices.length > 0);
  assert.ok(m.positions.every((v) => Number.isFinite(v)));
  for (let i = 2; i < m.positions.length; i += 3) assert.ok(m.positions[i] >= -1e-9 && m.positions[i] <= 2 + 1e-9);
});

test('extractContours: contorno chiuso con lead-in riconosciuto chiuso', () => {
  const model = { segments: [
    seg([P(-2, 0), P(0, 0)], 'rapid'),
    seg([P(-2, 0), P(0, 0)]),                                   // lead-in dall'esterno
    seg([P(0, 0), P(10, 0), P(10, 10), P(0, 10), P(0, 0)]),     // quadro chiuso
  ] };
  const { contours } = extractContours(model);
  assert.equal(contours.length, 1);
  assert.equal(contours[0].closed, true);                       // chiuso nonostante il lead-in
});

// --- e2e sulla piastra generata (5 fori + asola + perimetro) ---
const PLATE = fileURLToPath(new URL('../samples/generated/plate-demo-grbl.nc', import.meta.url));
const ready = existsSync(PLATE);

test('LaserSheetSim: piastra → contorni chiusi, pezzi separabili, pezzo si stacca per ultimo', { skip: !ready }, async () => {
  const { parseNC } = await import('../src/loaders/nc/parser.js');
  const model = parseNC(await readFile(PLATE, 'utf8'), 'plate.nc');
  const sim = new LaserSheetSim(model, { thickness: 4 });
  await sim.precompute();
  assert.equal(sim.contours.filter((c) => c.closed).length, 7);          // 5 fori + asola + perimetro
  const nonFrame = sim.regions.filter((r) => !r.isFrame);
  assert.equal(nonFrame.length, 7);                                      // 6 slug + il pezzo
  assert.equal(sim.regions.filter((r) => r.isFrame).length, 1);          // il telaio di sfrido
  // il PEZZO (area maggiore) si stacca per ULTIMO (sep massimo tra i finiti)
  const maxSep = Math.max(...nonFrame.map((r) => r.sep));
  near(maxSep, sim.total, sim.total * 0.02);
  // a inizio: tutto materiale (tool 1); a fine: compaiono pezzi staccati (tool 2) sotto z=0
  const m0 = sim.meshAt(0);
  assert.ok(m0.triTool.every((t) => t === 1));
  const mEnd = sim.meshAt(sim.total * 0.7);
  assert.ok(mEnd.triTool.some((t) => t === 2), 'a 70% qualche slug è staccato');
  assert.ok(Array.from(mEnd.positions).some((_, i) => i % 3 === 2 && mEnd.positions[i] < -1), 'un pezzo è caduto sotto z=0');
});
