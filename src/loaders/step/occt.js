// @ts-check
// Caricatore di opencascade.js FULL (vendor/occt-full, OpenCascade completo in
// WASM, ~66 MB). Dà accesso alla topologia B-rep VERA (facce/spigoli/curve
// esatte), non solo la mesh di occt-import-js. Usato per l'estrazione esatta
// dei contorni di taglio e per il generatore NC.
//
// Note d'integrazione (build emscripten vecchio, OCCT pre-7.5):
//  - il glue è ESM ma usa globali CommonJS in Node (__dirname, require) → shim;
//  - Node 22 ha fetch globale e il glue proverebbe a fetchare il wasm → passiamo
//    il binario diretto via wasmBinary;
//  - TransferRoots() non ha Message_ProgressRange (aggiunto in OCCT 7.5).

/** @type {Promise<any>|null} */
let ocPromise = null;

export async function getOcctFull() {
  if (ocPromise) return ocPromise;
  ocPromise = (async () => {
    const glueUrl = new URL('../../../vendor/occt-full/opencascade.wasm.js', import.meta.url);
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      // browser: il glue carica il wasm via fetch/XHR relativo a locateFile
      const { default: initOC } = await import(glueUrl.href);
      return initOC({
        locateFile: (f) => (f.endsWith('.wasm') ? 'vendor/occt-full/opencascade.wasm.wasm' : f),
      });
    }
    // Node (tool/test): shim CommonJS + binario wasm diretto
    const { createRequire } = await import('node:module');
    const { fileURLToPath } = await import('node:url');
    const { readFile } = await import('node:fs/promises');
    const g = /** @type {any} */ (globalThis);
    if (!g.require) g.require = createRequire(import.meta.url);
    if (typeof g.__dirname === 'undefined') g.__dirname = fileURLToPath(new URL('../../../vendor/occt-full/', import.meta.url));
    const { default: initOC } = await import(glueUrl.href);
    const wasmPath = fileURLToPath(new URL('../../../vendor/occt-full/opencascade.wasm.wasm', import.meta.url));
    const wasmBinary = new Uint8Array(await readFile(wasmPath));
    return initOC({ wasmBinary, locateFile: (f) => f });
  })();
  return ocPromise;
}

/**
 * Legge un file STEP e restituisce la TopoDS_Shape.
 * @param {any} oc @param {string} stepText
 */
export function readStepShape(oc, stepText) {
  const name = '/in.step';
  oc.FS.writeFile(name, stepText);
  const reader = new oc.STEPControl_Reader_1();
  const status = reader.ReadFile(name);
  oc.FS.unlink(name);
  if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
    throw new Error(`STEP non leggibile (status ${status && status.value})`);
  }
  reader.TransferRoots();
  return reader.OneShape();
}

/** Itera tutte le sotto-shape di un tipo. @param {any} oc @param {any} shape @param {any} type */
export function* explore(oc, shape, type) {
  const exp = new oc.TopExp_Explorer_2(shape, type, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; exp.More(); exp.Next()) yield exp.Current();
}
