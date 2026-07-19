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
import { applyKerfAndLeads, containmentDepthUV, cutParamsFor, MILD_STEEL_PLASMA } from '../src/generator/rotaryCut.js';
import { materialFileForAlloy, presetToMaterial, qtplasmacMaterialFile } from '../src/generator/plasmacMaterial.js';

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
  const wrap180 = (d) => ((d % 360) + 540) % 360 - 180;
  for (const mv of moves) {
    const ln = lines[mv.line - 1];
    assert.ok(/^G[01] X-?[\d.]+ A-?[\d.]+/.test(ln), `riga moto malformata: ${ln}`);
    assert.equal(ln.startsWith('G0 ') ? 'rapid' : 'feed', mv.type);
    // l'angolo A (shortest-path) è congruente a v/circonf·360 modulo 360°
    const a = +ln.match(/A(-?[\d.]+)/)[1];
    near(wrap180(a - vToDegrees(mv.v, tube.diameter)), 0, 1e-3);
  }
  // feed inverse-time: G93 nel preambolo, G94 ripristinato, F su moti di taglio
  assert.ok(/^G93$/m.test(text) && /^G94$/m.test(text), 'G93/G94 inverse-time');
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

test('material file QtPlasmaC: formato + campi obbligatori + valori dal preset', () => {
  const { text, count, materials } = materialFileForAlloy('mild_steel');
  assert.equal(count, MILD_STEEL_PLASMA.length);
  assert.ok(/^#plasmac material file/m.test(text));
  // sezioni numerate consecutive
  assert.ok(/^\[MATERIAL_NUMBER_1\]$/m.test(text) && /^\[MATERIAL_NUMBER_8\]$/m.test(text));
  // campi obbligatori presenti
  for (const k of ['PIERCE_HEIGHT', 'PIERCE_DELAY', 'CUT_HEIGHT', 'CUT_SPEED', 'KERF_WIDTH', 'CUT_AMPS']) {
    assert.ok(new RegExp(`^${k}\\s+= `, 'm').test(text), `manca campo ${k}`);
  }
  // il materiale 4 mm riflette il preset reale (kerf 1.4, feed 4220, pierce 0.1)
  const m4 = materials.find((m) => m.name.includes('4 mm'));
  assert.equal(m4.kerf, 1.4);
  assert.equal(m4.cutSpeed, 4220);
  assert.equal(m4.pierceDelay, 0.1);
  assert.equal(m4.pierceHeight, 3.8);       // 2.5 × cut height 1.5
});

test('materiali multipli: inox e alluminio con dati reali + volts nel material file', () => {
  const inox = materialFileForAlloy('stainless');
  const alu = materialFileForAlloy('aluminum');
  // inox 4 mm: kerf 1.3, feed 5160, volts 133 (Hypertherm 65A)
  const i4 = inox.materials.find((m) => m.name.includes('4 mm'));
  assert.equal(i4.kerf, 1.3); assert.equal(i4.cutSpeed, 5160); assert.equal(i4.cutVolts, 133);
  assert.ok(/^CUT_VOLTS\s+= 133$/m.test(inox.text));
  // alluminio 3 mm: kerf 1.1, feed 4400, volts 142
  const a3 = alu.materials.find((m) => m.name.includes('3 mm'));
  assert.equal(a3.kerf, 1.1); assert.equal(a3.cutSpeed, 4400); assert.equal(a3.cutVolts, 142);
  assert.ok(inox.alloy === 'Inox 304' && alu.alloy === 'Alluminio');
});

test('presetToMaterial: numero e nome coerenti', () => {
  const m = presetToMaterial({ t: 6, kerf: 1.5, feed: 2570, pierce: 0.2, amps: 65 }, { number: 3, alloyLabel: 'Acciaio dolce' });
  assert.equal(m.number, 3);
  assert.ok(m.name.includes('6 mm') && m.name.includes('65A'));
  const txt = qtplasmacMaterialFile([m]);
  assert.ok(txt.includes('[MATERIAL_NUMBER_3]'));
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

test('wrapDxfToRotary: DXF → QtPlasmaC + modello avvolto (Ø = un giro) + kerf/preset', async () => {
  const m0 = dxfModel();
  const D = dxfDesignExtent(m0).suggestedDiameter;
  const { model, gcode, name, tube, info } = await wrapDxfToRotary(m0, { diameter: D, thickness: 4 });
  assert.ok(name.endsWith('.ngc') && name.includes('rotary'));
  assert.equal(tube.diameter, D);
  assert.ok(gcode.includes('#<tube-cut>=1') && /^M03 \$0 S1$/m.test(gcode));
  assert.ok(model.segments.length > 20 && model.mesh.indices.length > 0);
  assert.equal(model.meta.unrollAvailable, true);
  assert.ok(info.includes('kerf 1.4 mm') && info.includes('feed 4220'), info);   // preset Hypertherm acciaio 4 mm
  assert.ok(gcode.includes('G04 P0.1'), 'pierce dal preset (4 mm → 0.1 s)');
  assert.ok(!info.includes('sovrappone'), info);
  const R = D / 2;
  for (const s of model.segments) for (const p of s.pts) near(Math.hypot(p.y, p.z), R, 1e-6);
});

test('wrapDxfToRotary: senza contorni chiusi → errore chiaro', async () => {
  const empty = { name: 'x.dxf', segments: [], meta: { dialect: 'DXF' } };
  await assert.rejects(() => wrapDxfToRotary(empty, { diameter: 50 }), /contorno CHIUSO/);
});

// --- kerf compensation + lead-in (rotaryCut) ---
const sqUV = (s, cu = 0, cv = 0) => [
  { u: cu - s / 2, v: cv - s / 2 }, { u: cu + s / 2, v: cv - s / 2 },
  { u: cu + s / 2, v: cv + s / 2 }, { u: cu - s / 2, v: cv + s / 2 },
  { u: cu - s / 2, v: cv - s / 2 },
];

test('containmentDepthUV: foro dentro il perimetro', () => {
  const outer = { pts: sqUV(100) };
  const hole = { pts: sqUV(20) };
  const d = containmentDepthUV([outer, hole]);
  assert.equal(d[0], 0);           // esterno
  assert.equal(d[1], 1);           // foro
});

test('applyKerfAndLeads: esterno cresce, foro rimpicciolisce di kerf/2', async () => {
  const kerf = 2;
  const outer = { pts: sqUV(100), tag: 'perimetro' };
  const hole = { pts: sqUV(20), tag: 'foro' };
  const { contours, holes, sheet } = await applyKerfAndLeads([outer, hole], { kerf, lead: 'none' });
  assert.equal(holes, 1);
  assert.equal(sheet, true);                 // 1 esterno che ne racchiude 1 → modo sheet
  const span = (pts, k) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k]));
  const spans = contours.map((c) => span(c.pts, 'u')).sort((a, b) => a - b);
  // il foro (20) offset −kerf/2 → ~18 ; il perimetro (100) offset +kerf/2 → ~102 (ordine inside-out)
  near(spans[0], 18, 0.2);
  near(spans[1], 102, 0.2);
});

