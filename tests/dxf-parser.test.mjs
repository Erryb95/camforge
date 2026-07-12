// Test del loader DXF — eseguire con:  node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDXF } from '../src/loaders/dxf/parser.js';

const near = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `atteso ${b}, ottenuto ${a} (tol ${tol})`);

/** Costruisce un DXF minimo dalla lista di coppie [codice, valore]. */
const dxf = (...pairs) => pairs.map(([c, v]) => `${c}\n${v}`).join('\n') + '\n0\nEOF\n';

const ENT = (...pairs) => dxf(
  [0, 'SECTION'], [2, 'ENTITIES'],
  ...pairs,
  [0, 'ENDSEC'],
);

test('LINE con layer', () => {
  const m = parseDXF(ENT(
    [0, 'LINE'], [8, 'TAGLIO'], [10, '0'], [20, '0'], [11, '30'], [21, '40'],
  ));
  assert.equal(m.segments.length, 1);
  near(m.segments[0].len, 50);
  assert.equal(m.toolNames[1], 'TAGLIO');
  assert.equal(m.warnings.length, 0);
});

test('CIRCLE e ARC tessellati', () => {
  const m = parseDXF(ENT(
    [0, 'CIRCLE'], [8, '0'], [10, '10'], [20, '0'], [40, '5'],
    [0, 'ARC'], [8, '0'], [10, '0'], [20, '0'], [40, '10'], [50, '0'], [51, '90'],
  ));
  const circLen = m.segments.filter((s) => s.line <= 5).reduce((a, s) => a + s.len, 0);
  const arcLen = m.stats.feedLen - circLen;
  near(circLen, 2 * Math.PI * 5, 0.05);
  near(arcLen, Math.PI / 2 * 10, 0.05);
  // l'arco DXF è sempre antiorario: da (10,0) a (0,10)
  near(m.bounds.max.x, 15, 0.01);
  near(m.bounds.max.y, 10, 0.01);
});

test('LWPOLYLINE chiusa con bulge (raccordo)', () => {
  // quadrato 20x20 con lato destro sostituito da semicerchio (bulge 1)
  const m = parseDXF(ENT(
    [0, 'LWPOLYLINE'], [8, '0'], [90, '4'], [70, '1'],
    [10, '0'], [20, '0'],
    [10, '20'], [20, '0'], [42, '1'],   // bulge: semicerchio verso (20,20)
    [10, '20'], [20, '20'],
    [10, '0'], [20, '20'],
  ));
  // perimetro: 20 (sotto) + semicerchio r10 + 20 (sopra) + 20 (chiusura sinistra)
  near(m.stats.feedLen, 20 + Math.PI * 10 + 20 + 20, 0.1);
  near(m.bounds.max.x, 30, 0.05);  // il semicerchio sporge a destra
});

test('INSERT: blocco traslato e ruotato', () => {
  const m = parseDXF(dxf(
    [0, 'SECTION'], [2, 'BLOCKS'],
    [0, 'BLOCK'], [2, 'SQ'], [10, '0'], [20, '0'],
    [0, 'LINE'], [8, '0'], [10, '0'], [20, '0'], [11, '10'], [21, '0'],
    [0, 'ENDBLK'],
    [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'ENTITIES'],
    [0, 'INSERT'], [2, 'SQ'], [10, '100'], [20, '50'], [50, '90'],
    [0, 'ENDSEC'],
  ));
  assert.equal(m.segments.length, 1);
  const s = m.segments[0];
  near(s.from.x, 100, 1e-9); near(s.from.y, 50, 1e-9);
  near(s.to.x, 100, 1e-6); near(s.to.y, 60, 1e-6);  // ruotata di 90°
});

test('POINT diventa marcatore foro', () => {
  const m = parseDXF(ENT([0, 'POINT'], [8, 'FORI'], [10, '5'], [20, '7']));
  assert.equal(m.drillPoints.length, 1);
  near(m.drillPoints[0].at.x, 5);
  assert.equal(m.toolNames[m.drillPoints[0].tool], 'FORI');
});

test('unità in pollici convertite ($INSUNITS 1)', () => {
  const m = parseDXF(dxf(
    [0, 'SECTION'], [2, 'HEADER'], [9, '$INSUNITS'], [70, '1'], [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'ENTITIES'],
    [0, 'LINE'], [8, '0'], [10, '0'], [20, '0'], [11, '1'], [21, '0'],
    [0, 'ENDSEC'],
  ));
  near(m.segments[0].len, 25.4);
});

test('entità sconosciute: avviso, non crash; tabelle ignorate', () => {
  const m = parseDXF(dxf(
    [0, 'SECTION'], [2, 'TABLES'], [0, 'TABLE'], [2, 'LAYER'], [0, 'LAYER'], [2, 'X'], [0, 'ENDTAB'], [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'ENTITIES'],
    [0, 'MTEXT'], [8, '0'], [10, '0'], [20, '0'],
    [0, 'LINE'], [8, '0'], [10, '0'], [20, '0'], [11, '5'], [21, '0'],
    [0, 'ENDSEC'],
  ));
  assert.equal(m.segments.length, 1);
  assert.ok(m.warnings.some((w) => w.msg.includes('MTEXT')));
  assert.ok(!m.warnings.some((w) => w.msg.includes('TABLE')));
});

// --- file reali (skip se assenti) ---
const REAL_DIR = new URL('../CAD-CAM/CAD-CAM/', import.meta.url);
const { existsSync } = await import('node:fs');
const { fileURLToPath } = await import('node:url');
const hasReal = existsSync(fileURLToPath(REAL_DIR));

test('file reale: TEST2.dxf (4 cerchi + polilinea)', { skip: !hasReal }, async () => {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL('TEST2.dxf', REAL_DIR), 'utf8');
  const m = parseDXF(text, 'TEST2.dxf');
  assert.ok(m.segments.length > 0, 'nessun segmento');
  assert.ok(m.bounds, 'bounds nulli');
  const w = m.bounds.max.x - m.bounds.min.x;
  const h = m.bounds.max.y - m.bounds.min.y;
  assert.ok(w > 1 && w < 100000, `larghezza sospetta: ${w}`);
  assert.ok(h > 1 && h < 100000, `altezza sospetta: ${h}`);
  assert.ok(m.warnings.length < 30, `troppi avvisi: ${JSON.stringify(m.warnings.slice(0, 8))}`);
});

test('file reale: ttt.dxf (disegno vuoto, gestito con garbo)', { skip: !hasReal }, async () => {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL('ttt.dxf', REAL_DIR), 'utf8');
  const m = parseDXF(text, 'ttt.dxf');
  // il file non contiene alcuna entità disegnabile: niente crash, avviso chiaro
  assert.equal(m.segments.length, 0);
  assert.ok(m.warnings.some((w) => w.msg.includes('Nessuna entità')));
});
