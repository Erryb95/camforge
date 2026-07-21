// UNA TANTUM: genera la coppia di chiavi ECDSA P-256 per firmare le licenze.
//   node tools/license-keygen.mjs
// Scrive la PRIVATE key in tools/license-private.jwk (GITIGNORATA — NON committarla,
// NON condividerla: chi ha questa chiave può generare licenze valide). Stampa la
// PUBLIC key (JWK) da incollare in src/license.js (PUBLIC_JWK). La public può stare
// nel codice: serve solo a VERIFICARE le firme, non a crearle.
import { webcrypto as wc } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PRIV = fileURLToPath(new URL('./license-private.jwk', import.meta.url));
if (existsSync(PRIV) && !process.argv.includes('--force')) {
  console.error(`La chiave privata esiste già: ${PRIV}\nRigenerarla INVALIDA tutte le licenze emesse. Usa --force per forzare.`);
  process.exit(1);
}

const pair = await wc.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const priv = await wc.subtle.exportKey('jwk', pair.privateKey);
const pub = await wc.subtle.exportKey('jwk', pair.publicKey);

writeFileSync(PRIV, JSON.stringify(priv, null, 2));
console.log(`✓ Chiave privata salvata (tienila al sicuro, è gitignorata): ${PRIV}\n`);
console.log('Incolla questo in src/license.js come PUBLIC_JWK:\n');
console.log('export const PUBLIC_JWK = ' + JSON.stringify({ kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y }) + ';');
