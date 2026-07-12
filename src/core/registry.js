// @ts-check
// Registro dei loader: estensione file -> parser che produce uno SceneModel.
// Aggiungere un formato = registrare un loader. Il resto dell'app non cambia.

/** @type {Map<string, {name:string, parse:(text:string, fileName:string)=>import('./model.js').SceneModel}>} */
const loaders = new Map();

/** @type {{name:string, parse:Function}|null} loader usato per estensioni sconosciute */
let fallback = null;

/** @type {Set<string>} estensioni che richiedono lettura binaria (bytes, non testo) */
const binaryExts = new Set();

/**
 * @param {string[]} extensions  estensioni senza punto, minuscole (es. ['nc','gcode'])
 * @param {{name:string, parse:Function}} loader
 * @param {{isFallback?:boolean, binary?:boolean}} [opts]
 */
export function registerLoader(extensions, loader, opts = {}) {
  for (const ext of extensions) {
    loaders.set(ext.toLowerCase(), /** @type {any} */(loader));
    if (opts.binary) binaryExts.add(ext.toLowerCase());
  }
  if (opts.isFallback) fallback = loader;
}

/** Estensioni note (per l'input file). */
export function knownExtensions() {
  return [...loaders.keys()];
}

/** True se il formato va letto come byte (es. DWG binario). */
export function isBinaryExt(fileName) {
  return binaryExts.has((fileName.split('.').pop() || '').toLowerCase());
}

/**
 * Sceglie il loader in base all'estensione e parsa il contenuto (testo o byte).
 * Il model può essere un Promise (loader asincroni: STEP, DWG).
 * @param {string} fileName
 * @param {string|Uint8Array|ArrayBuffer} content
 * @returns {{model: import('./model.js').SceneModel|Promise<any>, usedFallback: boolean}}
 */
export function parseFile(fileName, content) {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const loader = loaders.get(ext);
  if (loader) return { model: loader.parse(content, fileName), usedFallback: false };
  if (fallback) return { model: /** @type {any} */(fallback).parse(content, fileName), usedFallback: true };
  throw new Error(`Nessun loader per l'estensione ".${ext}"`);
}
