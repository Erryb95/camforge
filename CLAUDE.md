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
  loaders/nc/         parser G-code + dialetto laser tubo → SceneModel  [fase 1 ✓]
  loaders/alma/       AlmaCAM XML .cn/.ctd (polilinee 3D)               [fase 1 ✓]
  loaders/dxf/        [fase 2 - da fare, dxf-parser vendorizzato]
  loaders/dwg/        [fase 3 - da fare, libredwg-web WASM]
  loaders/step/       [fase 3 - da fare, occt-import-js + renderer 3D]
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

Fuori scope (avvisato): compensazione raggio G41/G42, origini G54–G59,
sottoprogrammi M98/M99, macro `#`. I `.pgm` (altro controllo, con espressioni
`X(kine_x)`) passano dal fallback NC: caricano con avvisi, dialetto da rifinire.
Gli `.atd` (ActTubes XML) non sono ancora supportati.

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
