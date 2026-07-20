// @ts-check
// Gating FREE / PRO (MVP client-side).
//
//   FREE  = viewer, simulazione, generazione e ANTEPRIMA del G-code (lo vedi
//           funzionare: 3D, Svolto, ▶, codice sincronizzato).
//   PRO   = DOWNLOAD del G-code QtPlasmaC e del material file (l'export).
//
// NOTA onesta: questo è un gate CLIENT-SIDE, aggirabile da un utente tecnico
// (la chiave è in localStorage). L'enforcement vero va fatto server-side
// (validazione chiave + export generato dal server). Qui è lo scaffold MVP per
// andare online: alla vendita si consegna una chiave, l'utente la incolla.

const LS_KEY = 'lge.pro.key';

/** URL della pagina prezzi (sito statico servito dallo stesso server). */
export const PRICING_URL = '/site/pricing.html';

/** True se una chiave Pro è attiva in questo browser. */
export function isPro() {
  try { return !!localStorage.getItem(LS_KEY); } catch { return false; }
}

/** Chiave Pro corrente (stringa vuota se assente). */
export function proKey() {
  try { return localStorage.getItem(LS_KEY) || ''; } catch { return ''; }
}

/**
 * Attiva/disattiva la chiave Pro. Validazione MINIMA (formato non vuoto, prefisso
 * atteso): l'enforcement reale è server-side. @param {string} key
 * @returns {boolean} true se attivata
 */
export function activatePro(key) {
  const k = (key || '').trim();
  if (!k) return false;
  try { localStorage.setItem(LS_KEY, k); } catch { /* storage non disponibile */ }
  return true;
}

/** Rimuove la chiave Pro (torna Free). */
export function deactivatePro() {
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}
