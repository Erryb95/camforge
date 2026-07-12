// @ts-check
// Registro dei loader: estensione file -> parser che produce uno SceneModel.
// Aggiungere un formato = registrare un loader. Il resto dell'app non cambia.

/** @type {Map<string, {name:string, parse:(text:string, fileName:string)=>import('./model.js').SceneModel}>} */
const loaders = new Map();

/** @type {{name:string, parse:Function}|null} loader usato per estensioni sconosciute */
let fallback = null;

/**
 * @param {string[]} extensions  estensioni senza punto, minuscole (es. ['nc','gcode'])
 * @param {{name:string, parse:Function}} loader
 * @param {{isFallback?:boolean}} [opts]
 */
export function registerLoader(extensions, loader, opts = {}) {
  for (const ext of extensions) loaders.set(ext.toLowerCase(), /** @type {any} */(loader));
  if (opts.isFallback) fallback = loader;
}

/** Estensioni note (per l'input file). */
export function knownExtensions() {
  return [...loaders.keys()];
}

/**
 * Sceglie il loader in base all'estensione e parsa il testo.
 * @param {string} fileName
 * @param {string} text
 * @returns {{model: import('./model.js').SceneModel, usedFallback: boolean}}
 */
export function parseFile(fileName, text) {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const loader = loaders.get(ext);
  if (loader) return { model: loader.parse(text, fileName), usedFallback: false };
  if (fallback) return { model: /** @type {any} */(fallback).parse(text, fileName), usedFallback: true };
  throw new Error(`Nessun loader per l'estensione ".${ext}"`);
}
