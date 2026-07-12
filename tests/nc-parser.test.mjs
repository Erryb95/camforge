// Golden test del parser NC — eseguire con:  node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNC } from '../src/loaders/nc/parser.js';

const near = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `atteso ${b}, ottenuto ${a} (tol ${tol})`);

test('movimento lineare assoluto', () => {
  const m = parseNC('G21 G90 G17\nG0 X0 Y0\nG1 X10 Y0 F100\n');
  assert.equal(m.segments.length, 1); // il G0 verso 0,0 da 0,0 non produce segmento
  const s = m.segments[0];
  assert.equal(s.type, 'feed');
  near(s.to.x, 10);
  near(s.to.y, 0);
  near(s.feed, 100);
});

test('moto modale: coordinate senza ripetere G1', () => {
  const m = parseNC('G90\nG1 X10 F50\nX20 Y5\nX30\n');
  assert.equal(m.segments.length, 3);
  near(m.segments[2].to.x, 30);
  near(m.segments[2].to.y, 5);
});

test('coordinate incrementali G91', () => {
  const m = parseNC('G91\nG1 X10 F50\nX10\nY5\n');
  const last = m.segments.at(-1);
  near(last.to.x, 20);
  near(last.to.y, 5);
});

test('arco G2 un quarto con I/J', () => {
  const m = parseNC('G90 G17\nG1 X0 Y0 F100\nG2 X10 Y10 I10 J0\n');
  const a = m.segments.at(-1);
  assert.equal(a.type, 'arc');
  assert.equal(a.cw, true);
  near(a.center.x, 10);
  near(a.center.y, 0);
  near(a.radius, 10);
  near(a.to.x, 10);
  near(a.to.y, 10);
  near(a.len, Math.PI / 2 * 10, 1e-3);
  // CW da (0,0) a (10,10) attorno a (10,0): angoli da 180° a 90°, il punto medio
  // sta nel quadrante in alto a sinistra e tutti i punti giacciono sul raggio
  const mid = a.pts[Math.floor(a.pts.length / 2)];
  assert.ok(mid.x < 4.5 && mid.y > 6.5, `punto medio inatteso ${JSON.stringify(mid)}`);
  for (const p of a.pts) near(Math.hypot(p.x - 10, p.y - 0), 10, 1e-6);
});

test('cerchio completo (punto finale = iniziale)', () => {
  const m = parseNC('G90 G17\nG1 X45 Y40 F100\nG2 X45 Y40 I15 J0\n');
  const a = m.segments.at(-1);
  assert.equal(a.type, 'arc');
  near(a.radius, 15);
  near(a.len, 2 * Math.PI * 15, 1e-2);
});

test('arco con R positivo = arco minore', () => {
  const m = parseNC('G90 G17\nG1 X0 Y0 F100\nG2 X20 Y0 R10\n');
  const a = m.segments.at(-1);
  assert.equal(a.type, 'arc');
  near(a.center.x, 10, 1e-6);
  near(a.center.y, 0, 1e-6);
  near(a.len, Math.PI * 10, 1e-3); // semicerchio esatto
  // G2 (orario) da (0,0) a (20,0) con centro (10,0) passa dal punto alto (10,10)
  const mid = a.pts[Math.floor(a.pts.length / 2)];
  near(mid.y, 10, 0.1);
});

test('unità in pollici G20 convertite in mm', () => {
  const m = parseNC('G20 G90\nG0 X1 Y0\nG1 X2 F10\n');
  near(m.segments.at(-1).to.x, 50.8);
  assert.equal(m.units, 'in');
  near(m.segments.at(-1).feed, 254);
});

test('arco nel piano G18 (ZX) con I/K', () => {
  const m = parseNC('G90 G18\nG1 X0 Z0 F100\nG2 Z10 K5\n');
  const a = m.segments.at(-1);
  assert.equal(a.type, 'arc');
  assert.equal(a.plane, 'ZX');
  near(a.center.z, 5);
  near(a.radius, 5);
  near(a.to.z, 10);
  // semicirconferenza: il punto medio esce dal piano z, |x| = 5
  const mid = a.pts[Math.floor(a.pts.length / 2)];
  near(Math.abs(mid.x), 5, 0.1);
});

