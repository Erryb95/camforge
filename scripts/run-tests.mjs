// Runner test portabile (zero-dip): enumera tests/*.test.mjs e li passa a
// `node --test`. Evita la dipendenza dal glob di --test (assente in Node 20) e
// dall'espansione glob della shell (diversa tra Windows/POSIX). Uso: node scripts/run-tests.mjs
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const testsDir = new URL('../tests/', import.meta.url);
const files = readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort()
  .map((f) => fileURLToPath(new URL(f, testsDir)));

if (!files.length) { console.error('nessun file di test in tests/'); process.exit(1); }

const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
