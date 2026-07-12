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

test('dialetto tubo: KG10 rapido, parametri macchina, assi ausiliari', () => {
  const m = parseNC([
    'VE<1.1>',
    'LT<5597.00>',
    'DM<75.19>',
    'WW<73.0> WH<25.0>',
    'M28 ZT<4>',
    '--GOTOLN TR+100',
    '--LN 101',
    '(A_T_Master_J3_B2)',
    'KG10 X-61.1982 Y0.0002 Z47.5931 X_1=307.4498 P360.0',
    'M20 ZX-61.1984 ZY0.0002 ZZ12.5094 EP0',
    'M21 FS1',
    'G1 X-60.0049 Y0.0 Z12.5001 X_1=307.45 P360.0',
    '!GOP<WL>!',
    'G1 X-60.0195 Y0.8537',
  ].join('\n'));
  assert.equal(m.warnings.length, 0, JSON.stringify(m.warnings));
  // KG10 = rapido, poi 2 feed; la riga M20 con ZX/ZY/ZZ NON genera segmenti
  assert.equal(m.segments.length, 3);
  assert.equal(m.segments[0].type, 'rapid');
  assert.equal(m.segments[1].type, 'feed');
  near(m.segments[1].to.x, -60.0049);
  near(m.meta.tubeLength, 5597);
  near(m.meta.tubeDiameter, 75.19);
  near(m.meta.tubeWidth, 73);
});

test('loader AlmaCAM: polilinee 3D e metadati tubo', async () => {
  const { parseAlma } = await import('../src/loaders/alma/parser.js');
  const xml = '<LXDDocument FileVer="1"><DocHeader>' +
    '<ExtMin X="-57.15" Y="-57.15" Z="0"/><ExtMax X="57.15" Y="57.15" Z="5500"/></DocHeader>' +
    '<Segments TubeLength="5500" TubeName="TUBE__2">' +
    '<CrossSection><SectionData><Circle Radius="57.15"/></SectionData></CrossSection>' +
    '<GeoCurve IsCutOff="true"><Geometry><CompositeCurve3D><Polyline3D PointCount="3">' +
    '<Point3D X="0" Y="0" Z="10"/><Point3D X="10" Y="0" Z="10"/><Point3D X="10" Y="5" Z="10"/>' +
    '</Polyline3D></CompositeCurve3D></Geometry></GeoCurve>' +
    '<GeoCurve><Geometry><CompositeCurve3D><Polyline3D PointCount="2">' +
    '<Point3D X="0" Y="0" Z="20"/><Point3D X="0" Y="8" Z="20"/>' +
    '</Polyline3D></CompositeCurve3D></Geometry></GeoCurve>' +
    '</Segments></LXDDocument>';
  const m = parseAlma(xml, 'test.cn');
  assert.equal(m.segments.length, 3);
  near(m.stats.feedLen, 15 + 8);
  near(m.meta.tubeLength, 5500);
  assert.equal(m.meta.tubeName, 'TUBE__2');
  near(m.meta.tubeDiameter, 114.3, 1e-6);
  assert.equal(m.warnings.length, 0);
});

// --- file reali (presenti solo sulla macchina dell'utente, non nel repo) ---
const REAL_DIR = new URL('../CAD-CAM/CAD-CAM/', import.meta.url);
const { existsSync } = await import('node:fs');
const { fileURLToPath } = await import('node:url');
const hasReal = existsSync(fileURLToPath(REAL_DIR));

test('file reale: 2025-94-4.nc (laser tubo)', { skip: !hasReal }, async () => {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL('2025-94-4.nc', REAL_DIR), 'utf8');
  const m = parseNC(text, '2025-94-4.nc');
  assert.ok(m.segments.length > 300, `pochi segmenti: ${m.segments.length}`);
  assert.ok(m.warnings.length < 50, `troppi avvisi (${m.warnings.length}): ${JSON.stringify(m.warnings.slice(0, 10))}`);
  near(m.meta.tubeLength, 5597);
});

test('file reale: TUBE__2.cn (AlmaCAM)', { skip: !hasReal }, async () => {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL('TUBE__2.cn', REAL_DIR), 'utf8');
  const { parseAlma } = await import('../src/loaders/alma/parser.js');
  const m = parseAlma(text, 'TUBE__2.cn');
  assert.ok(m.segments.length > 1000, `pochi segmenti: ${m.segments.length}`);
  assert.equal(m.warnings.length, 0);
  near(m.meta.tubeLength, 5500);
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
