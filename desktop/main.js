// Guscio desktop (Electron) del CAD/CAM Viewer LGE.
// Riavvia IN-PROCESS lo stesso static server della web app (serve.mjs) su una porta
// libera e apre la finestra: src/, vendor/ e occt-full sono CONDIVISI, nessuna
// duplicazione. Offline, nessun Node di sistema richiesto (Electron include Node).
const { app, BrowserWindow, Menu, shell, dialog, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// GPU: usa l'accelerazione hardware quando c'è. Questi switch vanno impostati PRIMA
// che l'app sia pronta. `ignore-gpu-blocklist` forza la GPU vera anche con driver in
// blocklist Chromium → così WebGL2 / il delegate GPU di MediaPipe girano su GPU (non
// software). NON chiamiamo app.disableHardwareAcceleration() (sarebbe l'opposto).
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

// La web app in dev sta nella cartella padre; da pacchetto è copiata in
// resources/web (vedi extraResources in package.json).
const webRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'web')
  : path.join(__dirname, '..');

// estensioni apribili (= loader registrati); solo DWG è binario
const KNOWN = new Set(['nc', 'ngc', 'gcode', 'tap', 'cnc', 'mpf', 'pgm', 'iso', 'eia', 'din',
  'cn', 'ctd', 'dxf', 'dwg', 'stp', 'step', 'igs', 'iges', 'brep', 'atd', 'txt']);
const BINARY = new Set(['dwg']);
const DIALOG_FILTERS = [
  { name: 'Tutti i CAD/CAM', extensions: ['nc', 'ngc', 'gcode', 'tap', 'cnc', 'mpf', 'pgm', 'cn', 'ctd', 'dxf', 'dwg', 'stp', 'step', 'igs', 'iges', 'brep', 'atd'] },
  { name: 'NC / G-code', extensions: ['nc', 'ngc', 'gcode', 'tap', 'cnc', 'mpf', 'pgm'] },
  { name: 'CAD (STEP/DXF/DWG)', extensions: ['stp', 'step', 'igs', 'iges', 'brep', 'dxf', 'dwg'] },
  { name: 'Tubo (AlmaCAM/ActTubes)', extensions: ['cn', 'ctd', 'atd'] },
  { name: 'Tutti i file', extensions: ['*'] },
];

let win = null;
let srv = null;
let pendingFile = fileFromArgv(process.argv);   // file da doppio-click al primo avvio

function fileFromArgv(argv) {
  for (const a of argv.slice(1)) {
    if (!a || a.startsWith('-') || a.startsWith('--')) continue;
    try {
      if (fs.existsSync(a) && fs.statSync(a).isFile() && KNOWN.has(path.extname(a).slice(1).toLowerCase())) return a;
    } catch { /* ignora */ }
  }
  return null;
}

async function startServer() {
  // serve.mjs è ESM → import dinamico dal main process (CommonJS).
  const mod = await import(pathToFileURL(path.join(webRoot, 'serve.mjs')).href);
  srv = await mod.startStaticServer({ root: webRoot, port: 0, host: '127.0.0.1' });
  return srv.url;
}

// attende che l'hook window.__loadText sia pronto (i moduli ES caricano async)
async function hookReady() {
  return win.webContents.executeJavaScript(
    'new Promise(r=>{const t=setInterval(()=>{if(window.__loadText){clearInterval(t);r(true)}},40);setTimeout(()=>{clearInterval(t);r(false)},8000)})',
  );
}

