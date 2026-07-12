# CAD/CAM Viewer — LGE

Visualizzatore 2D di percorsi utensile da file NC/G-code (fase 1), pensato per
estendersi a DXF, DWG e STEP tramite loader modulari.

## Comandi

| Azione | Comando |
|---|---|
| Avvio server locale | `node server.mjs` → http://localhost:8123 |
| Test parser | `node --test tests/` |

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
  loaders/nc/         parser G-code → SceneModel   [fase 1 ✓]
  loaders/dxf/        [fase 2 - da fare, dxf-parser vendorizzato]
  loaders/dwg/        [fase 3 - da fare, libredwg-web WASM]
  loaders/step/       [fase 3 - da fare, occt-import-js + renderer 3D]
  render/viewer2d.js  canvas: griglia, pan/zoom, hit-test, simulazione
  ui/codePanel.js     lista codice virtualizzata, sync bidirezionale col viewer
  ui/statsPanel.js    ingombri, lunghezze, utensili (toggle), avvisi
samples/demo.nc       programma dimostrativo (caricato all'avvio)
tests/                golden test del parser (node:test, zero dipendenze)
```

**Regola d'oro**: i loader producono SOLO uno `SceneModel`; il renderer consuma
SOLO uno `SceneModel`. Aggiungere un formato = nuovo loader in `src/loaders/<fmt>/`
registrato con `registerLoader([...estensioni], {name, parse})`. Niente altro cambia.

## Parser NC — copertura fase 1

G0/G1/G2/G3 modali · piani G17/G18/G19 · G20/G21 · G90/G91 · archi I/J/K e R
(cerchi completi, eliche) · cicli G81–G83 + G80 · T/M6 · F · commenti `()` e `;` ·
N/O/% · M30. Tutto il resto genera un **avviso con numero di riga** (mai crash):
gli avvisi sono il punto di partenza per estendere il parser sui file reali del cliente.

Fuori scope (avvisato): compensazione raggio G41/G42, origini G54–G59,
sottoprogrammi M98/M99, macro `#`.

## Flusso di lavoro

1. I file NC reali dell'utente vanno copiati in `tests/fixtures/` e usati come golden test.
2. Dopo ogni modifica al parser: `node --test tests/`.
3. Verifica visiva: avviare il server e controllare la demo + file reali
   (con gli strumenti di preview: screenshot, console, ecc.).
4. Commit git dopo ogni feature verificata (l'utente traccia le modifiche via git).
