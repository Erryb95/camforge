// @ts-check
// Bootstrap dell'applicazione: collega loader, viewer e pannelli.

import './loaders/nc/index.js';                 // registra il loader NC (+fallback)
import './loaders/alma/index.js';               // registra il loader AlmaCAM (.cn/.ctd)
import { parseFile } from './core/registry.js';
import { createViewer } from './render/viewer2d.js';
import { createCodePanel } from './ui/codePanel.js';
import { createStatsPanel } from './ui/statsPanel.js';

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

let model = /** @type {import('./core/model.js').SceneModel|null} */ (null);
let lineToSegs = new Map();

// ---------- viewer ----------
const viewer = createViewer(/** @type {HTMLCanvasElement} */ ($('canvas')), {
  onHover(seg, world) {
    codePanel.setActive(seg ? seg.line : -1);
    $('sbCoords').textContent = world
      ? `${viewer.getView()[0]} ${world[0].toFixed(3)}   ${viewer.getView()[1]} ${world[1].toFixed(3)}`
      : '—';
  },
  onPick(seg) {
    if (seg) {
      codePanel.select(seg.line);
      showSegTip(seg);
    } else {
      hideSegTip();
      codePanel.select(-1, false);
    }
  },
});

// ---------- pannelli ----------
const codePanel = createCodePanel(
  { scroll: $('codeScroll'), spacer: $('codeSpacer'), view: $('codeView') },
  {
    onSelectLine(line) {
      const segs = lineToSegs.get(line);
      viewer.setSelected(segs ? segs[0] : null);
      if (segs) showSegTip(segs[0]); else hideSegTip();
    },
  },
);

const statsPanel = createStatsPanel($('infoContent'), {
  onToolToggle(hidden) { viewer.setHiddenTools(hidden); },
  onWarningClick(line) { codePanel.select(line); },
});

// ---------- caricamento file ----------
function loadText(fileName, text) {
  try {
    const t0 = performance.now();
    const res = parseFile(fileName, text);
    model = res.model;
    lineToSegs = new Map();
    const geoLines = new Set();
    for (const s of model.segments) {
      geoLines.add(s.line);
      if (!lineToSegs.has(s.line)) lineToSegs.set(s.line, []);
      lineToSegs.get(s.line).push(s);
    }
    for (const d of model.drillPoints) geoLines.add(d.line);

    viewer.setModel(model);
    codePanel.setLines(model.rawLines, geoLines);
    statsPanel.update(model);
    stopAnim(true);
    hideSegTip();

    $('dropHint').classList.add('hidden');
    $('sbFile').textContent = fileName;
    $('sbCount').textContent = `${model.segments.length} segmenti · ${model.drillPoints.length} fori`;
    $('sbUnits').textContent = `unità: ${model.units === 'in' ? 'inch→mm' : 'mm'}`;
    updateZoomLabel();

    const ms = (performance.now() - t0).toFixed(0);
    const wtxt = model.warnings.length ? ` · ${model.warnings.length} avvisi` : '';
    toast(`Caricato ${fileName}: ${model.segments.length} segmenti in ${ms} ms${wtxt}`, true);
    if (res.usedFallback) toast(`Estensione sconosciuta: interpretato come G-code`, true);
  } catch (err) {
    console.error(err);
    toast(`Errore nel caricamento di ${fileName}: ${/** @type {Error} */(err).message}`);
  }
}

async function loadFile(file) {
  loadText(file.name, await file.text());
}

// ---------- tooltip segmento ----------
function showSegTip(seg) {
  const g = seg.type === 'rapid' ? 'G0' : seg.type === 'feed' ? 'G1' : (seg.cw ? 'G2' : 'G3');
  const fmt = (p) => `X${p.x.toFixed(2)} Y${p.y.toFixed(2)} Z${p.z.toFixed(2)}`;
  let txt = `riga ${seg.line} · ${g} · ${fmt(seg.from)} → ${fmt(seg.to)} · L ${seg.len.toFixed(2)} mm`;
  if (seg.radius) txt += ` · R ${seg.radius.toFixed(2)}`;
  if (seg.feed) txt += ` · F ${seg.feed.toFixed(0)}`;
  if (seg.tool) txt += ` · T${seg.tool}`;
  const tip = $('segTip');
  tip.innerHTML = `${txt}<span class="close" title="Chiudi">✕</span>`;
  tip.hidden = false;
  /** @type {HTMLElement} */ (tip.querySelector('.close')).onclick = () => {
    hideSegTip();
    viewer.setSelected(null);
    codePanel.select(-1, false);
  };
}
function hideSegTip() { $('segTip').hidden = true; }