test('applyKerfAndLeads: modo TUBE — fori indipendenti si rimpiccioliscono (−kerf/2)', async () => {
  const a = { pts: sqUV(20, -40, 0) };       // due contorni SEPARATI, entrambi top-level
  const b = { pts: sqUV(20, 40, 0) };
  const { contours, holes, sheet } = await applyKerfAndLeads([a, b], { kerf: 2, lead: 'none' });
  assert.equal(sheet, false);                // nessun perimetro che racchiude → tube
  assert.equal(holes, 2);                    // entrambi sono fori nel tubo
  const span = (pts) => Math.max(...pts.map((p) => p.u)) - Math.min(...pts.map((p) => p.u));
  for (const c of contours) near(span(c.pts), 18, 0.2);   // 20 − kerf/2 → 18
});

test('applyKerfAndLeads: lead-in termina esattamente su pts[0], dal lato sfrido', async () => {
  const hole = { pts: sqUV(30, 0, 0) };
  const { contours } = await applyKerfAndLeads([hole], { kerf: 0, lead: 'line', leadLen: 4 });
  const c = contours[0];
  assert.ok(c.lead.length >= 2);
  near(c.lead[c.lead.length - 1].u, c.pts[0].u, 1e-9);   // finisce su pts[0]
  near(c.lead[c.lead.length - 1].v, c.pts[0].v, 1e-9);
});

test('applyKerfAndLeads: foro più piccolo del kerf viene saltato', async () => {
  const tiny = { pts: sqUV(1) };            // 1 mm con kerf 2 → collassa
  const outer = { pts: sqUV(50) };
  const { contours, skipped } = await applyKerfAndLeads([outer, tiny], { kerf: 2, lead: 'none' });
  assert.equal(skipped, 1);
  assert.equal(contours.length, 1);
});
