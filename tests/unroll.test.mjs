// Test dello sviluppo "tubo svolto" — eseguire con:  node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { perimeterParam, headToTube, makeUnwrapper, profileFromMeta, guidesFor } from '../src/core/unroll.js';
import { parseNC } from '../src/loaders/nc/parser.js';
import { parseAlma } from '../src/loaders/alma/parser.js';

const near = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `atteso ${b}, ottenuto ${a} (tol ${tol})`);

const RECT = profileFromMeta({ tubeWidth: 73, tubeHeight: 25 });   // per 196
const ROUND = profileFromMeta({ tubeDiameter: 20 });               // r 10

test('perimeterParam rettangolo: facce e spigoli', () => {
  near(RECT.per, 196);
  near(perimeterParam(0, 12.5, RECT), 0);        // centro faccia superiore
  near(perimeterParam(10, 12.5, RECT), 10);      // faccia sup. verso destra
  near(perimeterParam(36.5, 0, RECT), 49);       // metà fianco destro (36.5+12.5)
  near(perimeterParam(0, -12.5, RECT), -98);     // centro fondo = cucitura (±per/2)
  near(perimeterParam(-36.5, 0, RECT), -49);     // metà fianco sinistro
  near(perimeterParam(-10, 12.5, RECT), -10);    // faccia sup. verso sinistra
});

test('perimeterParam: punti fuori bordo e interni proiettati', () => {
  near(perimeterParam(3, 40, RECT), 3);          // testa sollevata sopra la faccia
  near(perimeterParam(30, 0, RECT), 49);         // interno: agganciato al fianco destro
  near(perimeterParam(50, 0, RECT), 49);         // esterno oltre il fianco
});

test('perimeterParam tondo', () => {
  near(perimeterParam(0, 10, ROUND), 0);                    // dorso
  near(perimeterParam(10, 0, ROUND), Math.PI / 2 * 10);     // fianco destro
  near(perimeterParam(0, -10, ROUND), -Math.PI * 10);       // cucitura
});

test('headToTube: rotazione del sistema tubo', () => {
  let p = headToTube(5, 15, 0);
  near(p.yt, 5); near(p.zt, 15);
  p = headToTube(5, 15, 90);
  near(p.yt, 15); near(p.zt, -5);
  p = headToTube(5, 15, 180);
  near(p.yt, -5); near(p.zt, -15);
  p = headToTube(5, 15, 360);   // giro completo = identità
  near(p.yt, 5); near(p.zt, 15);
});

test('unwrapper: continuità attraverso la cucitura e reset', () => {
  const un = makeUnwrapper(196);
  near(un.next(95), 95);
  near(un.next(97), 97);
  near(un.next(-97), 99);    // attraversa la cucitura: 99, non -97
  near(un.next(-90), 106);
  un.reset();
  near(un.next(-90), -90);   // dopo il reset si riparte nella fascia base
  const un2 = makeUnwrapper(196);
  near(un2.next(-95), -95);
  near(un2.next(97), -99);   // direzione opposta
});

test('guide facce per la vista svolta', () => {
  assert.deepEqual(guidesFor(RECT), [-98, -61.5, -36.5, 36.5, 61.5, 98]);
  assert.equal(guidesFor(ROUND).length, 4);
});

