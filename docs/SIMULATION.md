# Simulazione asportazione materiale (stile CutViewer)

*Aggiunta 2026-07-13. Ricerca+decisione: workflow multi-agente (6 filoni + verifica licenze), sintesi architetturale.*

## Origine e licenze
CutViewer è software **proprietario** (nessun sorgente). Ricerca OSS: i motori più maturi (`aewallin/cutsim` GPL-3, `CAMotics`/OpenSCAM GPL-2) sono **solo riferimento concettuale**. Base tecnica adottata (permissiva): la Z-map di `tmpvar/gcode-raymarch-sim` (**MIT**, `depthTexture=max(...)`), riscritta per CPU/Canvas 2D. Target per il 4/5 assi: tri-dexel di `bernhardmgruber/tridexel` (**BSL-1.0**). Manifold-3d (Apache-2.0, WASM) = fallback booleano di riserva.

## Tecnica: Z-map (heightmap a valore singolo)
Il 3-assi non ha undercut (asse utensile sempre +Z) → un campo di altezza `Z(x,y)` è la rappresentazione **esatta e sufficiente**, non un'approssimazione. Rimozione = `min` per nodo sotto l'impronta utensile (monotòno decrescente → intrinsecamente incrementale e **forward-only**: scrub all'indietro = reset + re-carve). Scelta vs dexel/voxel: memoria O(N²), carve O(1) per cella, e la Z-map triangola **direttamente** nel formato mesh già renderizzato.

## Moduli (`src/sim/`)
- **tool.js** — `makeTool` + `footprint(tool,d)` = sottoquota a distanza radiale (flat = 0 entro R; ball = `R−√(R²−d²)`; bull = piatto + raccordo).
- **heightmap.js** — `Heightmap` (quote ai NODI), `stamp` (impronta nella finestra XY dell'utensile, con dirty-box), `removedVolume`.
- **mesh.js** — `heightmapToMesh` → `{positions, indices, fresh, nTop}`: top (2 tri/cella) + pareti (skirt) + fondo; `fresh` marca i tri appena tagliati.
- **stock.js** — `stockFromModel`: bbox del taglio + margine + sovrametallo; risoluzione griglia clamp 40..220 celle/lato; `zTop`=maxZ+allowance, `zBottom`=minZ−0.5.
- **materialsim.js** — `MaterialSim`: cursore in mm lungo i segmenti (rapidi **contati** ma non tagliano), `carveTo(len)` incrementale, `detectTool` dai commenti (es. "10mm ball nose" → ball Ø10), `mesh()`.

## Default quando il G-code non li dichiara
Utensile: **flat Ø6** (o quanto letto dai commenti). Stock: bbox+margine+sovrametallo 2%. Il tutto sovrascrivibile.

## Integrazione viewer
- `viewer2d.js`: `state.stock` + `drawStock()` (materiale grigio metallico, tri `fresh` in tinta calda, re-sort painter su cambio orbita **o** nuovo carve via `stockVersion`); `setStock/clearStock/hasStock`. Lo stock ha precedenza sul solido in 3D.
- `main.js`: bottone **▧ Materiale** (visibile solo per file fresabili: hanno tagli e non sono tubo/svolto); `MaterialSim` creato al toggle; `carveStock()` agganciato a play (`frame`) e slider, con **throttle mesh a ~12 fps** (carve incrementale sempre, ricostruzione mesh limitata) + forzatura su fine/scrub.
- `tools/render-snapshot.mjs`: `STOCK=1` (+`CARVE=<mm>`) per snapshot headless dello stock scavato.

## Verifica
- `tests/sim.test.mjs` (10 test): impronta flat/ball/bull, carve monotòno, **volume plunge ≈ πR²h**, facing, default stock, contratto mesh, detectTool, MaterialSim end-to-end (forward-only + reset su scrub). Suite totale **95/95**.
- Headless: `3D_Chips.ngc` (ball Ø10 auto) → stock 141×150, ~551.000 mm³, rilievo scavato corretto; parziali 1500/4000mm mostrano rimozione progressiva. Live: toggle Materiale + scrub verificati (carve pieno ~0,5 s, incrementale in play).

## Motore TRI-DEXEL 4/5 assi (fatto)
Z(x,y) non basta (undercut, utensile inclinato). Il **tri-dexel** (`src/sim/tridexel.js`, adattato da `bernhardmgruber/tridexel` BSL-1.0) rappresenta lo stock come **tre fasci di dexel** X/Y/Z: campo `a` = griglia dei due assi ⟂, ogni raggio è una lista ORDINATA di intervalli solidi. Undercut e pareti verticali sono rappresentati esattamente (intervalli multipli / campi ⟂). Risoluzione **per-asse** (celle ~cubiche).
- **Carve** = sottrazione di intervalli: per ogni campione, per i tre campi, `rayToolInterval()` calcola l'intersezione raggio↔solido-utensile ORIENTATO (utensile = cilindro semi-infinito lungo l'asse `U`, cappuccio flat/ball; posa `U` per campione → pronto per il 5-assi), poi `subtractInterval()`.
- **Ricostruzione** = surface nets sull'occupancy ai nodi: un vertice per cella bipolare sui crossing esatti dei dexel + quad duali → mesh `{positions,indices}` nel contratto del renderer. Nella `tridexel.cpp` originale è un dual-contouring feature-preserving; qui surface nets (più semplice, robusto, watertight).
- **Driver**: `src/sim/materialsim5.js` (`MaterialSim5`) — stesso cursore mm forward-only di MaterialSim; `toolAxis` default +Z (3-assi); per il 5-assi basterà fornire l'asse per campione (da B/C o vettori IJK del G-code — estrazione dal parser = prossimo passo).
- **Integrato**: il bottone **▧ Materiale** del viewer usa ora MaterialSim5 (tri-dexel). Perf su 3D_Chips: carve pieno ~0,4–0,8 s, mesh ~60 ms, scrub ~0,35 s (≤ Z-map). Test `tests/tridexel.test.mjs` (6: subtractInterval, rayToolInterval flat/ball, volume, **undercut = 2 intervalli**, mesh). Headless: `TRIDEXEL=1 [CELLS=n] node tools/render-snapshot.mjs …`.

La **Z-map** (`materialsim.js`) resta in codebase come variante leggera 3-assi. Restano da fare per il 5-assi reale: estrazione dell'asse utensile dal G-code (B/C/IJK) e un modello 3D di testa macchina attorno al pezzo (stile NCSIMUL).
