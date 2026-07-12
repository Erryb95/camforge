// @ts-check
// Loader ActTubes (.atd) — SOLO METADATI.
// Il file contiene la geometria come BREP Parasolid (CDATA binario/testo
// proprietario Siemens): non è realisticamente parsabile qui. Esponiamo i
// parametri del tubo (lunghezza, sezione, materiale) e avvisiamo chiaramente.
// Le quote ActTubes sono in METRI: convertite in mm.

const param = (text, type) => {
  const m = new RegExp(`<PARAM TYPE="${type}">([^<]*)</PARAM>`).exec(text);
  return m ? m[1].trim() : null;
};

/**
 * @param {string} text
 * @param {string} [fileName]
 * @returns {import('../../core/model.js').SceneModel}
 */
export function parseAtd(text, fileName = '') {
  /** @type {Record<string, any>} */
  const meta = { dialect: 'ActTubes' };
  /** @type {string[]} */
  const listing = ['File ActTubes (.atd) — distinta master del tubo'];

  const num = (type, scale = 1000) => {
    const v = param(text, type);
    return v !== null && !Number.isNaN(parseFloat(v)) ? parseFloat(v) * scale : null;
  };

  const length = num('LENGTH');
  const diameter = num('DIAMETER');
  const thickness = num('THICKNESS');
  const material = param(text, 'MATERIAL');
  const id = param(text, 'ID');
  const typeKey = param(text, 'TYPE_KEY');

  if (length) { meta.tubeLength = length; listing.push(`Lunghezza: ${length} mm`); }
  if (diameter) { meta.tubeDiameter = diameter; listing.push(`Diametro: ${diameter} mm`); }
  if (thickness) listing.push(`Spessore: ${thickness} mm`);
  if (material) listing.push(`Materiale: ${material}`);
  if (id) { meta.tubeName = id; listing.push(`ID: ${id}`); }
  if (typeKey) listing.push(`Sezione: ${typeKey}`);

  const nBrep = (text.match(/<BREP>/g) || []).length;

  return {
    name: fileName,
    program: id,
    units: 'mm',
    segments: [],
    drillPoints: [],
    warnings: [{
      line: 1,
      msg: `Geometria non visualizzabile: il file contiene ${nBrep} solidi in formato `
        + 'Parasolid BREP (kernel proprietario). Sono mostrati solo i metadati del tubo; '
        + 'per il percorso usare il .nc/.pgm o il .cn AlmaCAM corrispondente.',
    }],
    rawLines: listing,
    meta,
    bounds: null,
    boundsFeed: null,
    stats: { feedLen: 0, rapidLen: 0, timeMin: null, tools: [] },
  };
}