test('dialetto NC tubo: uv con carro X_1 e rotazione P', () => {
  const m = parseNC([
    'LT<5597.00>',
    'WW<73.0> WH<25.0>',
    'G90',
    'G1 X-10 Y0 Z12.5 X_1=100 P0.0 F1000',
    'G1 Y10',
    'G1 Y11 P10',
    'G1 P50',                       // sola rotazione: nessuna geometria (coordinate nel sistema pezzo)
  ].join('\n'));
  assert.equal(m.warnings.length, 0, JSON.stringify(m.warnings));
  assert.ok(m.meta.unrollAvailable);
  near(m.meta.perimeter, 196);
  assert.equal(m.segments.length, 3);
  for (const s of m.segments) assert.ok(s.uv && s.uv.length >= 2, 'ogni segmento ha uv');

  // primo: u finale = X_1 + X = 100 - 10 = 90, v = 0 (centro faccia sup.)
  const s0 = m.segments[0];
  near(s0.uv.at(-1).u, 90);
  near(s0.uv.at(-1).v, 0);
  // secondo: Y 0→10 sulla faccia superiore ⇒ v 0→10, u fermo
  const s1 = m.segments[1];
  near(s1.uv[0].v, 0); near(s1.uv.at(-1).v, 10); near(s1.uv.at(-1).u, 90);
  // terzo: Y/Z già nel sistema pezzo ⇒ v = Y anche con P che cambia
  const s2 = m.segments[2];
  near(s2.uv.at(-1).v, 11);
  near(s2.rot0, 0); near(s2.rot1, 10);   // P comunque registrato (tooltip)
});

test('dialetto .pgm: shield G-macchina, meta G2292, rotazione C', () => {
  const m = parseNC([
    '% .PGM',
    'G2292 Y-30 V30 Z-30 W30 I7 X0 U-6000',
    'G510 A1 V-1800 W280 M2 L-0.95 P208.1',   // M2 qui NON è fine programma
    'G800 D1 G10 X-0.95 Y0 Z30 H0 C0 F1 T1 P1 R1',
    'G1 X-5 Y0 Z30 C0 B0 EI0.00000 EJ0.00000 EK1.00000',
    'G1 Y10 C2.9',
    'G832',
  ].join('\n'), 'test.pgm');
  near(m.meta.tubeWidth, 60);
  near(m.meta.tubeHeight, 60);
  near(m.meta.tubeLength, 6000);
  assert.ok(m.meta.unrollAvailable);
  // le righe G>=100 non generano segmenti né terminano il programma
  assert.equal(m.segments.length, 2);
  assert.equal(m.segments[1].type, 'feed');
  near(m.segments[1].to.y, 10);
  near(m.segments[1].rot1, 2.9);      // C tracciato come rotazione
  near(m.segments[1].uv.at(-1).v, 10); // faccia superiore: v = Y
  assert.equal(m.warnings.length, 0, JSON.stringify(m.warnings));
});

test('milling normale: P non attiva lo sviluppo senza header tubo', () => {
  const m = parseNC('G90\nG1 X10 F100\nG4 P500\nG1 X20\n');
  assert.equal(m.meta.unrollAvailable, undefined);
  assert.equal(m.segments.length, 2);
  assert.ok(!m.segments[0].uv);
});

test('AlmaCAM: sviluppo tondo con continuità', () => {
  // quarto di cerchio r=50 sul piano sezione, a z=100
  let xmlPts = '';
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * Math.PI / 2;   // da +y (dorso) verso +x
    xmlPts += `<Point3D X="${(50 * Math.sin(a)).toFixed(6)}" Y="${(50 * Math.cos(a)).toFixed(6)}" Z="100"/>`;
  }
  const xml = '<LXDDocument FileVer="1"><ExtMin X="-50" Y="-50" Z="0"/><ExtMax X="50" Y="50" Z="500"/>' +
    `<Segments TubeLength="500" TubeName="T"><GeoCurve><Polyline3D>${xmlPts}</Polyline3D></GeoCurve></Segments></LXDDocument>`;
  const m = parseAlma(xml, 't.cn');
  assert.ok(m.meta.unrollAvailable);
  near(m.meta.tubeDiameter, 100, 1e-3);
  assert.equal(m.segments.length, 6);
  near(m.segments[0].uv[0].u, 100);
  near(m.segments[0].uv[0].v, 0, 1e-3);                       // parte dal dorso
  near(m.segments.at(-1).uv.at(-1).v, Math.PI / 2 * 50, 1e-3); // quarto di perimetro
});

