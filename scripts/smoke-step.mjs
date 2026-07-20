// Smoke-test: parseStep gira in Node headless? (occt WASM via createRequire)
import { readFileSync } from 'node:fs';
import { parseStep } from '../src/loaders/step/parser.js';

for (const rel of process.argv.slice(2)) {
  const url = new URL('../' + rel, import.meta.url);
  const buf = readFileSync(url);
  try {
    const model = await parseStep(buf, rel.split('/').pop());
    const segs = model.segments?.length ?? 0;
    const closed = (model.segments || []).filter((s) => s.pts && s.pts.length > 2
      && Math.hypot(s.pts[0].x - s.pts.at(-1).x, s.pts[0].y - s.pts.at(-1).y, s.pts[0].z - s.pts.at(-1).z) < 1e-3).length;
    console.log(`OK  ${rel}: segments=${segs}, chiusi=${closed}, tuboRilevato=${!!model.meta?.unrollAvailable}, mesh=${!!model.mesh}`);
  } catch (e) {
    console.log(`ERR ${rel}: ${e.message}`);
  }
}
