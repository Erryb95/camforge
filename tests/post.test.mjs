// Toolpath (ordinamento/lead-in) + post-processor G-code (grbl/linuxcnc)
// + e2e STEP→NC sulla piastra demo (skip se wasm/step assenti).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { orderContours, makeToolpath, pointInPoly, containmentDepth } from '../src/generator/toolpath.js';
import { postGcode, pierceSeconds, DIALECTS } from '../src/generator/post/gcode.js';
import { parseNC } from '../src/loaders/nc/parser.js';

const rect = (x0, y0, x1, y1) => ({
  pts: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }],
  closed: true,
});
const circle = (cx, cy, r, n = 24) => ({
  pts: Array.from({ length: n + 1 }, (_, i) => ({
    x: cx + r * Math.cos((2 * Math.PI * i) / n),
    y: cy + r * Math.sin((2 * Math.PI * i) / n),
  })),
  closed: true,
});

test('pointInPoly + containmentDepth: fori dentro piastra', () => {
  const outer = rect(0, 0, 100, 60);
  const hole = circle(50, 30, 10);
  assert.ok(pointInPoly({ x: 50, y: 30 }, outer.pts));
  assert.ok(!pointInPoly({ x: 200, y: 30 }, outer.pts));
  const d = containmentDepth([outer, hole]);
  assert.equal(d[0], 0);
  assert.equal(d[1], 1);
});

test('orderContours: interni prima, perimetro ultimo, nearest-neighbor', () => {
  const contours = [rect(0, 0, 100, 60), circle(20, 30, 5), circle(80, 30, 5)];
  const { ordered, depths } = orderContours(contours, { x: 0, y: 30 });
  assert.equal(depths[depths.length - 1], 0);       // perimetro per ultimo
  assert.ok(depths.slice(0, -1).every((d) => d === 1));
  // dal punto (0,30) il foro più vicino è quello a x=20
  const first = ordered[0].pts[0];
  assert.ok(Math.abs(first.x - 20) < 6, `primo contorno vicino a x=20, era ${first.x}`);
});

test('makeToolpath: lead-in dentro il foro, fuori dal perimetro', () => {
  const tp = makeToolpath([rect(0, 0, 100, 60), circle(50, 30, 10)], { leadIn: 2 });
  const hole = tp.find((o) => o.depth === 1);
  const per = tp.find((o) => o.depth === 0);
  // il lead del foro parte DENTRO il cerchio (distanza dal centro < r)
  const hl = hole.lead[0];
  assert.ok(Math.hypot(hl.x - 50, hl.y - 30) < 10, 'lead foro nel materiale di sfrido interno');
  // il lead del perimetro parte FUORI dal rettangolo
  const pl = per.lead[0];
  assert.ok(!pointInPoly(pl, per.pts), 'lead perimetro fuori dal pezzo');
  // continuità: il lead termina esattamente sul primo punto del contorno
  assert.deepEqual(hole.lead[1], { x: hole.pts[0].x, y: hole.pts[0].y });
});

test('postGcode grbl: struttura M3/M5, pierce, parsabile senza avvisi', () => {
  const tp = makeToolpath([rect(0, 0, 100, 60), circle(50, 30, 10)], { leadIn: 2 });
  const nc = postGcode(tp, { dialect: 'grbl', feed: 3000, power: 800, thickness: 4, name: 'test' });
  assert.ok(nc.includes('G21'));
  assert.ok(nc.includes('G90'));
  const m3 = (nc.match(/^M3 S800$/gm) || []).length;
  const m5 = (nc.match(/^M5$/gm) || []).length;
  assert.equal(m3, 2);                    // un'accensione per contorno
  assert.ok(m5 >= 2);                     // spegnimento per contorno + postamble
  assert.ok(nc.includes('G4 P0.5'));      // pierce delay minimo 500 ms
  const m = parseNC(nc, 'gen.nc');
  assert.equal((m.warnings || []).length, 0);
  assert.ok(m.segments.length > 20);
});

test('postGcode linuxcnc: commenti RS-274 senza parentesi annidate', () => {
  const tp = makeToolpath([circle(10, 10, 3)], { leadIn: 1 });
  const nc = postGcode(tp, { dialect: 'linuxcnc', name: 'a(b)c' });
  for (const line of nc.split('\n')) {
    if (!line.startsWith('(')) continue;
    assert.ok(!line.slice(1, -1).includes('('), `parentesi annidata: ${line}`);
  }
  const m = parseNC(nc, 'gen.nc');
  // ammesso il solo avviso informativo G54
  assert.ok((m.warnings || []).every((w) => w.msg.includes('G54')), JSON.stringify(m.warnings));
});

test('pierceSeconds: euristica plasma FreeCAD (70 ms/mm, min 0.5 s)', () => {
  assert.equal(pierceSeconds(1), 0.5);
  assert.equal(pierceSeconds(10), 0.7);
  assert.equal(pierceSeconds(4, 1200), 1.2);
  assert.ok(DIALECTS.grbl && DIALECTS.linuxcnc);
});

// --- e2e: piastra demo STEP → NC (skip senza wasm) ---
const WASM = fileURLToPath(new URL('../vendor/occt-full/opencascade.wasm.wasm', import.meta.url));
const PLATE = fileURLToPath(new URL('../samples/cad/plate-demo.step', import.meta.url));
const ready = existsSync(WASM) && existsSync(PLATE);

test('e2e piastra: STEP → contorni → toolpath → grbl NC coerente', { skip: !ready, timeout: 240000 }, async () => {
  const { getOcctFull, readStepShape } = await import('../src/loaders/step/occt.js');
  const { planarFaces, wiresOfFace } = await import('../src/loaders/step/wires.js');
  const oc = await getOcctFull();
  const shape = readStepShape(oc, await readFile(PLATE, 'utf8'));
  const top = planarFaces(oc, shape).filter((f) => Math.abs(f.n.z) > 0.99).sort((a, b) => b.z - a.z)[0];
  const loops = wiresOfFace(oc, top.face);
  assert.equal(loops.length, 7);                                  // perimetro + 5 fori + asola
  assert.equal(loops.filter((l) => l.outer).length, 1);
  const contours = loops.map((l) => ({ pts: l.pts.map((p) => ({ x: p.x, y: p.y })), closed: true }));
  const nc = postGcode(makeToolpath(contours, { leadIn: 2 }), { dialect: 'grbl', thickness: 4 });
  const m = parseNC(nc, 'plate.nc');
  assert.equal((m.warnings || []).length, 0);
  // ingombro ≈ piastra 120×80 (+ lead-in esterno ~2 mm)
  assert.ok(Math.abs(m.bounds.min.x - 0) < 3 && Math.abs(m.bounds.max.x - 120) < 3);
  assert.ok(Math.abs(m.bounds.min.y - 0) < 3 && Math.abs(m.bounds.max.y - 80) < 3);
});