// ---------- simulazione ----------
let playing = false;
let animT = 0;
let lastFrame = 0;

function stopAnim(reset = false) {
  playing = false;
  $('btnPlay').textContent = '▶';
  if (reset) {
    animT = 0;
    viewer.setProgress(null);
    /** @type {HTMLInputElement} */ ($('progress')).value = '1000';
  }
}

function frame(now) {
  if (!playing) return;
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  const speed = Number(/** @type {HTMLSelectElement} */($('speed')).value); // mm/s
  animT += speed * dt;
  const total = viewer.getTotal();
  if (animT >= total) {
    animT = total;
    viewer.setProgress(null);
    stopAnim();
    /** @type {HTMLInputElement} */ ($('progress')).value = '1000';
    return;
  }
  viewer.setProgress(animT);
  /** @type {HTMLInputElement} */ ($('progress')).value = String(Math.round((animT / total) * 1000));
  requestAnimationFrame(frame);
}

$('btnPlay').addEventListener('click', () => {
  if (!model) return;
  if (playing) { stopAnim(); return; }
  const total = viewer.getTotal();
  if (animT >= total) animT = 0;
  playing = true;
  $('btnPlay').textContent = '⏸';
  lastFrame = performance.now();
  requestAnimationFrame(frame);
});

$('progress').addEventListener('input', () => {
  if (!model) return;
  stopAnim();
  const v = Number(/** @type {HTMLInputElement} */($('progress')).value);
  const total = viewer.getTotal();
  animT = (v / 1000) * total;
  viewer.setProgress(v >= 1000 ? null : animT);
});

// ---------- toolbar ----------
$('btnOpen').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', (e) => {
  const input = /** @type {HTMLInputElement} */ (e.target);
  if (input.files && input.files[0]) loadFile(input.files[0]);
  input.value = '';
});
$('btnDemo').addEventListener('click', loadDemo);
$('btnFit').addEventListener('click', () => viewer.fit());
$('chkRapids').addEventListener('change', (e) => viewer.setShowRapids(/** @type {HTMLInputElement} */(e.target).checked));
$('chkPoints').addEventListener('change', (e) => viewer.setShowPoints(/** @type {HTMLInputElement} */(e.target).checked));

document.querySelectorAll('#viewBtns button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#viewBtns button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    viewer.setView(/** @type {HTMLElement} */(b).dataset.v);
    updateZoomLabel();
  });
});

for (const [btn, panel] of [['btnCode', 'codePanel'], ['btnInfo', 'infoPanel']]) {
  $(btn).addEventListener('click', () => {
    $(btn).classList.toggle('active');
    $(panel).classList.toggle('hidden', !$(btn).classList.contains('active'));
  });
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement
      || e.target instanceof HTMLButtonElement) return;
  if (e.key === 'f' || e.key === 'F') viewer.fit();
  if (e.code === 'Space') { e.preventDefault(); $('btnPlay').click(); }
});

function updateZoomLabel() {
  $('sbZoom').textContent = `zoom ${viewer.getZoom().toFixed(1)} px/mm · vista ${viewer.getView()}`;
}
$('canvas').addEventListener('wheel', () => updateZoomLabel(), { passive: true });

// ---------- drag & drop ----------
const vp = $('viewport');
for (const ev of ['dragenter', 'dragover']) {
  vp.addEventListener(ev, (e) => { e.preventDefault(); vp.classList.add('dragging'); });
}
vp.addEventListener('dragleave', (e) => {
  if (e.target === vp) vp.classList.remove('dragging');
});
vp.addEventListener('drop', (e) => {
  e.preventDefault();
  vp.classList.remove('dragging');
  const file = e.dataTransfer && e.dataTransfer.files[0];
  if (file) loadFile(file);
});

// ---------- toast ----------
let toastTimer = 0;
function toast(msg, ok = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = ok ? 'ok' : '';
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { t.hidden = true; }, 4000);
}

// ---------- demo ----------
async function loadDemo() {
  try {
    const r = await fetch('samples/demo.nc');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    loadText('demo.nc', await r.text());
  } catch {
    toast('Impossibile caricare la demo (samples/demo.nc)');
  }
}

// hook per test automatizzati (preview/console)
/** @type {any} */ (window).__loadText = loadText;
/** @type {any} */ (window).__getModel = () => model;

// avvio: ?file=percorso/relativo carica un file servito dal server, altrimenti demo
const startFile = new URLSearchParams(location.search).get('file');
if (startFile) {
  fetch(startFile)
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
    .then((text) => loadText(startFile.split('/').pop() || startFile, text))
    .catch((e) => toast(`Impossibile caricare ${startFile}: ${e.message}`));
} else {
  loadDemo();
}