test('ciclo di foratura G81 con più posizioni', () => {
  const m = parseNC('G90\nG0 X0 Y0 Z15\nG81 X10 Y10 Z-5 R2 F100\nX20\nG80\nG0 Z25\n');
  assert.equal(m.drillPoints.length, 2);
  near(m.drillPoints[0].at.x, 10);
  near(m.drillPoints[0].at.y, 10);
  near(m.drillPoints[0].at.z, -5);
  near(m.drillPoints[1].at.x, 20);
  near(m.drillPoints[1].at.y, 10);
  // tra i fori c'è un rapido di posizionamento alla quota R
  const rapids = m.segments.filter((s) => s.type === 'rapid');
  assert.ok(rapids.some((s) => Math.abs(s.to.z - 2) < 1e-9));
});

test('elica: arco XY con Z variabile', () => {
  const m = parseNC('G90 G17\nG1 X0 Y0 Z0 F100\nG2 X10 Y10 I10 J0 Z-5\n');
  const a = m.segments.at(-1);
  near(a.to.z, -5);
  near(a.pts.at(-1).z, -5);
  assert.ok(a.len > Math.PI / 2 * 10); // più lungo dell'arco piano
});

test('utensili tracciati con T e M6', () => {
  const m = parseNC('T3 M6\nG90 G1 X10 F100\nT7 M6\nG1 X20\n');
  assert.deepEqual(m.stats.tools, [3, 7]);
  assert.equal(m.segments[0].tool, 3);
  assert.equal(m.segments[1].tool, 7);
});

test('commenti, %, O e N non disturbano', () => {
  const m = parseNC('%\nO1234 (PROGRAMMA TEST)\nN10 G90 (assoluto)\nN20 G1 X5 F100 ; commento\n%\n');
  assert.equal(m.program, 'O1234');
  assert.equal(m.segments.length, 1);
  assert.equal(m.warnings.length, 0);
});

test('avvisi: macro, coordinate senza moto, G sconosciuto', () => {
  const m = parseNC('#100=5\nX10 Y10\nG76 X5\nG90 G1 X1 F10\n');
  assert.ok(m.warnings.some((w) => w.msg.includes('macro')));
  assert.ok(m.warnings.some((w) => w.msg.includes('senza modo di moto')));
  assert.ok(m.warnings.some((w) => w.msg.includes('G76')));
  assert.equal(m.segments.length, 1); // solo il G1 valido
});

test('dopo M30 non si traccia più nulla', () => {
  const m = parseNC('G90 G1 X10 F100\nM30\nG1 X99\n');
  assert.equal(m.segments.length, 1);
});

test('statistiche: lunghezze e bounds', () => {
  const m = parseNC('G90\nG0 X0 Y0\nG1 X30 F300\nG1 Y40\nG0 X0 Y0\n');
  near(m.stats.feedLen, 70);
  near(m.stats.rapidLen, 50);
  near(m.bounds.max.x, 30);
  near(m.bounds.max.y, 40);
  near(m.stats.timeMin, 70 / 300, 1e-9);
});

test('file demo completo senza avvisi', async () => {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL('../samples/demo.nc', import.meta.url), 'utf8');
  const m = parseNC(text, 'demo.nc');
  assert.equal(m.warnings.length, 0, JSON.stringify(m.warnings));
  assert.deepEqual(m.stats.tools, [1, 2]);
  assert.equal(m.drillPoints.length, 6);
  assert.ok(m.segments.length > 15);
  // contorno: la piastra è 120x80 e i bounds lavorati la contengono
  assert.ok(m.boundsFeed.max.x >= 120 - 1e-6);
  assert.ok(m.boundsFeed.max.y >= 80 - 1e-6);
});
