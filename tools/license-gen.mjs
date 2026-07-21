// Emette una LICENZA FIRMATA per un cliente (da lanciare dopo ogni vendita).
//   node tools/license-gen.mjs --email cliente@dominio.com --plan lifetime
//   node tools/license-gen.mjs --email cliente@dominio.com --plan monthly [--months 1]
//
// Stampa un token "CF1-…" da consegnare al cliente (che lo incolla in ⚡ Upgrade →
// Activate). La firma usa la chiave PRIVATA (tools/license-private.jwk) che possiedi
// solo tu ⇒ nessuno può generare licenze valide senza di essa.
//
// Automazione futura: si può richiamare questa logica da una funzione serverless
// agganciata al webhook "order.paid" di Polar per emettere la key in automatico.
import { webcrypto as wc } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PRIV = fileURLToPath(new URL('./license-private.jwk', import.meta.url));

// --- args -------------------------------------------------------------------
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    const nxt = process.argv[i + 1];
    args[k] = (nxt && !nxt.startsWith('--')) ? process.argv[++i] : true;
  }
}
const email = typeof args.email === 'string' ? args.email.trim() : '';
const plan = typeof args.plan === 'string' ? args.plan : 'lifetime';
const months = Number(args.months) > 0 ? Number(args.months) : 1;
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !['monthly', 'lifetime'].includes(plan)) {
  console.error('Uso: node tools/license-gen.mjs --email <email valida> --plan <monthly|lifetime> [--months N]');
  process.exit(1);
}
if (!existsSync(PRIV)) {
  console.error(`Chiave privata mancante: ${PRIV}\nGenerala una volta con: node tools/license-keygen.mjs`);
  process.exit(1);
}

// --- firma ------------------------------------------------------------------
const jwk = JSON.parse(readFileSync(PRIV, 'utf8'));
const key = await wc.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

const nowSec = Math.floor(Date.now() / 1000);
// monthly: validità = months × 31 giorni (copre ciclo di fatturazione + margine).
// Al rinnovo Polar riemetti una nuova key. lifetime: nessuna scadenza.
const exp = plan === 'monthly' ? nowSec + months * 31 * 86400 : null;
const payload = { v: 1, email, plan, exp, iat: nowSec, id: wc.randomUUID() };

const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
const sig = new Uint8Array(await wc.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, payloadBytes));

const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const token = 'CF1-' + b64u(payloadBytes) + '.' + b64u(sig);

console.log('\n✓ Licenza emessa\n');
console.log('  email :', email);
console.log('  piano :', plan, plan === 'monthly' ? `(scade ${new Date(exp * 1000).toISOString().slice(0, 10)})` : '(nessuna scadenza)');
console.log('  id    :', payload.id);
console.log('\n  Consegna al cliente questa chiave (⚡ Upgrade → Activate):\n');
console.log('  ' + token + '\n');
