// @ts-check
// Processi di TAGLIO 2D che condividono lo STESSO motore kerf-swath + separazione
// pezzi (LaserSheetSim / LaserTubeSim): laser, plasma, waterjet, ossitaglio.
// La fisica della simulazione è identica — cambiano solo la larghezza del KERF
// (solco), l'effetto visivo e l'etichetta. Kerf tipici (larghezza solco, mm):
//   laser 0.1–0.3 · waterjet abrasivo 0.8–1.5 · plasma 1–4 (HD ~1.5) · ossitaglio 1–3.
export const CUT_PROCESSES = [
  { id: 'laser', label: 'Laser', kerf: 0.2, fx: 'laser' },
  { id: 'plasma', label: 'Plasma', kerf: 1.5, fx: 'plasma' },
  { id: 'waterjet', label: 'Waterjet', kerf: 1.0, fx: 'waterjet' },
  { id: 'oxyfuel', label: 'Ossitaglio', kerf: 2.0, fx: 'oxy' },
];

export const DEFAULT_PROCESS = CUT_PROCESSES[0];

/** @param {string} id */
export function processById(id) { return CUT_PROCESSES.find((p) => p.id === id) || DEFAULT_PROCESS; }
