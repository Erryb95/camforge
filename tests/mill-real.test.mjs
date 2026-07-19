// Validazione FRESATURA su PEZZI REALI (samples/mill/, scaricati da GitHub).
// Ancora la verifica a dati veri, non sintetici: per ogni pezzo controlla che
//  (1) il GREZZO (carve 0) produca un solido visibile (mesh non vuota) — regressione
//      del bug "blocco pieno invisibile" (surface nets senza facce di bordo);
//  (2) il volume sia monotòno NON crescente con l'avanzamento (verso GIUSTO);
//  (3) a fine lavorazione sia stato rimosso materiale reale.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseNC } from '../src/loaders/nc/parser.js';
import { MaterialSim5 } from '../src/sim/materialsim5.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'samples', 'mill');

// pezzi veri veloci da simulare (i più grossi tball/mjolnir_eye restano nel viewer)
const PARTS = ['cds.ngc', 'mjolnir_contour.cnc', 'bear.nc'];

for (const file of PARTS) {
  test(`pezzo reale ${file}: grezzo visibile + asportazione nel verso giusto`, (t) => {
    const path = join(dir, file);
    if (!existsSync(path)) { t.skip(`${file} assente (materiale di test locale)`); return; }
    const model = parseNC(readFileSync(path, 'utf8'), file);
    const total = model.segments.reduce((a, s) => a + (s.len || 0), 0);
    assert.ok(total > 0, 'nessun percorso');

    // (1) GREZZO: la mesh a carve 0 deve avere triangoli (non invisibile)
    const raw = new MaterialSim5(model, { cellsTarget: 46 });
    raw.carveTo(0);
    const rawMesh = raw.mesh();
    assert.ok(rawMesh.indices.length >= 3, `grezzo invisibile: ${rawMesh.indices.length / 3} tri`);
    const v0 = raw.td.solidVolume();
    assert.ok(v0 > 0, 'volume grezzo nullo');

    // (2) monotòno non crescente
    let prev = Infinity;
    const vols = [];
    for (const pct of [0, 40, 75, 100]) {
      const sim = new MaterialSim5(model, { cellsTarget: 46 });
      sim.carveTo(pct === 100 ? null : total * pct / 100);
      const v = sim.td.solidVolume();
      vols.push(Math.round(v));
      assert.ok(v <= prev + Math.max(1, v * 1e-4), `volume cresce a ${pct}%: ${v} > ${prev} [${vols}]`);
      prev = v;
    }
    // (3) materiale rimosso davvero
    assert.ok(vols[vols.length - 1] < vols[0] * 0.98, `nulla rimosso: ${vols}`);
  });
}
