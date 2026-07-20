// Genera e ispeziona il G-code rotary QtPlasmaC-nativo (demo + DXF reale).
// Rigenera i sample committati. Uso: node scripts/gen-rotary-native.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { generateRotaryDemo, wrapDxfToRotary, dxfDesignExtent } from '../src/generator/tubeWrap.js';
import { parseDXF } from '../src/loaders/dxf/parser.js';

const checks = (label, g) => {
  const r = {
    'keep-z-motion (salta probe)': g.includes('#<keep-z-motion>=1'),
    'NIENTE #<tube-cut>': !g.includes('#<tube-cut>'),
    'M03 $0 S1 (torcia)': /^M03 \$0 S1$/m.test(g),
    'M190+M66 (materiale+attesa)': /^M190 P\d+$/m.test(g) && /^M66 P3 L3 Q1$/m.test(g),
    'NIENTE G04 (pierce da QtPlasmaC)': !/^G04/m.test(g),
    'G93 inverse-time + G94 ripristino': /^G93$/m.test(g) && /^G94$/m.test(g),
    'NIENTE o<touchoff>': !/o<touchoff>/.test(g),
    'fine M2': g.trimEnd().endsWith('M2'),
  };
  console.log(`\n=== ${label} ===`);
  for (const [k, v] of Object.entries(r)) console.log(`  ${v ? 'OK ' : 'NO '} ${k}`);
  return Object.values(r).every(Boolean);
};

// 1) DEMO tubo tondo Ø60×300
const demo = generateRotaryDemo();
writeFileSync(new URL('../samples/generated/rotary-demo-qtplasmac.ngc', import.meta.url), demo.gcode);
console.log('--- DEMO tondo Ø60×300: preambolo ---');
console.log(demo.gcode.split('\n').slice(0, 15).join('\n'));
const ok1 = checks('DEMO round Ø60×300', demo.gcode);

// 2) DXF reale → wrap (Ø suggerito perché l'altezza copra un giro)
const dxfPath = new URL('../samples/dxf/piastra-4fori.dxf', import.meta.url);
const model = parseDXF(readFileSync(dxfPath, 'utf8'), 'piastra-4fori.dxf');
const D = dxfDesignExtent(model).suggestedDiameter;
const r = await wrapDxfToRotary(model, { diameter: D, thickness: 4, materialKey: 'mild_steel' });
writeFileSync(new URL('../samples/generated/piastra-4fori.rotary.ngc', import.meta.url), r.gcode);
console.log('\n--- DXF piastra-4fori → rotary ---');
console.log(r.info);
console.log(r.gcode.split('\n').slice(0, 14).join('\n'));
console.log('  … primo taglio:');
console.log(r.gcode.split('\n').filter((l) => /^G[01] /.test(l)).slice(0, 4).map((l) => '    ' + l).join('\n'));
const ok2 = checks('DXF squareandcircle → rotary', r.gcode);

console.log(`\n==> Contratto QtPlasmaC-nativo rispettato: demo=${ok1}  dxf=${ok2}`);
process.exit(ok1 && ok2 ? 0 : 1);
