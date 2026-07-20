import { readFileSync } from 'node:fs';
import { parseDXF } from '../src/loaders/dxf/parser.js';
import { sheetCutFromModel } from '../src/generator/sheetCut.js';

const m = parseDXF(readFileSync(new URL('../samples/dxf/piastra-4fori.dxf', import.meta.url), 'utf8'), 'piastra-4fori.dxf');
const r = await sheetCutFromModel(m, { thickness: 3, materialKey: 'mild_steel', dialect: 'qtplasmac', lead: 'arc', tabCount: 4, tabLen: 3 });
console.log(r.info);
console.log('--- prime 22 righe ---');
console.log(r.gcode.split('\n').slice(0, 22).join('\n'));
const g = r.gcode;
console.log('\n--- checks ---');
const chk = {
  'M190+M66': /^M190 P\d+/m.test(g) && /^M66 P3 L3 Q1/m.test(g),
  'M03 $0 S1 presente': /^M03 \$0 S1/m.test(g),
  'M05 $0 presente': /^M05 \$0/m.test(g),
  'G0 X/Y': /^G0 X-?[\d.]+ Y-?[\d.]+/m.test(g),
  'G1 con F': /^G1 X-?[\d.]+ Y-?[\d.]+ F/m.test(g),
  'niente asse A (è piatto)': !/\bA-?[\d.]/.test(g),
  'niente keep-z-motion (piatto usa il probe)': !/keep-z-motion/.test(g),
  'fine M2': g.trimEnd().endsWith('M2'),
};
for (const [k, v] of Object.entries(chk)) console.log(`  ${v ? 'OK ' : 'NO '} ${k}`);
const m03 = (g.match(/^M03 \$0 S1/gm) || []).length;
const m05 = (g.match(/^M05 \$0/gm) || []).length;
console.log(`  accensioni M03=${m03}, spegnimenti M05=${m05} (4 tab sul perimetro → +4 riaccensioni; 4 fori)`);

// GRBL laser variant (niente material, M3 S/M5 + G4)
const rg = await sheetCutFromModel(m, { thickness: 3, dialect: 'grbl', tabCount: 0 });
console.log('\n--- GRBL laser (no material) ---');
console.log('  no M190:', !/M190/.test(rg.gcode), '· M3 S:', /^M3 S\d+/m.test(rg.gcode), '· G4 pierce:', /^G4 P/m.test(rg.gcode));
