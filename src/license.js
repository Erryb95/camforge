// @ts-check
// Gating FREE / PRO con LICENZE FIRMATE (ECDSA P-256, verifica OFFLINE via WebCrypto).
//
// Modello:
//   FREE = viewer + simulazione + ANTEPRIMA del G-code (vedi tutto funzionare).
//   PRO  = EXPORT (download G-code QtPlasmaC + material file).
//
// Anti-crack — cosa fa e cosa NON può fare (onestà tecnica):
//   • La licenza è un TOKEN FIRMATO con una chiave PRIVATA che possiedi solo tu.
//     L'app la verifica offline con la chiave PUBBLICA qui sotto ⇒ NESSUN keygen può
//     produrre una chiave valida (falsificare una firma ECDSA è impossibile). È la
//     difesa più importante: elimina keygen e crack "genera-chiave".
//   • La chiave è legata a EMAIL + PIANO + SCADENZA: una chiave trapelata è
//     tracciabile e, se abbonamento, SCADE da sola.
//   • Lo stato "verificato" vive IN MEMORIA (non un booleano su disco da ribaltare)
//     e la firma viene RI-verificata ad ogni export.
//   • NON è invulnerabile: resta codice client. Chi sa usare i DevTools può patchare
//     l'app in locale ogni sessione. Per un tool di nicchia a basso prezzo va bene:
//     il target (officine) paga; l'obiettivo è alzare l'asticella + zero keygen.
//   • Precisazione onesta: "zero keygen" vale per LA TUA distribuzione. Chi si rifà una
//     copia dell'app sostituendo PUBLIC_JWK con una propria chiave può auto-firmarsi le
//     licenze — ma sblocca solo il SUO fork, non i tuoi clienti: è la stessa cosa che
//     patchare l'app. Contro il resto (patch a runtime) catturiamo le primitive
//     WebCrypto originali al load, così non basta un 'crypto.subtle.verify=()=>true'.

const LS_KEY = 'camforge.license';   // conserva il TOKEN firmato, non un flag
const PREFIX = 'CF1-';               // marcatore di formato/versione

/** Chiave PUBBLICA di verifica (generata da tools/license-keygen.mjs). Sta nel codice
 *  senza rischi: serve solo a VERIFICARE le firme, non a crearle. */
export const PUBLIC_JWK = { kty: 'EC', crv: 'P-256', x: 'YcxmXHs6VTGANUy9NExl1-ywgSo5WU_EMtj1Ej0Gwy4', y: 'YiDbNN3z8Zjy6tSdZinFUf7gRCAioN0Rx333be6xrzw' };

export const PRICING_URL = '/pricing.html';

// Stato IN MEMORIA. `verified` NON è persistito: forgiare localStorage non basta,
// perché a ogni avvio (e a ogni export) la firma viene ri-controllata da zero.
const state = { token: '', claims: /** @type {null|Claims} */ (null), verified: false };
/** @typedef {{email:string, plan:string, exp:number|null, id:string}} Claims */

// Cattura le primitive WebCrypto REALI al caricamento del modulo (prima che l'utente
// possa aprire la console): un 'crypto.subtle.verify = () => true' a runtime non intacca
// la verifica, perché continuiamo a chiamare la funzione nativa originale.
const _subtle = (typeof crypto !== 'undefined' && crypto.subtle) || null;
const _verify = _subtle ? _subtle.verify.bind(_subtle) : null;
const _importKey = _subtle ? _subtle.importKey.bind(_subtle) : null;

const importPub = (jwk) => _importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
let _pubKey = null;
async function pubKey() { if (!_pubKey) _pubKey = await importPub(PUBLIC_JWK); return _pubKey; }

const b64uToBytes = (s) => {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s), a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
};

/**
 * Verifica crittografica OFFLINE di un token licenza. Formato:
 *   CF1-<base64url(payloadJSON)>.<base64url(firma raw r||s, 64 byte)>
 * payloadJSON = { v, email, plan:'monthly'|'lifetime', exp:epochSec|null, id }
 * @param {string} token
 * @param {object} [pubJwk]  chiave pubblica alternativa (solo per test); default = quella di produzione
 * @returns {Promise<{valid:boolean, claims?:Claims, reason?:string}>}
 */
export async function verifyKey(token, pubJwk) {
  try {
    const t = String(token || '').trim();
    if (!t.startsWith(PREFIX)) return { valid: false, reason: 'formato' };
    const body = t.slice(PREFIX.length);
    const dot = body.indexOf('.');
    if (dot < 1) return { valid: false, reason: 'formato' };
    const payloadBytes = b64uToBytes(body.slice(0, dot));
    const sig = b64uToBytes(body.slice(dot + 1));
    if (sig.length !== 64) return { valid: false, reason: 'firma' };   // P-256 raw = 64 byte
    if (!_verify) return { valid: false, reason: 'nocrypto' };          // contesto non sicuro (no WebCrypto)
    const key = pubJwk ? await importPub(pubJwk) : await pubKey();
    const ok = await _verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, payloadBytes);
    if (!ok) return { valid: false, reason: 'firma' };
    const claims = JSON.parse(new TextDecoder().decode(payloadBytes));
    if (!claims || !claims.email || !claims.plan) return { valid: false, reason: 'payload' };
    if (claims.exp && claims.exp * 1000 < Date.now()) return { valid: false, reason: 'scaduta', claims };
    return { valid: true, claims };
  } catch { return { valid: false, reason: 'errore' }; }
}

/** Attiva una licenza incollata: la verifica; se valida la salva e sblocca l'export.
 * @param {string} token @returns {Promise<{valid:boolean, claims?:Claims, reason?:string}>} */
export async function activate(token) {
  const r = await verifyKey(token);
  if (r.valid && r.claims) {
    try { localStorage.setItem(LS_KEY, String(token).trim()); } catch { /* storage off */ }
    state.token = String(token).trim(); state.claims = r.claims; state.verified = true;
  }
  return r;
}

/** All'avvio: carica il token salvato e lo RI-verifica (firma + scadenza). */
export async function loadAndVerify() {
  let saved = '';
  try { saved = localStorage.getItem(LS_KEY) || ''; } catch { /* storage off */ }
  if (!saved) { state.token = ''; state.claims = null; state.verified = false; return false; }
  const r = await verifyKey(saved);
  state.token = saved; state.claims = r.claims || null; state.verified = !!r.valid;
  return state.verified;
}

/** Check sincrono (badge/UI): richiede che la firma sia già stata validata in questa
 *  sessione (state.verified, in memoria) e che la licenza non sia scaduta. */
export function isPro() {
  if (!state.verified || !state.claims) return false;
  if (state.claims.exp && state.claims.exp * 1000 < Date.now()) return false;
  return true;
}

/** Gate FORTE per l'export: ri-esegue la verifica crittografica del token salvato ad
 *  ogni chiamata (non si fida di alcun flag). @returns {Promise<boolean>} */
export async function requireProNow() {
  let tok = state.token;
  if (!tok) { try { tok = localStorage.getItem(LS_KEY) || ''; } catch { /* off */ } }
  const r = await verifyKey(tok);
  state.verified = !!r.valid;
  if (r.claims) state.claims = r.claims;
  return isPro();
}

/** Info licenza per la UI (o null se Free). */
export function licenseInfo() {
  if (!isPro() || !state.claims) return null;
  return { email: state.claims.email, plan: state.claims.plan, exp: state.claims.exp };
}

/** Torna Free (rimuove il token). */
export function deactivate() {
  try { localStorage.removeItem(LS_KEY); } catch { /* off */ }
  state.token = ''; state.claims = null; state.verified = false;
}
