// CLI della pipeline STEP → NC (la logica è in src/generator/step2nc.js,
// condivisa col bottone "→ NC" del viewer).
//   piastra/2D : STEP → wire faccia top → toolpath (interni prima, lead-in,
//                nearest-neighbor) → post grbl|linuxcnc
//   tubo       : STEP → feature (sezione/fori/asole) → dialetto Cutlite
// Senza --post sceglie da sé (tubo lungo X → cutlite, altrimenti grbl).
// Uso:
//   node tools/step2nc.mjs <in.step> <out.nc> [--post grbl|linuxcnc|cutlite]
//        [--feed 3000] [--power 800] [--thickness 4] [--lead 2] [--check]
import { readFile, writeFile } from 'node:fs/promises';
import { stepToNc } from '../src/generator/step2nc.js';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
const opt = (name) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};
const num = (name) => (opt(name) !== undefined ? Number(opt(name)) : undefined);
if (files.length < 2) {
  console.error('uso: node tools/step2nc.mjs <in.step> <out.nc> [--post grbl|linuxcnc|cutlite] [--feed n] [--power n] [--thickness mm] [--lead mm] [--check]');
  process.exit(1);
}
const [input, output] = files;

const res = await stepToNc(await readFile(input, 'utf8'), {
  post: /** @type {any} */ (opt('post')),
  feed: num('feed'),
  power: num('power'),
  thickness: num('thickness'),
  lead: num('lead'),
  name: input.split(/[\\/]/).pop(),
});
console.log(`${res.kind}: ${res.info}`);

await writeFile(output, res.nc);
console.log(`${output}: ${res.nc.length} byte (post ${res.post})`);

if (args.includes('--check')) {
  const { parseNC } = await import('../src/loaders/nc/parser.js');
  const m = parseNC(res.nc, output.split(/[\\/]/).pop());
  const b = m.bounds;
  console.log(`verifica parser: ${m.segments.length} segmenti, bounds X[${b.min.x.toFixed(1)},${b.max.x.toFixed(1)}] Y[${b.min.y.toFixed(1)},${b.max.y.toFixed(1)}], avvisi: ${(m.warnings || []).length}`);
}
