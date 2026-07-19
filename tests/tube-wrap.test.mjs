// CAM tubo/rotary: avvolgimento svolto→asse A + post QtPlasmaC + modello avvolto.
// Verifica la matematica del wrap, l'emissione G-code QtPlasmaC e la coerenza
// del SceneModel (sync seg.line ↔ riga del G-code emesso).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { postRotaryPlasmaC, vToDegrees, degreesToV } from '../src/generator/post/plasmac.js';
import { generateRotaryDemo, circleUV, obroundUV, demoPattern,
  contoursFromDxfModel, wrapDxfToRotary, dxfDesignExtent } from '../src/generator/tubeWrap.js';
import { parseDXF } from '../src/loaders/dxf/parser.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `atteso ${b}, ottenuto ${a} (tol ${tol})`);

test('wrap: v→A gradi e round-trip (circonferenza = 360°)', () => {
  const D = 60;
  const circ = Math.PI * D;
  near(vToDegrees(0, D), 0);
  near(vToDegrees(circ, D), 360);
  near(vToDegrees(circ / 2, D), 180);
  near(vToDegrees(circ / 4, D), 90);
  // round-trip su valori arbitrari
  for (const v of [3.2, 47.1, 94.24, -20]) near(degreesToV(vToDegrees(v, D), D), v, 1e-9);
});

test('circleUV / obroundUV: contorni chiusi coerenti', () => {
  const c = circleUV(10, 5, 7, 24);
  assert.equal(c.length, 25);
  near(c[0].u, c[c.length - 1].u, 1e-9); near(c[0].v, c[c.length - 1].v, 1e-9);  // chiuso
  for (const p of c) near(Math.hypot(p.u - 10, p.v - 5), 7, 1e-9);  // sul raggio
  const ob = obroundUV(0, 0, 80, 12, 'u');            // asola assiale
  const uSpan = Math.max(...ob.map((p) => p.u)) - Math.min(...ob.map((p) => p.u));
  const vSpan = Math.max(...ob.map((p) => p.v)) - Math.min(...ob.map((p) => p.v));
  near(uSpan, 80, 1e-6);                              // lunghezza lungo u
  near(vSpan, 12, 1e-6);                              // larghezza = width
});

test('postRotaryPlasmaC: struttura QtPlasmaC (X/A, tube-cut, M03 $0 S1/M05 $0, pierce)', () => {
  const tube = { diameter: 60, length: 300 };
  const contours = [circleUV(60, 0, 7), circleUV(120, 47, 5)].map((pts) => ({ pts }));
  const { text, lines, moves } = postRotaryPlasmaC(contours, tube, { feed: 2000, thickness: 2, material: 0 });
  assert.ok(text.includes('G21'));
  assert.ok(text.includes('#<tube-cut>=1'));
  assert.ok(text.includes('M190 P0'));
  assert.ok(text.endsWith('M30\n'));
  const m03 = (text.match(/^M03 \$0 S1$/gm) || []).length;
  const m05 = (text.match(/^M05 \$0$/gm) || []).length;
  assert.equal(m03, 2, 'un accensione torcia per contorno');
  assert.ok(m05 >= 3, 'spegnimento per contorno + postamble');
  assert.ok(/^G04 P/m.test(text), 'pierce delay presente');
  // ogni riga di moto è X…A…; e i moves puntano a righe reali coerenti
  assert.ok(moves.length > 0);
  for (const mv of moves) {
    const ln = lines[mv.line - 1];
    assert.ok(/^G[01] X-?[\d.]+ A-?[\d.]+/.test(ln), `riga moto malformata: ${ln}`);
    assert.equal(ln.startsWith('G0 ') ? 'rapid' : 'feed', mv.type);
    // l'angolo A nella riga corrisponde al v del move
    const a = +ln.match(/A(-?[\d.]+)/)[1];
    near(a, vToDegrees(mv.v, tube.diameter), 1e-3);
  }
});

test('postRotaryPlasmaC: material null omette M190', () => {
  const { text } = postRotaryPlasmaC([{ pts: circleUV(0, 0, 5) }], { diameter: 40, length: 100 }, { material: null });
  assert.ok(!text.includes('M190'));
});

