# CAD/CAM Viewer — LGE

Visualizzatore 2D di percorsi utensile da file NC/G-code (fase 1), pensato per
estendersi a DXF, DWG e STEP tramite loader modulari.

## Comandi

| Azione | Comando |
|---|---|
| Avvio server locale | `node server.mjs` → http://localhost:8123 |
| Test parser | `node --test "tests/*.test.mjs"` |
| Snapshot PNG headless | `node tools/render-snapshot.mjs <file> <out.png> [DEV\|XY\|XZ\|YZ] [w] [h]` |

Non c'è build: l'app è HTML + moduli ES nativi, si ricarica il browser e basta.

## Vincoli importanti

- **Zero dipendenze npm**: la cartella è sotto OneDrive; `node_modules` causa
  sync churn e lock. Librerie esterne future (dxf-parser, libredwg-web,
  occt-import-js) vanno **vendorizzate come singoli file** in `vendor/`.
- JavaScript con `// @ts-check` + JSDoc (niente TypeScript per evitare build).
- UI in italiano. Unità interne sempre **mm** (G20 convertito dal parser).

## Architettura

```
index.html            shell UI
server.mjs            server statico zero-dep (porta 8123)
src/
  core/model.js       SceneModel COMUNE: Segment, DrillPoint, Bounds, stats
  core/registry.js    estensione file → loader (con fallback)
  core/unroll.js      sviluppo "tubo svolto": perimetro sezione, unwrap, guide
  loaders/nc/         parser G-code + dialetti tubo (Adige .nc, .pgm)   [✓]
  loaders/alma/       AlmaCAM XML .cn/.ctd (polilinee 3D)               [✓]
  loaders/dxf/        DXF zero-dep: LINE/ARC/CIRCLE/LWPOLYLINE(bulge)/
                      POLYLINE/ELLIPSE/SPLINE(de Boor)/INSERT, layer     [✓]
  loaders/step/       occt-import-js (WASM): STEP/IGES/BREP → mesh solida
                      + spigoli sequenziati, parse ASINCRONO             [✓]
  loaders/dwg/        libredwg-web (WASM): DWG binario → entità → segmenti [✓]
  loaders/atd/        ActTubes: solo metadati (geometria = Parasolid)    [✓]
  loaders/cad/        geometry.js (tessellazione), sequence.js (ordine
                      taglio), tube3d.js (tubo solido + wrap)            [✓]
  render/viewer2d.js  canvas: griglia, pan/zoom, hit-test, simulazione
  ui/codePanel.js     lista codice virtualizzata, sync bidirezionale col viewer
  ui/statsPanel.js    ingombri, lunghezze, utensili (toggle), avvisi
samples/demo.nc       programma dimostrativo (caricato all'avvio)
tests/                golden test del parser (node:test, zero dipendenze)
tools/render-snapshot.mjs  render PNG headless (verifica visiva senza browser)
```

**Regola d'oro**: i loader producono SOLO uno `SceneModel`; il renderer consuma
SOLO uno `SceneModel`. Aggiungere un formato = nuovo loader in `src/loaders/<fmt>/`
registrato con `registerLoader([...estensioni], {name, parse})`. Niente altro cambia.

## Parser NC — copertura fase 1

G0/G1/G2/G3 modali · piani G17/G18/G19 · G20/G21 · G90/G91 · archi I/J/K e R
(cerchi completi, eliche) · cicli G81–G89 + G80 · T/M6 · F · commenti `()` e `;` ·
N/O/% · M30. Tutto il resto genera un **avviso con numero di riga** (mai crash):
gli avvisi sono il punto di partenza per estendere il parser sui file reali del cliente.

**Dialetto laser tubo (file .nc del cliente, stile Adige/BLM)**: header `LT<>`
`DM<>` `WW<>/WH<>` → metadati tubo nel pannello Info · `KG10` = rapido one-shot ·
parametri macchina multi-lettera (ZX, KA, EP…) ignorati senza avvisi · assi
ausiliari `X_1=` · direttive `!...!` e righe `--LN/--GOTOLN` saltate.

## Vista "Svolto" (tubo sviluppato in piano)

Attiva automaticamente per i file con dati tubo. u = `X_1` (carro, modale) + `X`;
v = ascissa perimetrale di `(Y, Z)` sulla sezione (v=0 centro faccia superiore).
**Fatti verificati sui file reali — non reinterpretarli:**
- Y/Z sono GIÀ nel sistema pezzo (nella troncatura `(Y,Z)` percorre esattamente
  il perimetro della sezione). `P` è solo cinematica macchina: riapplicarla
  alla geometria RADDOPPIA lo sviluppo (bug già commesso e corretto).
