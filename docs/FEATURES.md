# CAD/CAM Viewer LGE — Feature implementate

> Inventario completo dello stato attuale del progetto.
> Stack: **web zero-dipendenze a runtime** (ES module + Canvas/WebGL, tutto vendorizzato offline) · impacchettabile come **portable .exe** (Electron) o servito da `localhost:8123`.
> Dimensione: **~8.500 LOC** in 57 moduli · **134 test automatici** (verdi) · 21 file di test.

Legenda stato: ✅ completo e testato · 🟡 funzionante/parziale · 🔭 predisposto/roadmap.

---

## 1. Fresatura (FOCUS) 🎯

Motore di **asportazione materiale tri-dexel** (`src/sim/tridexel.js`, `materialsim5.js`) — 3 campi di dexel X/Y/Z, utensile cilindrico semi-infinito lungo l'asse, surface-nets per la mesh, calcolo volume.

| Feature | Stato | Dettaglio |
|---|---|---|
| Simulazione asportazione tri-dexel | ✅ | Il grezzo viene scavato mentre l'utensile avanza; forward-only (scrub indietro = reset). |
| **3 assi** | ✅ | Utensile verticale (+Z), pareti nette/undercut corretti. |
| **4-5 assi — orientamento dal G-code** | ✅ | Legge l'asse utensile da rotanti **A/B/C** o da **vettore** (EI/EJ/EK, TX/TY/TZ, NI/NJ/NK). |
| **4-5 assi — tavola basculante** | ✅ | Reso realistico: **il pezzo + la tavola si inclinano, il mandrino resta verticale** (macchine `table-rotary-tilting`). Rotazione tavola Q calcolata per segmento (Q·asse = +Z). |
| Solido di partenza = **stock minimo** | ✅ | Bounding-box del pezzo + sovrametallo, pezzo auto-orientato (dimensione minima → verticale). |
| **Sovrametallo parametrizzabile** | ✅ | Campo mm nella toolbar, rigenera lo stock. |
| **Slider risoluzione** tri-dexel | ✅ | Griglia da ~40 a ~180 celle (più alta = più dettaglio, più lenta); etichetta N×N×N live. |
| **Punta 3D che segue l'utensile** | ✅ | Mesh della fresa che avanza col percorso; trucioli (FX) al punto di taglio. |
| Punta sul **segmento focalizzato** | ✅ | Modalità "segmento sel.": clic/hover su una riga o segmento → la punta si posiziona lì. |
| **Selezione materiale** (16 reali) | ✅ | Al6061/7075, acc.1018/4140, inox304/316, ottone, rame, Ti6Al4V, ghisa, POM, ABS, PC, legno, MDF, GFK — con Vc, n. taglienti, rivestimento, geometria (dati Sandvik/Kennametal/Harvey/Onsrud). |
| **Punte realistiche per materiale** | ✅ | Mesh di fresa **generata** per materiale (n. lobi = n. taglienti, angolo d'elica, tip flat/ball/vee); il **rivestimento** dà il colore (TiN oro, AlTiN viola, DLC nero…). Non un ricolore. |

### Generazione fresatura da pezzo (CAM, non solo simulazione)
| Feature | Stato | Dettaglio |
|---|---|---|
| **Pezzo 3D → percorso di fresatura** (`generator/partmill.js`) | ✅ | STL/STEP/IGES → heightmap top-down → percorso **raster boustrophedon 3 assi** → lo stock rivela il pezzo. Auto-orienta, calcola stock minimo, diametro/stepover automatici. |
| **DXF 2D → lastra fresabile** (`generator/dxfmill.js`) | ✅ | Contorni chiusi (chaining per estremità) → esterno + fori → lastra estrusa (earcut) → fresatura 2.5D. |
| Bottoni distinti | ✅ | **⛏ Fresatura** = simula un NC esistente · **⚙ → Fresa** = genera il percorso dal pezzo e avvia la simulazione. |

---

## 2. Formati di input (loaders)

Tutti i loader sono zero-dipendenze o con WASM vendorizzato offline. Rilevati per estensione via `core/registry.js`.

| Formato | Stato | Loader / note |
|---|---|---|
| **G-code / NC** (`.nc .ngc .tap .cnc .gcode .iso .eia .din .txt`) | ✅ | Parser multi-dialetto (`loaders/nc/parser.js`): G0/G1/G2/G3 (archi), cicli foratura **G81-G83**, cambio utensile, unità in/mm, **espressioni LinuxCNC** (`#<var>`, `[espr]`, funzioni), assi 4/5 (A/B/C + vettori). |
| **Sinumerik** `.mpf` · dialetti tubo `.pgm` (Cutlite), `.cn`/`.ctd` (AlmaCAM LXD) | ✅ | `loaders/alma/` + parser NC; shield dei G-code macchina, metadati tubo (LT/DM/WW/WH), svolto. |
| **DXF** `.dxf` | ✅ | `loaders/dxf/` — LINE/ARC/CIRCLE/LWPOLYLINE/POLYLINE (bulge)/ELLIPSE/SPLINE/POINT/**INSERT** (blocchi ricorsivi), layer→utensile, unità $INSUNITS. |
| **DWG** `.dwg` | ✅ | `loaders/dwg/` via **libredwg** (WASM vendorizzato). |
| **STEP** `.stp/.step` · **IGES** `.igs/.iges` · **BREP** | ✅ | `loaders/step/` via **OpenCascade** (occt + occt-full WASM): B-rep esatto, tassellazione mesh, estrazione wire/spigoli. |
| **STL** `.stl` | ✅ | Binario + ASCII (`loaders/stl/`). |
| **ActTubes** `.atd` | ✅ | Metadati tubo (avviso Parasolid). |
| **Piega tubo** `.lra` / YBC | ✅ | `loaders/lra/` — programmi di piegatura (Y/B/C, LRA). |

---

## 3. Visualizzazione / Viewer 3D

Rendering su **three.js (WebGL)** vendorizzato offline (`render/three3d.js`), orchestrato da `render/viewer2d.js` (con fallback canvas-2D).

| Feature | Stato | Dettaglio |
|---|---|---|
| Motore WebGL (three.js) | ✅ | Tutte le viste su GPU; illuminazione, painter/z-order, materiali. |
| **Orbita attorno al pezzo** (turntable/arcball) | ✅ | Ruota intorno al centro del modello, non aggancia l'origine 0,0,0. |
| Viste **XY / XZ / YZ / 3D** | ✅ | 2D = camere ortografiche bloccate (pan+zoom); 3D = orbita. |
| Vista **Svolto (DEV)** tubo | ✅ | Superficie del tubo srotolata in piano (L asse, C perimetro) con guide delle facce. |
| **Solido con spessore** + toggle **Filo** (wireframe) | ✅ | Mesh solida ombreggiata o filo di ferro. |
| Griglia adattiva, gizmo assi | ✅ | Griglia di terra, terna X/Y/Z. |
| Colori per **utensile/layer** | ✅ | Palette per tool; toggle visibilità layer nel pannello Info. |
| **Hover / selezione** segmenti | ✅ | Evidenziazione, tooltip, sincronizzazione col pannello codice. |
| Marker **fori** (cicli foratura) | ✅ | Crocini 3D per-utensile. |
| Animazione **▶ Play** + slider avanzamento + velocità | ✅ | Marker posizione corrente; scia percorsa. |
| **Adatta alla vista** (F) | ✅ | Auto-fit del bounding box. |

---

## 4. Taglio (laser / plasma / waterjet / ossitaglio)

Motore kerf-swath (`sim/lasercut.js`, `lasertube.js`, `processes.js`).

| Feature | Stato | Dettaglio |
|---|---|---|
| **Taglio lamiera** | ✅ | Kerf attraverso lo spessore (offset + boolean via **Clipper**), estrusione, **separazione dei pezzi** che si staccano/cadono, telaio-sfrido. |
| **Taglio tubo** | ✅ | Svolto (u,v) → wrap sulla parete del tubo; troncatura = stacco assiale del segmento. |
| **Multi-processo** | ✅ | Laser/plasma/waterjet/ossitaglio: kerf ed **effetti (FX)** diversi (bagliore caldo+scintille, getto freddo waterjet, ecc.). |
| **Testa che segue** | ✅ | Modello STL della testa laser posizionato/orientato sul punto di taglio. |

---

## 5. Piegatura tubo (bending)

| Feature | Stato | Dettaglio |
|---|---|---|
| Ricostruzione **pezzo piegato** da LRA/YBC | ✅ | `core/bend.js` (K-factor/BA/LRA↔XYZ) + `sim/tubebend.js` (foldCenterline, mesh del tubo). |
| **Animazione della piega** | ✅ | Barra dritta → pezzo finito, interpolata sull'avanzamento. |

---

## 6. Generatori CAM & Post-processor

| Feature | Stato | Dettaglio |
|---|---|---|
| **STEP → NC** (`generator/step2nc.js`, `tubeNc.js`) | ✅ | Tubo → dialetto **Cutlite**, piastra → **GRBL**; asole/slot da wire B-rep, sequenza front→feature→back, lead-in. Bottone **⚙ → NC** nel viewer + download. |
| **Pezzo → fresatura** / **DXF → fresatura** | ✅ | (vedi §1). |
| **Post-processor** (`generator/post/gcode.js`) | ✅ | IR toolpath → post **LinuxCNC / GRBL / Cutlite**; riferimenti FreeCAD/kiri:moto in `vendor/reference`. |
| Estrazione **feature** (fori/asole) | 🟡 | `generator/features.js` — slot/hole da wire. |

---

## 7. UI / UX

| Feature | Stato | Dettaglio |
|---|---|---|
| Pannello **Codice** con evidenziazione sintassi G-code | ✅ | Virtualizzato; **ricerca** (Ctrl+F) con navigazione match. |
| Sincronizzazione **codice ↔ 3D** | ✅ | Clic sulla riga → evidenzia il segmento (e viceversa). |
| Pannello **Info/Statistiche** | ✅ | File, unità, n. segmenti/fori, ingombro, lunghezze in lavoro/rapido, tempo stimato, utensili/layer, avvisi. |
| **Drag & drop** file + Apri + Demo | ✅ | |
| Barra di stato (coordinate, zoom, conteggi, unità) | ✅ | |
| Toggle Rapidi / Fori | ✅ | Mostra/nascondi G0 e punti foratura. |

---

## 8. App desktop (Electron)

| Feature | Stato | Dettaglio |
|---|---|---|
| **Portable .exe** offline | ✅ | Riavvia in-process lo stesso static server della web app; codice condiviso (nessuna duplicazione). Build `npm run dist:portable`. |
| Installer NSIS | ✅ | In alternativa al portable. |
| Associazioni file (nc/dxf/dwg/step/igs…) | ✅ | |
| **Controllo 3D con le mani** (webcam) | 🟡 | `hands/handtracking.js` via MediaPipe Hand Landmarker (solo desktop): palmo→orbita, pinch→zoom. |

---

## 9. Qualità / Architettura

- **134 test automatici** (`node --test`) su parser, motori sim, generatori, post, offset, tri-dexel, bend, ecc.
- **Snapshot renderer headless** (`tools/render-snapshot.mjs`) per verifica immagini senza browser.
- **Zero dipendenze a runtime**: three.js, OpenCascade, libredwg, earcut, Clipper, MediaPipe — tutti **vendorizzati** in `vendor/` (funziona offline, anche nel portable).
- Documentazione di supporto in `docs/` (business plan, ricerca di mercato, reverse-engineering dialetti, simulazione).

---

## 10. Non ancora fatto / roadmap 🔭

| Area | Stato |
|---|---|
| **Tornitura** (stock removal dedicato) | 🔭 I file NC tornio (`samples/turning/`: G70/71/72, G76 filettatura, gole) **si caricano e si animano come percorso**, ma manca la simulazione di asportazione del solido di rivoluzione. |
| **Mill-turn** | 🔭 Roadmap. |
| Anti-collisione / verifica DFM | 🔭 |
| Attenuazione percorso "futuro" durante il Play in 3D | 🔭 (marker + scavo bastano oggi). |
| File NC 5-assi con **vettore** reale | 🟡 Parser pronto (TX/TY/TZ…); i 3 file demo sono rotanti A/C, B/C (LinuxCNC). |

---

*Ultimo aggiornamento: build portable **v0.6.0** (three.js + fresatura 4-5 assi a tavola basculante + punte per materiale + DXF/IGES fresabili).*
