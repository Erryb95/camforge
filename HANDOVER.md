# HANDOVER — CAD/CAM Viewer LGE

Guida per spostare il progetto su un altro PC, svilupparci, self-hostarlo e accedervi da mobile.

---

## 1. Cos'è (in 30 secondi)
Viewer/simulatore CAD/CAM **web zero-dipendenze a runtime** (tutto vendorizzato offline in `vendor/`), servito da un piccolo server Node su `:8123`. Opzionalmente impacchettabile come **portable .exe** (Electron, cartella `desktop/`).
- **~8.500 LOC**, 57 moduli in `src/`, **134 test** (verdi), build portable attuale **v0.6.0**.
- Rendering 3D su **three.js** (WebGL). Apre DWG/DXF/STEP/IGES/STL/G-code; simula fresatura tri-dexel 3/4-5 assi (tavola basculante), taglio laser/plasma/waterjet/oxy lamiera+tubo, piegatura tubo; genera G-code.
- Inventario completo delle feature: **[docs/FEATURES.md](docs/FEATURES.md)**.

## 2. Prerequisiti sul nuovo PC
- **Node.js ≥ 20** (sviluppato su **v22.17.0**). Nient'altro per la parte WEB.
- Per buildare l'app desktop: la prima volta serve **internet** (scarica Electron ~100 MB) — vedi §6.
- (Consigliato) **Git** e un editor. Il progetto è già un repo git (branch `master`).

## 3. Cosa portarsi dietro / cosa rigenerare
Il progetto è un **repo git locale senza remote**. `vendor/` (111 MB, incl. occt-full 64 MB) **è tracciato in git** → viene con il repo.

**COPIA (essenziale):** tutto il tracciato git — `src/ vendor/ samples/ tests/ tools/ docs/ desktop/main.js desktop/package.json server.mjs serve.mjs index.html package.json .gitignore`.

**NON copiare — si rigenera sul nuovo PC:**
| Cartella | Come rigenerarla |
|---|---|
| `node_modules/` | non serve per il web (zero-dep). Solo se buildi il desktop: `cd desktop && npm install` |
| `desktop/node_modules/` | `cd desktop && npm install` |
| `desktop/dist/` | artefatti di build (.exe) → `npm run dist:portable` |
| `.cache/` | cache di build (npm/electron/electron-builder) |

