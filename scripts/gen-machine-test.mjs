// @ts-check
// Generatore di FILE DI PROVA MACCHINA (rotary tubo → QtPlasmaC nativo) a diametro/
// lunghezza/spessore SCELTI. Pattern realistico e verificabile: fori Ø10 su due file
// (sommità + fianco) + un'asola assiale al fondo. Con kerf compensation dal preset.
//
// USO CLI:
//   node scripts/gen-machine-test.mjs --d 50.8 --len 300 --t 2 --mat mild_steel
//   (flag: --d diametro mm · --len lunghezza mm · --t spessore mm · --mat lega · --out file)
//   leghe: mild_steel · stainless · aluminum · finecut · f5
// Esporta anche machineTestPattern / generateMachineTest / assertNativeContract per i test.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { circleUV, obroundUV, wrapContoursToRotary } from '../src/generator/tubeWrap.js';
import { applyKerfAndLeads, cutParamsFor, materialEntries } from '../src/generator/rotaryCut.js';
import { materialNumber } from '../src/generator/plasmacMaterial.js';
import { tubePerimeter } from '../src/generator/tubeGeom.js';

/**
 * Pattern di prova su un tubo tondo: 3 fori Ø10 in sommità, 3 sul fianco (90°),
 * un'asola assiale 40×12 al fondo (180°). Posizioni relative alla lunghezza.
 * @param {{diameter:number, length:number}} tube
 */
export function machineTestPattern(tube) {
  const circ = Math.PI * tube.diameter;
  const L = tube.length;
  const us = [0.2, 0.5, 0.8].map((k) => Math.round(k * L));
  const cs = [];
  for (const u of us) cs.push({ pts: circleUV(u, 0, 5), tag: `foro-top Ø10 @u${u}` });        // sommità
  for (const u of us) cs.push({ pts: circleUV(u, circ / 4, 5), tag: `foro-side Ø10 @u${u}` });  // fianco 90°
  cs.push({ pts: obroundUV(Math.round(0.5 * L), circ / 2, 40, 12, 'u'), tag: 'asola assiale 40×12 @180°' });
  return cs;
}

/**
 * Genera il file di prova macchina completo (kerf comp + preset + post nativo).
 * @param {{diameter?:number, length?:number, thickness?:number, material?:string, name?:string}} [opts]
 * @returns {Promise<{gcode:string, name:string, tube:any, info:string}>}
 */
export async function generateMachineTest(opts = {}) {
  const diameter = opts.diameter ?? 50.8;      // 2" default
  const length = opts.length ?? 300;
  const thickness = opts.thickness ?? 2;
  const materialKey = opts.material ?? 'mild_steel';
  const tube = { shape: 'round', diameter, length };
  const perim = tubePerimeter(tube);

  const preset = cutParamsFor(thickness, materialEntries(materialKey));
  const kerf = preset.kerf, feed = preset.feed;
  const material = materialNumber(materialKey, thickness);

  const pattern = machineTestPattern({ diameter, length });
  // kerf compensation + lead-in ad arco; topologia TUBE = ogni contorno è un foro (−kerf/2)
  const cam = await applyKerfAndLeads(pattern, {
    kerf, lead: 'arc', leadLen: Math.max(2, kerf * 2), topology: 'tube',
  });
  const name = opts.name || `machine-test-O${diameter}x${length}-${materialKey}-${thickness}mm.ngc`;
  const r = wrapContoursToRotary(cam.contours, tube, { feed, thickness, material, name });
  const info = `tubo Ø${diameter}×${length} mm (perim. ${perim.toFixed(1)}) · ${materialKey} ${thickness} mm · `
    + `${cam.contours.length} contorni (${cam.holes} fori) · kerf ${kerf} mm · feed ${feed} mm/min · M190 P${material}`;
  return { gcode: r.gcode, name, tube, info };
}

/**
 * Verifica che il testo rispetti il contratto QtPlasmaC-nativo turnkey.
 * @param {string} g @returns {{ok:boolean, checks:Record<string,boolean>}}
 */
export function assertNativeContract(g) {
  const checks = {
    'keep-z-motion': g.includes('#<keep-z-motion>=1'),
    'no #<tube-cut>': !g.includes('#<tube-cut>'),
    'M03 $0 S1': /^M03 \$0 S1$/m.test(g),
    'M190+M66': /^M190 P\d+$/m.test(g) && /^M66 P3 L3 Q1$/m.test(g),
    'no G04': !/^G04/m.test(g),
    'G93+G94': /^G93$/m.test(g) && /^G94$/m.test(g),
    'no o<touchoff>': !/o<touchoff>/.test(g),
    'end M2': g.trimEnd().endsWith('M2'),
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

// ---- CLI (solo se invocato direttamente) ----
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
  const opts = {
    diameter: +arg('d', 50.8), length: +arg('len', 300),
    thickness: +arg('t', 2), material: arg('mat', 'mild_steel'), name: arg('out', undefined),
  };
  const { gcode, name, info } = await generateMachineTest(opts);
  const outUrl = new URL('../samples/generated/' + name, import.meta.url);
  writeFileSync(outUrl, gcode);
  const { ok, checks } = assertNativeContract(gcode);
  console.log('File macchina generato:', name);
  console.log(info);
  console.log('\nPreambolo:');
  console.log(gcode.split('\n').slice(0, 12).map((l) => '  ' + l).join('\n'));
  console.log('\nContratto QtPlasmaC-nativo:');
  for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? 'OK ' : 'NO '} ${k}`);
  console.log(ok ? '\n==> OK: pronto da tagliare (verifica sempre a secco prima).' : '\n==> FALLITO: contratto non rispettato.');
  process.exit(ok ? 0 : 1);
}
