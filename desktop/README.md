# CAD/CAM Viewer LGE — sandbox desktop (Electron)

Eseguibile **offline** in parallelo al sito. Riavvia in-process lo stesso static server
della web app (`../serve.mjs`) e apre la finestra: `src/`, `vendor/` e `occt-full` sono
**condivisi**, nessuna duplicazione di codice. Feature-complete (incluso `→ NC` con
occt-full).

## Prerequisiti (una volta, sulla macchina di build)
- Node ≥ 18 (serve solo per installare/impacchettare; l'eseguibile finale NON richiede Node).
- Connessione a internet al primo `npm install` (scarica Electron ~100 MB).

## Sviluppo (finestra dal vivo, senza impacchettare)
```
cd desktop
npm install
npm start
```
Si apre la finestra del viewer. Ricarica con Ctrl+R; DevTools con F12.

## Creare l'eseguibile Windows
```
cd desktop
npm install            # se non già fatto
npm run dist           # → dist/CAD-CAM Viewer LGE-0.1.0-x64.exe  (installer NSIS)
                       #   + ...-portable.exe                     (portatile, doppio click)
```
- **Installer (NSIS)**: installa e crea collegamenti; l'utente sceglie la cartella.
- **Portable**: singolo `.exe`, nessuna installazione — ideale per una demo/pitch da chiavetta.

Solo il pacchetto portatile:
```
npm run dist:portable
```

## Peso
~150–220 MB (Chromium + Node + WASM). Il grosso è `vendor/occt-full` (64 MB): se un
domani serve un pacchetto più leggero, si può escludere occt-full dagli `extraResources`
in `package.json` (il bottone `→ NC` resterebbe solo nella versione web) → ~40–60 MB.

## Note tecniche
- Il renderer è la web app **pura** (nessuna API Electron/Node lato pagina): `nodeIntegration:false`,
  `contextIsolation:true`. Il `📂 Apri` interno (input file HTML) funziona nativamente.
- Nessun header COOP/COEP forzato: occt-full oggi gira senza isolamento cross-origin, quindi
  l'ambiente è **identico** al sito. Se in futuro servissero i thread WASM (SharedArrayBuffer),
  passare `extraHeaders` a `startStaticServer` in `main.js`.
- **Controllo 3D con le mani ✋ (solo desktop)**: bottone "✋ Mani" in toolbar (visibile solo
  nel guscio, che carica `?shell=lge`). Usa MediaPipe Hand Landmarker vendorizzato offline in
  `vendor/tasks-vision/`. Gesti a una mano: palmo che si muove → orbita, pinch pollice+indice →
  zoom. Il permesso camera è concesso dal main process alle sole origini `127.0.0.1`/`localhost`.
- Icona app: opzionale, metti `build/icon.ico` (256×256) e electron-builder la usa in automatico.
- Firma del codice: per distribuzione esterna serve un certificato (Windows SmartScreen).
  Per uso interno/pitch il portatile non firmato funziona (SmartScreen chiede conferma una volta).

## Troubleshooting build
- **`Cannot create symbolic link … winCodeSign … A required privilege is not held`**: electron-builder
  scarica `winCodeSign` (serve `rcedit` per l'icona sull'exe) ma l'archivio contiene symlink
  macOS che Windows non crea senza privilegio. I file Windows però si estraggono lo stesso.
  Fix (uno dei tre):
  1. **Abilita la Modalità Sviluppatore** di Windows (Impostazioni → Privacy e sicurezza →
     Per sviluppatori → ON) — concede il privilegio symlink. Poi `npm run dist`.
  2. Esegui il terminale **come amministratore** e ricompila.
  3. **Pre-seed della cache** (quello che ho usato, senza admin): dopo un primo tentativo
     fallito, copia un temp dir già estratto al nome finale atteso —
     `…/electron-builder/winCodeSign/<random>` → `…/electron-builder/winCodeSign/winCodeSign-2.6.0`
     (contiene già `rcedit-x64.exe`, `windows-10/…`, mancano solo i 2 symlink darwin inutili),
     poi ricompila: app-builder trova la cache e salta l'estrazione.
- La cache di build (Electron, electron-builder, npm) è sotto `D:\CAD_CAM_visualLGE\.cache\`.