test('generateRotaryDemo: modello avvolto coerente + sync seg.line ↔ G-code', () => {
  const { model, gcode, name, tube } = generateRotaryDemo();
  assert.equal(tube.diameter, 60);
  assert.ok(name.endsWith('.ngc'));
  assert.ok(model.segments.length > 50);
  assert.ok(model.mesh && model.mesh.indices.length > 0, 'mesh tubo presente');
  assert.equal(model.meta.unrollAvailable, true);
  near(model.meta.perimeter, Math.PI * 60, 1e-3);
  assert.equal(model.units, 'mm');
  const rl = gcode.split('\n');
  assert.deepEqual(model.rawLines, rl.slice(0, model.rawLines.length));  // rawLines = G-code emesso

  const R = tube.diameter / 2;
  for (const s of model.segments) {
    assert.ok(s.uv && s.uv.length === s.pts.length, 'seg.uv allineato a pts');
    // ogni punto giace sulla superficie del tubo: hypot(y,z) = R
    for (const p of s.pts) near(Math.hypot(p.y, p.z), R, 1e-6);
    // seg.line punta a una riga di moto reale del G-code
    const ln = rl[s.line - 1];
    assert.ok(/^G[01] X-?[\d.]+ A-?[\d.]+/.test(ln), `seg.line ${s.line} non è un moto: "${ln}"`);
    assert.equal(ln.startsWith('G0 ') ? 'rapid' : 'feed', s.type);
  }
});

test('generateRotaryDemo: l\'asola circonferenziale avvolge (A copre >90°)', () => {
  const { gcode } = generateRotaryDemo();
  let amin = Infinity, amax = -Infinity;
  for (const l of gcode.split('\n')) {
    const g = l.match(/A(-?[\d.]+)/);
    if (g) { const a = +g[1]; if (a < amin) amin = a; if (a > amax) amax = a; }
  }
  assert.ok(amax - amin > 180, `atteso wrap ampio, A span = ${(amax - amin).toFixed(1)}°`);
});

test('demoPattern: numero di contorni atteso (2 file fori + 2 asole)', () => {
  const cs = demoPattern({ diameter: 60, length: 300 });
  assert.equal(cs.length, 10);                       // 4 top + 4 side + 2 asole
  assert.ok(cs.every((c) => c.pts.length >= 3 && c.lead && c.lead.length === 2));
});

// --- DXF svolto → wrap rotary ---
const DXF = fileURLToPath(new URL('../samples/dxf/piastra-4fori.dxf', import.meta.url));
const dxfModel = () => parseDXF(readFileSync(DXF, 'utf8'), 'piastra-4fori.dxf');

test('contoursFromDxfModel: estrae i contorni chiusi (piastra + 4 fori)', () => {
  const cs = contoursFromDxfModel(dxfModel());
  assert.equal(cs.length, 5);                        // 1 esterno + 4 fori
  assert.ok(cs.every((c) => c.pts.length >= 3 && 'u' in c.pts[0] && 'v' in c.pts[0]));
});

test('dxfDesignExtent: Ø suggerito = altezza disegno / π', () => {
  const e = dxfDesignExtent(dxfModel());
  assert.equal(e.contours, 5);
  assert.ok(e.uSpan > 0 && e.vSpan > 0);
  near(e.suggestedDiameter, Math.ceil((e.vSpan / Math.PI) * 10) / 10, 1e-9);
  assert.ok(Math.PI * e.suggestedDiameter >= e.vSpan, 'la circonferenza copre l\'altezza');
});

test('wrapDxfToRotary: DXF → QtPlasmaC + modello avvolto (Ø = un giro)', () => {
  const m0 = dxfModel();
  const D = dxfDesignExtent(m0).suggestedDiameter;
  const { model, gcode, name, tube, info } = wrapDxfToRotary(m0, { diameter: D });
  assert.ok(name.endsWith('.ngc') && name.includes('rotary'));
  assert.equal(tube.diameter, D);
  assert.ok(gcode.includes('#<tube-cut>=1') && /^M03 \$0 S1$/m.test(gcode));
  assert.ok(model.segments.length > 20 && model.mesh.indices.length > 0);
  assert.equal(model.meta.unrollAvailable, true);
  assert.ok(typeof info === 'string' && info.includes('contorni'));
  // con Ø = altezza/π il disegno sta in ~un giro: nessun avviso di sovrapposizione
  assert.ok(!info.includes('sovrappone'), info);
  // ogni punto giace sulla superficie del tubo
  const R = D / 2;
  for (const s of model.segments) for (const p of s.pts) near(Math.hypot(p.y, p.z), R, 1e-6);
});

test('wrapDxfToRotary: senza contorni chiusi → errore chiaro', () => {
  const empty = { name: 'x.dxf', segments: [], meta: { dialect: 'DXF' } };
  assert.throws(() => wrapDxfToRotary(empty, { diameter: 50 }), /contorno CHIUSO/);
});