// carica un file (da doppio-click / Apri…) nel renderer riusando l'hook __loadText
async function openFileInWindow(filePath) {
  if (!win || !filePath) return;
  try {
    const name = path.basename(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    await hookReady();
    if (BINARY.has(ext)) {
      const b64 = fs.readFileSync(filePath).toString('base64');
      await win.webContents.executeJavaScript(
        `(function(){const s=atob(${JSON.stringify(b64)});const a=new Uint8Array(s.length);` +
        `for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i);return window.__loadText(${JSON.stringify(name)},a);})()`,
      );
    } else {
      const txt = fs.readFileSync(filePath, 'utf8');
      await win.webContents.executeJavaScript(`window.__loadText(${JSON.stringify(name)}, ${JSON.stringify(txt)})`);
    }
    if (win.isMinimized()) win.restore();
    win.focus();
  } catch { /* file illeggibile: ignora */ }
}

async function pickAndOpen() {
  if (!win) return;
  const res = await dialog.showOpenDialog(win, { title: 'Apri file CAD/CAM', properties: ['openFile'], filters: DIALOG_FILTERS });
  if (!res.canceled && res.filePaths[0]) openFileInWindow(res.filePaths[0]);
}

// Concede la CAMERA (getUserMedia) alle sole origini locali fidate (127.0.0.1/localhost),
// senza prompt bloccanti — serve al controllo a mani. Servono entrambi gli handler.
function installMediaPermissions(ses) {
  const MEDIA = new Set(['media', 'camera', 'microphone']);
  const localOrigin = (u) => {
    try { const { protocol, hostname } = new URL(u || ''); return protocol === 'http:' && (hostname === '127.0.0.1' || hostname === 'localhost'); }
    catch { return false; }
  };
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    const url = (details && details.requestingUrl) || (wc && wc.getURL());
    cb(MEDIA.has(permission) && localOrigin(url));
  });
  ses.setPermissionCheckHandler((wc, permission, origin, details) => {
    const url = origin || (details && details.securityOrigin) || (wc && wc.getURL());
    return MEDIA.has(permission) && localOrigin(url);
  });
}

async function createWindow() {
  const url = await startServer();
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#14171c',            // stesso sfondo del viewer: niente flash bianco
    title: 'CamForge',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,              // il renderer è la web app pura (client-side)
      spellcheck: false,
    },
  });

  // link esterni → browser di sistema, non nuove finestre Electron
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https?:/.test(u)) { shell.openExternal(u); return { action: 'deny' }; }
    return { action: 'allow' };
  });

  // il desktop apre direttamente l'APP (app.html); la landing/pricing restano su '/'
  await win.loadURL(url.replace(/\/$/, '') + '/app.html?shell=lge');   // ?shell=lge: abilita le feature desktop-only (controllo a mani)
  win.on('closed', () => { win = null; });

  if (pendingFile) { const f = pendingFile; pendingFile = null; openFileInWindow(f); }
}

// menu minimale (l'app ha già la sua toolbar): Apri nativo + scorciatoie utili
function buildMenu() {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'Apri…', accelerator: 'CmdOrCtrl+O', click: () => pickAndOpen() },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ] },
    { label: 'Vista', submenu: [
      { role: 'reload' }, { role: 'forceReload' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
      { role: 'togglefullscreen' }, { role: 'toggleDevTools' },
    ] },
    { label: 'Aiuto', submenu: [
      { label: 'Stato GPU…', click: () => showGpuStatus() },
    ] },
  ]));
}

// Mostra lo stato dell'accelerazione GPU di Chromium (per verificare che la GPU sia
// davvero in uso: webgl/webgl2/gpu_compositing = "enabled" ⇒ GPU attiva).
function showGpuStatus() {
  let detail;
  try {
    const st = app.getGPUFeatureStatus();
    const key = ['gpu_compositing', 'webgl', 'webgl2', 'rasterization', 'video_decode', '2d_canvas'];
    detail = key.filter((k) => k in st).map((k) => `${k.padEnd(16)} ${st[k]}`).join('\n')
      + '\n\n(le voci "enabled" girano su GPU; "software"/"disabled" = ripiego CPU)';
  } catch (e) { detail = 'stato GPU non disponibile: ' + (e && e.message || e); }
  dialog.showMessageBox(win, { type: 'info', title: 'Stato GPU', message: 'Accelerazione hardware (Chromium)', detail });
}

// una sola istanza: un secondo doppio-click apre il file nella finestra esistente
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const f = fileFromArgv(argv);
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); if (f) openFileInWindow(f); }
  });

  // macOS: apertura via Finder / associazione
  app.on('open-file', (e, p) => { e.preventDefault(); if (win) openFileInWindow(p); else pendingFile = p; });

  app.whenReady().then(() => { buildMenu(); installMediaPermissions(session.defaultSession); createWindow(); });

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

  app.on('window-all-closed', async () => {
    if (srv) { try { await srv.close(); } catch { /* ignora */ } srv = null; }
    if (process.platform !== 'darwin') app.quit();
  });
}
