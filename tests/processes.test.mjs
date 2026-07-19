// Verifica il selettore di PROCESSO di taglio (laser/plasma/waterjet/ossitaglio):
// il modello dati e che il kerf del processo arrivi davvero al motore, su un file
// plasma REALE (LinuxCNC PlasmaC). Stessa primitiva del taglio laser, kerf diverso.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNC } from '../src/loaders/nc/parser.js';
import { LaserSheetSim } from '../src/sim/lasercut.js';
import { CUT_PROCESSES, processById, DEFAULT_PROCESS } from '../src/sim/processes.js';

test('processi: 4 processi, kerf laser < waterjet < plasma < ossitaglio, fallback su ignoto', () => {
  assert.equal(CUT_PROCESSES.length, 4);
  assert.deepEqual(CUT_PROCESSES.map((p) => p.id), ['laser', 'plasma', 'waterjet', 'oxyfuel']);
  assert.ok(processById('laser').kerf < processById('waterjet').kerf);
  assert.ok(processById('waterjet').kerf < processById('plasma').kerf);
  assert.ok(processById('plasma').kerf < processById('oxyfuel').kerf);
  assert.equal(processById('boh'), DEFAULT_PROCESS);              // ignoto → default (laser)
  for (const p of CUT_PROCESSES) assert.ok(p.fx && p.label);      // ogni processo ha effetto+etichetta
});

test('il kerf del processo arriva al motore di taglio (file plasma reale)', async () => {
  const f = join(dirname(fileURLToPath(import.meta.url)), '..', 'samples', 'cut', 'plasma_wrench.ngc');
  if (!existsSync(f)) return;                                     // materiale di test locale
  const model = parseNC(readFileSync(f, 'utf8'), 'plasma_wrench.ngc');
  const sim = new LaserSheetSim(model, { kerf: processById('plasma').kerf, thickness: 4 });
  assert.equal(sim.kerf, 1.5, 'il kerf plasma deve arrivare al sim');
  await sim.precompute();
  assert.ok(sim.ok, 'la simulazione plasma deve essere pronta');
});
