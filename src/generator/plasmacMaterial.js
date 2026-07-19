// @ts-check
// Export MATERIAL FILE di QtPlasmaC (LinuxCNC): sezioni [MATERIAL_NUMBER_x] con i
// parametri di taglio (kerf/feed/pierce/amps/altezze). Nasce da un dato di
// mercato preciso: NON esiste un database ufficiale LinuxCNC di parametri plasma
// — gli utenti compilano i material file a mano dai cut chart del costruttore.
// Noi li generiamo dai preset (dati reali Hypertherm), pronti da caricare in
// QtPlasmaC e da richiamare nel G-code con M190 P<numero>.

import { PLASMA_MATERIALS } from './rotaryCut.js';

const round1 = (v) => Math.round(v * 10) / 10;

/**
 * @typedef {{number:number, name:string, kerf:number, pierceHeight:number,
 *   pierceDelay:number, puddleJumpHeight:number, puddleJumpDelay:number,
 *   cutHeight:number, cutSpeed:number, cutAmps:number, cutVolts:number,
 *   pauseAtEnd:number, gasPressure:number, cutMode:number}} QtMaterial
 */

/**
 * Costruisce un materiale QtPlasmaC da un preset (kerf/feed/pierce/amps). Le
 * altezze non presenti nei cut chart usano default sensati: cut height 1.5 mm,
 * pierce height = 2.5× la cut height (≈3.8 mm, valore tipico Hypertherm SYNC).
 * @param {{t:number, kerf:number, feed:number, pierce:number, amps:number, volts?:number}} preset
 * @param {{number:number, alloyLabel:string, cutHeight?:number, piercePct?:number, cutVolts?:number, cutMode?:number}} opts
 * @returns {QtMaterial}
 */
export function presetToMaterial(preset, opts) {
  const cutHeight = opts.cutHeight ?? 1.5;
  return {
    number: opts.number,
    name: `${opts.alloyLabel} ${preset.t} mm (${preset.amps}A)`,
    kerf: preset.kerf,
    pierceHeight: round1(cutHeight * (opts.piercePct ?? 2.5)),
    pierceDelay: preset.pierce,
    puddleJumpHeight: 0,
    puddleJumpDelay: 0,
    cutHeight,
    cutSpeed: preset.feed,
    cutAmps: preset.amps,
    cutVolts: preset.volts ?? opts.cutVolts ?? 0,
    pauseAtEnd: 0,
    gasPressure: 0,
    cutMode: opts.cutMode ?? 1,
  };
}

/**
 * Serializza uno o più materiali nel formato material file di QtPlasmaC.
 * @param {QtMaterial[]} materials
 * @param {{title?:string}} [opts]
 */
export function qtplasmacMaterialFile(materials, opts = {}) {
  const L = [];
  L.push('#plasmac material file');
  L.push(`# ${opts.title || 'generato da CAD/CAM visualLGE'}`);
  L.push('# items marked * are mandatory, others default to 0');
  L.push('# valori dai cut chart Hypertherm Powermax SYNC — VERIFICARE sul proprio impianto (torcia/consumabili/gas)');
  L.push('# copiare in <config>/<machine>_material.cfg e richiamare con M190 P<numero>');
  L.push('');
  const pad = (k) => (k + '                 ').slice(0, 18);
  for (const m of materials) {
    L.push(`[MATERIAL_NUMBER_${m.number}]`);
    L.push(`${pad('NAME')} = ${m.name}`);
    L.push(`${pad('KERF_WIDTH')} = ${m.kerf}`);
    L.push(`${pad('PIERCE_HEIGHT')} = ${m.pierceHeight}`);      // *
    L.push(`${pad('PIERCE_DELAY')} = ${m.pierceDelay}`);        // *
    L.push(`${pad('PUDDLE_JUMP_HEIGHT')} = ${m.puddleJumpHeight}`);
    L.push(`${pad('PUDDLE_JUMP_DELAY')} = ${m.puddleJumpDelay}`);
    L.push(`${pad('CUT_HEIGHT')} = ${m.cutHeight}`);            // *
    L.push(`${pad('CUT_SPEED')} = ${m.cutSpeed}`);              // *
    L.push(`${pad('CUT_AMPS')} = ${m.cutAmps}`);
    L.push(`${pad('CUT_VOLTS')} = ${m.cutVolts}`);
    L.push(`${pad('PAUSE_AT_END')} = ${m.pauseAtEnd}`);
    L.push(`${pad('GAS_PRESSURE')} = ${m.gasPressure}`);
    L.push(`${pad('CUT_MODE')} = ${m.cutMode}`);
    L.push('');
  }
  return L.join('\n') + '\n';
}

/**
 * Material file per un'INTERA lega (tutti gli spessori del preset), numerati da
 * startNumber. @param {string} alloyKey @param {{startNumber?:number, cutHeight?:number, piercePct?:number}} [opts]
 * @returns {{text:string, count:number, alloy:string, materials:QtMaterial[]}}
 */
export function materialFileForAlloy(alloyKey, opts = {}) {
  const alloy = PLASMA_MATERIALS[alloyKey] || PLASMA_MATERIALS.mild_steel;
  const start = opts.startNumber ?? 1;
  const materials = alloy.entries.map((p, i) => presetToMaterial(p, {
    number: start + i, alloyLabel: alloy.label, cutHeight: opts.cutHeight, piercePct: opts.piercePct,
  }));
  return {
    text: qtplasmacMaterialFile(materials, { title: `${alloy.label} (${alloy.gas}) — ${materials.length} spessori` }),
    count: materials.length, alloy: alloy.label, materials,
  };
}