// --- file reali (skip se assenti) ---
const REAL_DIR = new URL('../CAD-CAM/CAD-CAM/', import.meta.url);
const { existsSync } = await import('node:fs');
const { fileURLToPath } = await import('node:url');
const hasReal = existsSync(fileURLToPath(REAL_DIR));

test('reale 2025-94-4.nc: sviluppo completo e coerente', { skip: !hasReal }, async () => {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL('2025-94-4.nc', REAL_DIR), 'utf8');
  const m = parseNC(text, '2025-94-4.nc');
  assert.ok(m.meta.unrollAvailable);
  near(m.meta.perimeter, 196);
  let uMin = Infinity, uMax = -Infinity, vAbs = 0, missing = 0;
  for (const s of m.segments) {
    if (!s.uv) { missing++; continue; }
    for (const q of s.uv) {
      if (q.u < uMin) uMin = q.u;
      if (q.u > uMax) uMax = q.u;
      vAbs = Math.max(vAbs, Math.abs(q.v));
    }
  }
  assert.equal(missing, 0);
  // X_1 307..401 + X -95..0 → posizioni pezzo sul tubo
  assert.ok(uMin > 150 && uMax < 450, `u fuori range: ${uMin}..${uMax}`);
  // troncatura = 1 perimetro (196) + sovrapposizione; mai 2 giri
  assert.ok(vAbs < 260, `v oltre un perimetro+overlap: ${vAbs}`);
});

test('reale ALFA.NC: u copre il tubo, v limitato', { skip: !hasReal }, async () => {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL('ALFA.NC', REAL_DIR), 'utf8');
  const m = parseNC(text, 'ALFA.NC');
  assert.ok(m.meta.unrollAvailable);
  let uMin = Infinity, uMax = -Infinity, vAbs = 0;
  for (const s of m.segments) {
    for (const q of s.uv || []) {
      if (q.u < uMin) uMin = q.u;
      if (q.u > uMax) uMax = q.u;
      vAbs = Math.max(vAbs, Math.abs(q.v));
    }
  }
  assert.ok(uMin > -50 && uMax < 6100, `u fuori range: ${uMin}..${uMax}`);
  assert.ok(vAbs < 200, `v oltre un perimetro+overlap (per=120): ${vAbs}`);
});

test('reale TUBE-2026-90-1.pgm: sezione 60×60, sviluppo attivo', { skip: !hasReal }, async () => {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL('TUBE-2026-90-1.pgm', REAL_DIR), 'utf8');
  const m = parseNC(text, 'TUBE-2026-90-1.pgm');
  near(m.meta.tubeLength, 6000);
  assert.ok(m.meta.unrollAvailable, 'sviluppo non attivo');
  // sezione quadra: i punti NON sono a raggio costante → resta il rettangolo
  near(m.meta.tubeWidth, 60);
  near(m.meta.tubeHeight, 60);
  assert.ok(m.segments.length > 400, `pochi segmenti: ${m.segments.length}`);
  assert.ok(m.warnings.length < 15, `troppi avvisi (${m.warnings.length}): ${JSON.stringify(m.warnings.slice(0, 8))}`);
  let vAbs = 0;
  for (const s of m.segments) for (const q of s.uv || []) vAbs = Math.max(vAbs, Math.abs(q.v));
  assert.ok(vAbs < 400, `v oltre un perimetro+overlap (per=240): ${vAbs}`);
});

test('reale TUBE__2.cn: sviluppo tondo', { skip: !hasReal }, async () => {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL('TUBE__2.cn', REAL_DIR), 'utf8');
  const m = parseAlma(text, 'TUBE__2.cn');
  assert.ok(m.meta.unrollAvailable);
  near(m.meta.tubeDiameter, 114.3, 0.2);
  let vAbs = 0;
  for (const s of m.segments) for (const q of s.uv || []) vAbs = Math.max(vAbs, Math.abs(q.v));
  assert.ok(vAbs < 400, `v esploso: ${vAbs}`);
});
