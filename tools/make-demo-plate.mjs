// Genera samples/cad/plate-demo.step: piastra 120×80×4 con 4 fori Ø8 agli
// angoli, foro centrale Ø30 e un'ASOLA 30×10 — il pezzo dimostrativo per la
// pipeline STEP → NC (tools/step2nc.mjs). Tutto costruito localmente con
// opencascade.js full (B-rep + STEPControl_Writer): demo riproducibile offline.
// Uso: node tools/make-demo-plate.mjs [out.step]
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getOcctFull } from '../src/loaders/step/occt.js';

const out = process.argv[2] || fileURLToPath(new URL('../samples/cad/plate-demo.step', import.meta.url));
const oc = await getOcctFull();

const W = 120, H = 80, T = 4;

// piastra
let shape = new oc.BRepPrimAPI_MakeBox_1(W, H, T).Shape();

/** Cilindro passante (asse Z) in (x,y). */
function drill(x, y, r) {
  const ax = new oc.gp_Ax2_3(new oc.gp_Pnt_3(x, y, -1), new oc.gp_Dir_4(0, 0, 1));
  const cyl = new oc.BRepPrimAPI_MakeCylinder_3(ax, r, T + 2).Shape();
  const cut = new oc.BRepAlgoAPI_Cut_3(shape, cyl);
  cut.Build();
  if (!cut.IsDone()) throw new Error(`cut fallito su foro ${x},${y}`);
  shape = cut.Shape();
}

// 4 fori angolari Ø8 + foro centrale Ø30
for (const [x, y] of [[15, 15], [W - 15, 15], [15, H - 15], [W - 15, H - 15]]) drill(x, y, 4);
drill(W / 2, H / 2, 15);

// asola 30×10 (capsula: box centrale + due semicerchi) sotto il foro centrale
const SL = 30, SR = 5, sx = W / 2 - SL / 2, sy = 14;
{
  const box = new oc.BRepPrimAPI_MakeBox_2(new oc.gp_Pnt_3(sx, sy - SR, -1), SL, 2 * SR, T + 2).Shape();
  const cut = new oc.BRepAlgoAPI_Cut_3(shape, box);
  cut.Build();
  shape = cut.Shape();
}
drill(sx, sy, SR);
drill(sx + SL, sy, SR);

// --- scrittura STEP ---
const writer = new oc.STEPControl_Writer_1();
// individua il nome del metodo Transfer in questo build
const wproto = [];
for (let p = Object.getPrototypeOf(writer); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
  wproto.push(...Object.getOwnPropertyNames(p));
}
console.log('writer API:', wproto.filter((m) => /transfer|write/i.test(m)).join(', '));
const mode = oc.STEPControl_StepModelType.STEPControl_AsIs;
let ok = false;
for (const args of [[shape, mode, true], [shape, mode], [shape, mode, true, undefined]]) {
  for (const m of ['Transfer_1', 'Transfer']) {
    if (typeof writer[m] !== 'function') continue;
    try { writer[m](...args); ok = true; break; } catch (e) { /* prova la prossima firma */ }
  }
  if (ok) break;
}
if (!ok) throw new Error('nessuna firma Transfer funzionante');
const name = '/out.step';
for (const m of ['Write_1', 'Write']) {
  if (typeof writer[m] !== 'function') continue;
  try { writer[m](name); ok = true; break; } catch (e) { ok = false; }
}
const data = oc.FS.readFile(name, { encoding: 'utf8' });
await mkdir(fileURLToPath(new URL('../samples/cad/', import.meta.url)), { recursive: true });
await writeFile(out, data);
console.log(`${out}: ${data.length} byte — piastra ${W}×${H}×${T}, 5 fori + 1 asola`);