**Eccezione utile (solo se builderai l'.exe sul nuovo PC):** copia `.cache/electron/` (binario Electron, risparmi ~100 MB di download) e **`.cache/electron-builder/winCodeSign/`** (il workaround pre-seed, vedi §6 — evita di rifarlo a mano).

### Metodo di trasferimento consigliato
- **A (sync tra i due PC, consigliato):** crea un **repo GitHub privato** e `git push`; sull'altro PC `git clone`. Dà versioning e sync futuro. ⚠️ attenzione al limite GitHub di 100 MB/file: il file più grosso è `vendor/occt-full/opencascade.wasm.wasm` (~63 MB) → sotto soglia, ok senza LFS.
- **B (spostamento una-tantum, offline):** `git bundle create cadcam.bundle --all` → copi **un solo file** → sull'altro PC `git clone cadcam.bundle CAD_CAM_visualLGE`. Mantiene tutta la storia, nessun servizio esterno.
- **C (copia grezza):** robocopy/zip della cartella **escludendo** `node_modules`, `desktop/node_modules`, `desktop/dist`, `.cache`. Semplice ma perdi il sync git.

## 4. Avvio sviluppo (WEB) sul nuovo PC
```
cd CAD_CAM_visualLGE
node server.mjs            # → http://localhost:8123
```
Modifiche a `src/` e `index.html` sono **live a un reload** (niente build, sono ES module serviti statici).

**Test:**
```
node --test tests/*.test.mjs      # 134 test
```

## 5. Self-host + accesso da mobile
1. Avvia esponendo in LAN (il default `127.0.0.1` è solo-locale):
   ```
   HOST=0.0.0.0 node server.mjs        # PowerShell:  $env:HOST="0.0.0.0"; node server.mjs
   ```
2. Apri il **firewall** per la porta 8123 (Windows: "Consenti app attraverso il firewall" o regola in entrata sulla 8123).
3. Da mobile **in LAN**: `http://<IP-del-PC>:8123/` (l'IP lo trovi con `ipconfig`).
4. Da mobile **fuori casa**, in sicurezza e senza aprire porte sul router: usa **Tailscale** (o Cloudflare Tunnel) → raggiungi il PC col suo IP Tailscale ovunque. In alternativa, il **remote-control/RDP** sul PC di casa (guidi lo schermo del PC, non il web).
5. Per tenerlo sempre attivo sul PC sempre acceso: lancialo come **servizio/attività pianificata** all'avvio, o con `pm2`/`nssm`.

> Nota mobile: WebGL (three.js) gira sui browser mobili, ma **occt-full è 64 MB** (primo caricamento lento su telefono) e la **simulazione fresatura tri-dexel è pesante di CPU** (lenta su mobile). Per *vedere*/lavoro tubo leggero va bene; la sim milling pesante è roba da desktop.

## 6. Build dell'app desktop (.exe) — solo quando serve
Solo se vuoi un portable da dare a qualcuno; **non serve per lo sviluppo quotidiano**.
```
cd desktop
npm install
npm run dist:portable     # → dist/CAD-CAM Viewer LGE-<versione>-portable.exe
```
- La cache di build è sotto `D:\CAD_CAM_visualLGE\.cache\` (imposta gli env `ELECTRON_BUILDER_CACHE`, `ELECTRON_CACHE`, `npm_config_cache` su quella cartella per riusarla).
- **Gotcha winCodeSign:** electron-builder scarica `winCodeSign` (contiene symlink macOS che Windows non crea senza privilegi) → può fallire con *"Cannot create symbolic link… a required privilege is not held"*. Fix: **abilita la Modalità Sviluppatore** di Windows, oppure terminale **come amministratore**, oppure **pre-seed** della cache (copia una `.cache/electron-builder/winCodeSign/winCodeSign-2.6.0` già estratta). Dettagli in `desktop/README.md`.

## 7. Mappa del progetto
```
src/
  main.js              orchestrazione UI + eventi
  render/  three3d.js  backend WebGL (three.js) · viewer2d.js orchestratore
  loaders/  nc, dxf, dwg, step(occt), stl, alma, atd, lra, cad/
  sim/      tridexel, materialsim5, lasercut, lasertube, tubebend, bitgen, materials…
  generator/ step2nc, tubeNc, partmill, dxfmill, post/gcode
  core/     model, unroll, bend, registry
vendor/     three, occt, occt-full, libredwg, earcut, clipper, tasks-vision   (tutto offline)
samples/    file di test reali (nc, dxf, step, iges, stl, tubi, 5axis-*)
tests/      21 file, 134 test  ·  tools/ render-snapshot.mjs (render headless)
desktop/    guscio Electron (main.js + package.json)
docs/       FEATURES.md, BUSINESS_PLAN.md, MARKET_RESEARCH.md, SIMULATION.md…
server.mjs / serve.mjs   static server (condiviso web + desktop)
```

## 8. Stato attuale & prossimo passo
- **v0.6.0**: migrazione completa a three.js (tutte le viste), fresatura 4-5 assi a **tavola basculante** (il pezzo si inclina, mandrino verticale), punte reali per materiale, DXF/IGES fresabili, parser vettori utensile. 134/134 test.
- **Decisione di prodotto aperta** (dopo analisi di mercato in `docs/`): la direzione più sensata individuata è un **CAM tubo/rotary economico per controller aperti** (LinuxCNC/GRBL/FluidNC) — colpisce il punto debole di SheetCam (niente svolto rotary nativo) riusando ~70% del motore. Primo passo a costo ~0: **demo svolto+wrap+G-code QtPlasmaC** da postare sul forum LinuxCNC (thread PlasmaC 49214) per validare la domanda *prima* di costruire.

## 9. Note operative
- **Zero-dip a runtime:** non installare pacchetti per far girare il web; tutto è in `vendor/`.
- L'utente **compila/testa su una macchina separata** → tieni i commit puliti e le modifiche tracciabili.
- Convenzione commit: messaggi chiari; il repo non ha remote → aggiungine uno se vuoi sync.
