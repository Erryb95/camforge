// LICENZE FIRMATE (ECDSA P-256) — il cuore anti-crack. Verifica che SOLO le chiavi
// firmate con la chiave privata giusta e non scadute vengano accettate, e che ogni
// tentativo di falsificazione fallisca. Usa una coppia EFFIMERA di test (la privata di
// produzione non è nel repo): verifyKey accetta una pub alternativa per i test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto as wc } from 'node:crypto';
import { verifyKey } from '../src/license.js';

const alg = { name: 'ECDSA', namedCurve: 'P-256' };
const sigAlg = { name: 'ECDSA', hash: 'SHA-256' };
const testPair = await wc.subtle.generateKey(alg, true, ['sign', 'verify']);
const attackerPair = await wc.subtle.generateKey(alg, true, ['sign', 'verify']);
const testPub = await wc.subtle.exportKey('jwk', testPair.publicKey);
const b64u = (b) => Buffer.from(b).toString('base64url');
const nowSec = () => Math.floor(Date.now() / 1000);

async function mint(payload, priv = testPair.privateKey) {
  const pb = new TextEncoder().encode(JSON.stringify(payload));
  const sig = new Uint8Array(await wc.subtle.sign(sigAlg, priv, pb));
  return 'CF1-' + b64u(pb) + '.' + b64u(sig);
}

test('accetta una chiave valida (lifetime) firmata dalla chiave giusta', async () => {
  const tok = await mint({ v: 1, email: 'shop@ex.com', plan: 'lifetime', exp: null, id: '1' });
  const r = await verifyKey(tok, testPub);
  assert.equal(r.valid, true);
  assert.equal(r.claims.email, 'shop@ex.com');
  assert.equal(r.claims.plan, 'lifetime');
});

test('accetta un abbonamento non ancora scaduto', async () => {
  const tok = await mint({ v: 1, email: 'a@b.com', plan: 'monthly', exp: nowSec() + 3600, id: '2' });
  assert.equal((await verifyKey(tok, testPub)).valid, true);
});

test('RIFIUTA una licenza scaduta', async () => {
  const tok = await mint({ v: 1, email: 'a@b.com', plan: 'monthly', exp: nowSec() - 3600, id: '3' });
  const r = await verifyKey(tok, testPub);
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'scaduta');
});

test('RIFIUTA payload manomesso (upgrade a lifetime tenendo la vecchia firma)', async () => {
  const good = await mint({ v: 1, email: 'a@b.com', plan: 'monthly', exp: nowSec() + 3600, id: '4' });
  const sig = good.slice(4).split('.')[1];
  const evil = b64u(new TextEncoder().encode(JSON.stringify({ v: 1, email: 'a@b.com', plan: 'lifetime', exp: null, id: '4' })));
  const tampered = 'CF1-' + evil + '.' + sig;
  assert.equal((await verifyKey(tampered, testPub)).valid, false);
});

test('RIFIUTA una chiave firmata da un keygen (altra coppia di chiavi)', async () => {
  const tok = await mint({ v: 1, email: 'a@b.com', plan: 'lifetime', exp: null, id: '5' }, attackerPair.privateKey);
  assert.equal((await verifyKey(tok, testPub)).valid, false);
});

test('RIFIUTA firma casuale, garbage e il vecchio placeholder', async () => {
  const good = await mint({ v: 1, email: 'a@b.com', plan: 'lifetime', exp: null, id: '6' });
  const forged = 'CF1-' + good.slice(4).split('.')[0] + '.' + b64u(wc.getRandomValues(new Uint8Array(64)));
  assert.equal((await verifyKey(forged, testPub)).valid, false);
  assert.equal((await verifyKey('CF1-not-a-key', testPub)).valid, false);
  assert.equal((await verifyKey('PRO-12345', testPub)).valid, false);   // vecchio gate placeholder
  assert.equal((await verifyKey('', testPub)).valid, false);
});

test('la chiave di PRODUZIONE (default) rifiuta chiavi non firmate da essa', async () => {
  // una key firmata con la coppia di TEST non deve passare la verifica di default
  const tok = await mint({ v: 1, email: 'a@b.com', plan: 'lifetime', exp: null, id: '7' });
  assert.equal((await verifyKey(tok)).valid, false, 'la pub di produzione non deve validare chiavi di test');
});