- `P` è modulo 360 nel programma: il parser lo riporta sul giro più vicino
  (0→357 = −3°). Registrato su `seg.rot0/rot1` solo per il tooltip.
- L'unwrap perimetrale si azzera a ogni rapido (NC) / nuova curva (AlmaCAM),
  altrimenti i giri completi dei contorni successivi si accumulano.
- Una troncatura corretta spazza ~1 perimetro (196 mm per il 73×25): i test
  reali lo verificano come regressione.
AlmaCAM: sezione tonda/rettangolare autorilevata dai raggi dei punti.

## Vista 3D orbitale, solido e sequenza di taglio

- **Vista 3D** (viewer2d, modo '3D'): proiezione ortografica azimut/elevazione
  Z-up, orbita su trascinamento (Shift+trascina = pan), griglia di terra, gizmo.
- **Solido/Filo** (`model.mesh` = {positions, indices, triTool}): rendering
  ombreggiato painter's + luce a due facce, toggle in toolbar (solo 3D + mesh).
  Mesh da: occt (STEP/IGES) oppure `tube3d.buildTubeMesh` (tubi NC/pgm/alma).
- **Tubo solido**: `cad/tube3d.js` costruisce cilindro/cassone lungo l'asse e
  avvolge i contorni via `seg.tubePts`. FATTO CHIAVE: (Y,Z) sono già coordinate
  di sezione → punto 3D = {x:u_asse, y, z}. NC: asse=u(=X_1+X), sez=(Y,Z).
  Alma: asse=Z, sez=(X,Y) → tubePts {x:z, y:x, z:y}.
- **Sequenza taglio** (`cad/sequence.js`): STEP/IGES/DWG non hanno ordine di
  taglio → si concatenano gli spigoli in contorni e si ordinano da un'estremità
  (asse principale) per nearest-neighbor. Riduce il salto totale ~70-100×.
  NON applicare a NC/pgm/alma: lì l'ordine del programma È la sequenza reale.
- Campioni auto-test committati: `samples/dwg/*.dwg` (v2000-2018, LibreDWG GPL),
  `samples/cad/cube.igs` (occt-import-js).

Fuori scope (avvisato): compensazione raggio G41/G42, origini G54–G59,
sottoprogrammi M98/M99, macro `#`.

**Dialetto .pgm** (secondo controllo tubo): un G-code ≥100 sulla riga la rende
una DIRETTIVA macchina — mai un moto, e M/T/F lì sopra sono parametri della
macro (es. `G510 A1 M2 …` NON è fine programma). `G2292 Y… V… Z… W… U…` dà
bounding box sezione e lunghezza tubo (`profileAuto`: tondo se i punti reali
sono a raggio costante, altrimenti rettangolo). Rotazione = parola `C`
(equivalente di `P` Adige), coordinate già nel sistema pezzo anche qui.

**STEP**: `vendor/occt/` contiene occt-import-js (UMD + WASM, ~7.7 MB, niente
CDN). Il `parse` è asincrono (registry/main gestiscono il Promise); in Node il
`require` dell'UMD funziona SOLO grazie a `vendor/occt/package.json`
(`type: commonjs`) — non rimuoverlo. La mesh diventa wireframe di spigoli
caratteristici (bordi liberi + diedri >25°); ogni solido = un "utensile"
spegnibile. **.atd** (ActTubes): geometria Parasolid non parsabile → solo
metadati tubo + avviso.

## Automazione test visivi

- `http://localhost:8123/?file=CAD-CAM/CAD-CAM/<nome>` carica un file servito
  (la cartella `CAD-CAM/` con i file reali è ignorata da git ma servita in locale).
- Hook console: `window.__loadText(nome, testo)` e `window.__getModel()`.
- Nota preview: fare screenshot con l'animazione in play va in timeout;
  mettere in pausa o impostare lo slider via `input` event prima di catturare.

## Flusso di lavoro

1. I file NC reali dell'utente vanno copiati in `tests/fixtures/` e usati come golden test.
2. Dopo ogni modifica al parser: `node --test tests/`.
3. Verifica visiva: avviare il server e controllare la demo + file reali
   (con gli strumenti di preview: screenshot, console, ecc.).
4. Commit git dopo ogni feature verificata (l'utente traccia le modifiche via git).
