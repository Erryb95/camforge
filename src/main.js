// @ts-check
// Bootstrap dell'applicazione: collega loader, viewer e pannelli.

import './loaders/nc/index.js';                 // registra il loader NC (+fallback)
import './loaders/alma/index.js';               // registra il loader AlmaCAM (.cn/.ctd)
import './loaders/dxf/index.js';                // registra il loader DXF
import './loaders/step/index.js';               // registra il loader STEP (async, WASM)
import './loaders/dwg/index.js';                // registra il loader DWG (async, WASM, binario)
import './loaders/atd/index.js';                // registra il loader ActTubes (.atd)
import './loaders/lra/index.js';                // registra il loader Piegatubo (.lra/.ybc)
import './loaders/stl/loader.js';               // registra .stl come mesh 3D apribile
import { parseFile, isBinaryExt } from './core/registry.js';
import { createViewer } from './render/viewer2d.js';
import { createCodePanel } from './ui/codePanel.js';
import { createStatsPanel } from './ui/statsPanel.js';
import { MaterialSim5 } from './sim/materialsim5.js';   // motore tri-dexel (4/5 assi, undercut) — FRESATURA
import { LaserSheetSim } from './sim/lasercut.js';       // taglio lamiera (kerf + separazione pezzi)
import { CUT_PROCESSES, DEFAULT_PROCESS, processById } from './sim/processes.js';  // laser/plasma/waterjet/ossitaglio
import { foldMeshFromCenterline } from './sim/tubebend.js';  // PIEGATURA tubo: fold barra dritta → pezzo piegato
import { partToMillGcode } from './generator/partmill.js';   // FRESATURA da pezzo 3D: mesh → percorso raster
import { dxfToPartMesh } from './generator/dxfmill.js';       // FRESATURA da DXF 2D: contorni → lastra estrusa
import { generateRotaryDemo, wrapDxfToRotary, dxfDesignExtent } from './generator/tubeWrap.js';  // CAM tubo/rotary: svolto/DXF → wrap asse A → G-code QtPlasmaC
import { MILD_STEEL_PLASMA, cutParamsFor } from './generator/rotaryCut.js';   // preset plasma (kerf/feed/pierce) per spessore
import { MATERIALS, DEFAULT_MATERIAL, materialById, coatingColor } from './sim/materials.js';   // materiali + punta per materiale
import { LaserTubeSim, outwardNormalAt } from './sim/lasertube.js';   // taglio LASER tubo (troncatura=stacco assiale)
import { loadLaserHead, placeHead, placeHeadOriented, headScaleFor } from './sim/laserhead.js';
import { loadMillBit, placeMillBit, setMillBit } from './sim/millhead.js';   // punta fresa (generata) che segue l'utensile
import { bitSpecForMaterial } from './sim/bitgen.js';   // fresa reale diversa per materiale
import { createHandControl } from './hands/handtracking.js';     // controllo 3D con le mani (solo desktop)

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

let model = /** @type {import('./core/model.js').SceneModel|null} */ (null);
let lineToSegs = new Map();
let lastStep = /** @type {{name:string, text:string}|null} */ (null);   // sorgente per "→ NC"
let lastGen = /** @type {{name:string, text:string}|null} */ (null);    // ultimo NC generato
let rotarySrc = /** @type {import('./core/model.js').SceneModel|null} */ (null);   // DXF sorgente per il wrap rotary (persiste dopo il wrap)
// simulazione asportazione materiale (Z-map)
let matSim = /** @type {MaterialSim5|null} */ (null);
let stockOn = false;
let lastStockDraw = 0;
let millBitReady = false;
let millRes = 90;              // cellsTarget tri-dexel (slider risoluzione)
let bitMode = 'follow';        // 'follow' = punta sull'avanzamento · 'segment' = sul segmento selezionato
let focusedSeg = null;         // segmento focalizzato (hover/select) per la punta in modalità 'segment'
let currentMaterial = DEFAULT_MATERIAL;   // materiale del pezzo → punta consigliata + colore rivestimento
let millAllow = 2;             // sovrametallo del solido di partenza (mm)
let fiveAxis = false;          // false = 3 assi (+Z) · true = 4/5 assi (orientamento dal G-code)
let partMillSrc = null;        // {mesh, name}: pezzo sorgente per rigenerare la fresatura al variare di sovrametallo
// ultima vista scelta ESPLICITAMENTE dall'utente: mantenuta all'apertura del file
// successivo e anche fra sessioni (localStorage), se valida per il nuovo file
let lastUserView = null;
try { lastUserView = localStorage.getItem('lge.view') || null; } catch { /* storage non disponibile */ }
// palette fresatura per triTool: 0=materiale (grigio), 5=punta utensile (scuro)
const MILL_PALETTE = [[0x8c, 0x98, 0xa6], null, null, null, null, [0x45, 0x4b, 0x57]];
// taglio laser lamiera
let laserSim = /** @type {LaserSheetSim|null} */ (null);
let cutProcess = DEFAULT_PROCESS;   // processo di taglio corrente (laser/plasma/waterjet/ossitaglio)
let laserOn = false;
let laserHeadReady = false;
let laserScale = 0.3;
let lastLaserDraw = 0;
// palette per triTool della mesh laser: 1=materiale, 2=pezzo staccato, 3=ugello, 4=supporto
const LASER_PALETTE = [[0x8c, 0x98, 0xa6], [0x8c, 0x98, 0xa6], [0x6f, 0x92, 0xba], [0x4a, 0x4f, 0x59], [0x6c, 0x74, 0x82]];

// ---------- viewer ----------
const viewer = createViewer(/** @type {HTMLCanvasElement} */ ($('canvas')), {
  onHover(seg, world) {
    codePanel.setActive(seg ? seg.line : -1);
    if (seg) setBitFocus(seg);
    if (viewer.isOrbit()) {
      const o = viewer.getOrbit();
      $('sbCoords').textContent = `orbita  az ${o.az.toFixed(0)}°  el ${o.el.toFixed(0)}°`;
      return;
    }
    const lab = viewer.getAxisLabels();
    $('sbCoords').textContent = world
      ? `${lab[0]} ${world[0].toFixed(3)}   ${lab[1]} ${world[1].toFixed(3)}`
      : '—';
  },
  onPick(seg) {
    if (seg) {
      codePanel.select(seg.line);
      showSegTip(seg);
      setBitFocus(seg);
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
      if (segs) { showSegTip(segs[0]); setBitFocus(segs[0]); } else hideSegTip();
    },
  },
);

const statsPanel = createStatsPanel($('infoContent'), {
  onToolToggle(hidden) { viewer.setHiddenTools(hidden); },
  onWarningClick(line) { codePanel.select(line); },
});

// ---------- ricerca nel codice ----------
codePanel.onSearchUpdate((n, total) => {
  $('searchCount').textContent = total ? `${n}/${total}` : ($('searchInput').value ? '0/0' : '');
});
$('searchInput').addEventListener('input', (e) => codePanel.search(/** @type {HTMLInputElement} */(e.target).value));
$('searchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? codePanel.searchPrev() : codePanel.searchNext(); }
  if (e.key === 'Escape') { /** @type {HTMLInputElement} */($('searchInput')).value = ''; codePanel.search(''); $('canvas').focus(); }
});
$('searchNext').addEventListener('click', () => codePanel.searchNext());
$('searchPrev').addEventListener('click', () => codePanel.searchPrev());

// ---------- caricamento file ----------
async function loadText(fileName, text) {
  try {
    const t0 = performance.now();
    rotarySrc = null;                 // nuovo file caricato: dimentica il DXF sorgente del wrap
    const res = parseFile(fileName, text);
    if (res.model && typeof (/** @type {any} */ (res.model)).then === 'function') {
      toast('Caricamento motore geometrico (WASM)…', true);
      res.model = await res.model;
    }
    displayModel(res.model, fileName, { sourceText: text, usedFallback: res.usedFallback, t0 });
  } catch (err) {
    console.error(err);
    toast(`Errore nel caricamento di ${fileName}: ${/** @type {Error} */(err).message}`);
  }
}

/**
 * Mostra un SceneModel già pronto nel viewer. Usato dal caricamento file e dai
 * generatori che costruiscono il modello direttamente (es. demo tubo rotary):
 * il modello porta i suoi rawLines (il G-code emesso) e seg.line che vi punta,
 * quindi la sincronizzazione codice↔3D funziona come per un file caricato.
 * @param {import('./core/model.js').SceneModel} m
 * @param {string} fileName
 * @param {{sourceText?:string|Uint8Array, usedFallback?:boolean, t0?:number}} [opts]
 */
function displayModel(m, fileName, opts = {}) {
  const t0 = opts.t0 ?? performance.now();
  const text = opts.sourceText;
  model = m;
  lineToSegs = new Map();
    const geoLines = new Set();
    for (const s of model.segments) {
      geoLines.add(s.line);
      if (!lineToSegs.has(s.line)) lineToSegs.set(s.line, []);
      lineToSegs.get(s.line).push(s);
    }
    for (const d of model.drillPoints) geoLines.add(d.line);

    const gcode = /\.(nc|gcode|ngc|tap|cnc|iso|eia|din|mpf|pgm|txt)$/i.test(fileName);
    viewer.setModel(model);
    codePanel.setLines(model.rawLines, geoLines, gcode ? 'gcode' : 'plain');
    statsPanel.update(model);
    stopAnim(true);
    hideSegTip();

    // sorgente per "→ NC": l'ultimo STEP testuale caricato
    lastStep = typeof text === 'string' && /\.(stp|step)$/i.test(fileName)
      ? { name: fileName, text }
      : null;
    $('btnGenNc').hidden = !lastStep;
    $('btnDlNc').hidden = true;
    $('btnMillPart').hidden = !isCadPart(model) && !isDxf2d(model);   // → Fresa: pezzo 3D (mesh) o DXF 2.5D
    // → Tubo rotary: ricorda il DXF sorgente così il pannello resta usabile per
    // ri-tarare i parametri anche dopo aver mostrato il modello avvolto (QTPLASMAC)
    if (isDxf2d(m)) rotarySrc = m;
    $('btnDxfRotary').hidden = !rotarySrc;

    // simulazione asportazione: azzera e mostra i bottoni in base al contenuto
    stockOn = false; matSim = null;
    laserOn = false; laserSim = null;
    viewer.clearStock(); viewer.setLaserFx(null);
    $('btnStock').classList.remove('active');
    $('btnStock').hidden = !isMillable(model);
    $('millResWrap').hidden = true; $('bitMode').hidden = true; focusedSeg = null; $('millAxes').hidden = true;
    $('millMaterial').hidden = true; $('millAllowWrap').hidden = true; partMillSrc = null;
    $('btnLaser').classList.remove('active');
    $('btnLaser').hidden = !isLaserable(model);
    $('procSelect').hidden = !isLaserable(model);
    cutProcess = DEFAULT_PROCESS; /** @type {HTMLSelectElement} */ ($('procSelect')).value = cutProcess.id;
    foldOn = false;
    $('btnFold').classList.remove('active');
    $('btnFold').hidden = !isFoldable(model);

    // scelta vista: MANTIENI l'ultima vista scelta dall'utente se valida per questo
    // file; altrimenti default dal contenuto (tubo → Svolto · STEP/3D → 3D · else XY)
    const dev = !!(model.meta && model.meta.unrollAvailable);
    const is3d = !!(model.meta && (['STEP', 'IGES', 'BREP', 'DWG3D'].includes(model.meta.dialect) || model.mesh));
    $('btnDev').hidden = !dev;
    // il 3D di un modello con mesh parte SEMPRE in Solido: il toggle
    // Solido/Filo non eredita lo stato del file precedente
    viewer.setSolid(true);
    $('btnSolid').classList.add('active');
    $('btnSolid').innerHTML = '&#9632; Solido';
    const contentView = dev ? 'DEV' : is3d ? '3D' : 'XY';
    const viewValid = (v) => (v === 'DEV' ? dev : ['XY', 'XZ', 'YZ', '3D'].includes(v));
    setViewUI(lastUserView && viewValid(lastUserView) ? lastUserView : contentView);

    $('dropHint').classList.add('hidden');
    $('sbFile').textContent = fileName;
    $('sbCount').textContent = `${model.segments.length} segmenti · ${model.drillPoints.length} fori`;
    $('sbUnits').textContent = `unità: ${model.units === 'in' ? 'inch→mm' : 'mm'}`;
    updateZoomLabel();

    const ms = (performance.now() - t0).toFixed(0);
    const wtxt = model.warnings.length ? ` · ${model.warnings.length} avvisi` : '';
    toast(`Caricato ${fileName}: ${model.segments.length} segmenti in ${ms} ms${wtxt}`, true);
    if (opts.usedFallback) toast(`Estensione sconosciuta: interpretato come G-code`, true);
}

async function loadFile(file) {
  const content = isBinaryExt(file.name)
    ? new Uint8Array(await file.arrayBuffer())
    : await file.text();
  loadText(file.name, content);
}

// ---------- tooltip segmento ----------
function showSegTip(seg) {
  const g = seg.type === 'rapid' ? 'G0' : seg.type === 'feed' ? 'G1' : (seg.cw ? 'G2' : 'G3');
  const fmt = (p) => `X${p.x.toFixed(2)} Y${p.y.toFixed(2)} Z${p.z.toFixed(2)}`;
  let txt = `riga ${seg.line} · ${g} · ${fmt(seg.from)} → ${fmt(seg.to)} · L ${seg.len.toFixed(2)} mm`;
  if (seg.radius) txt += ` · R ${seg.radius.toFixed(2)}`;
  if (seg.feed) txt += ` · F ${seg.feed.toFixed(0)}`;
  if (seg.tool) txt += ` · T${seg.tool}`;
  if (seg.rot1 !== undefined && seg.rot1 !== null) {
    txt += seg.rot0 !== null && seg.rot0 !== undefined && Math.abs(seg.rot1 - seg.rot0) > 1e-9
      ? ` · P ${seg.rot0.toFixed(1)}→${seg.rot1.toFixed(1)}°`
      : ` · P ${seg.rot1.toFixed(1)}°`;
  }
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
let followedLine = -1;

// evidenzia nel pannello codice la riga che il tracciato sta percorrendo
function followLine(len) {
  const seg = len === null ? null : viewer.segAt(len);
  const l = seg ? seg.line : -1;
  if (l === followedLine) return;
  followedLine = l;
  codePanel.follow(l);
}

// asporta lo stock fino all'avanzamento `len` (null = tutto). Il carve è
// incrementale ed economico; la ricostruzione della mesh (costosa) è limitata a
// ~12 fps durante il play e sempre forzata su fine/scrub.
// punto centrale (3D) di un segmento: per posizionare la punta sul segmento focalizzato
function segMidpoint(seg) {
  const pts = seg.pts && seg.pts.length >= 2 ? seg.pts : [seg.from, seg.to];
  const a = pts[0], b = pts[pts.length - 1];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}
// aggiorna il segmento focalizzato (hover/select) e, in modalità 'segment', ridisegna la punta
function setBitFocus(seg) {
  if (!seg) return;
  focusedSeg = seg;
  if (stockOn && bitMode === 'segment') carveStock(state_progress());
}

function carveStock(len, force = false) {
  if (!stockOn || !matSim) return;
  matSim.carveTo(len == null ? matSim.total : len);
  const cut = len == null ? null : worldPointAt(len);        // punto utensile all'avanzamento
  const onSeg = bitMode === 'segment' && focusedSeg;
  const bitAt = onSeg ? segMidpoint(focusedSeg) : cut;       // punta: sul segmento selezionato o sull'avanzamento
  viewer.setLaserFx(!onSeg && cut && cut.cutting ? cut : null, 'mill');   // trucioli solo in modalità avanzamento durante il taglio
  const now = performance.now();
  if (force || now - lastStockDraw > 80) {
    lastStockDraw = now;
    const m = matSim.mesh();
    let mesh = { positions: m.positions, indices: m.indices, triTool: m.triTool || new Uint32Array(m.indices.length / 3) };
    // 4-5 assi: asse utensile + rotazione TAVOLA del segmento corrente (dal G-code)
    let bitAxis = null, tableRot = null;
    if (fiveAxis) {
      const seg = onSeg ? focusedSeg : (len != null ? viewer.segAt(len) : null);
      if (seg && seg.toolAxis) { bitAxis = seg.toolAxis; tableRot = seg.tableRot || null; }
    }
    if (millBitReady && bitAt) {
      // la punta è inclinata lungo l'asse utensile: ruotando pezzo+punta di Q torna verticale
      const bit = placeMillBit([bitAt.x, bitAt.y, bitAt.z], matSim.tool.r * 2, bitAxis);
      if (bit) mesh = mergeSheetHead(mesh, bit);
    }
    mesh.palette = MILL_PALETTE;
    viewer.setStock(mesh);
    viewer.setStockRot(tableRot);   // tavola basculante: inclina il pezzo, la punta resta verticale
  }
}

// il modello ha senso per la simulazione asportazione? (fresatura 3-assi: ha
// tagli e NON è un tubo/laser svolto)
function isMillable(m) {
  return !!m && !(m.meta && m.meta.unrollAvailable) && m.segments.some((s) => s.type !== 'rapid');
}

// pezzo CAD 3D fresabile: ha una mesh solida (STL/STEP/IGES) e non è un tubo né un percorso NC
function isCadPart(m) {
  return !!(m && m.mesh && m.mesh.positions && m.mesh.positions.length) && !isTube(m) && !(m.meta && m.meta.fromPartMill);
}
// DXF 2D fresabile (2.5D): profilo piano → lastra con fori (la validità dei contorni si controlla al click)
function isDxf2d(m) {
  return !!(m && m.meta && m.meta.dialect === 'DXF') && m.segments.some((s) => s.type !== 'rapid');
}

async function setStockMode(on) {
  if (on) { setLaserMode(false); setFoldMode(false); }   // fresatura, taglio, piega mutuamente esclusivi
  stockOn = on && isMillable(model);
  $('btnStock').classList.toggle('active', stockOn);
  if (stockOn) {
    if (!matSim || matSim.model !== model || matSim._cellsTarget !== millRes || matSim._allow !== millAllow || matSim.fiveAxis !== fiveAxis) matSim = new MaterialSim5(model, { cellsTarget: millRes, allowance: millAllow, fiveAxis });
    if (!matSim.ok) { stockOn = false; $('btnStock').classList.remove('active'); toast('Stock non ricavabile da questo file'); return; }
    matSim._cellsTarget = millRes; matSim._allow = millAllow;
    if (viewer.getView() !== '3D') setViewUI('3D');
    try { await loadMillBit(bitSpecForMaterial(currentMaterial)); millBitReady = true; } catch (e) { millBitReady = false; }
    if (!stockOn) return;                       // spento nel frattempo
    $('millResWrap').hidden = false; $('bitMode').hidden = false; $('millAxes').hidden = false;
    $('millMaterial').hidden = false; $('millAllowWrap').hidden = false;
    applyMaterialToBit();
    updateMillResLabel();
    startFromRaw();                             // parti dal GREZZO (blocco pieno), poi ▶ per asportare
    lastStockDraw = 0;
    carveStock(0, true);
    toast(`Fresatura (tri-dexel): griglia ${matSim.td.Nn.join('×')}, utensile ${matSim.tool.type} r${matSim.tool.r} mm${millBitReady ? ' · punta attiva' : ''} — premi ▶`, true);
  } else {
    viewer.clearStock();
    $('millResWrap').hidden = true; $('bitMode').hidden = true; $('millAxes').hidden = true;
    $('millMaterial').hidden = true; $('millAllowWrap').hidden = true;
  }
}

function updateMillResLabel() {
  const el = $('millResVal');
  if (el) el.textContent = matSim && matSim.td ? matSim.td.Nn.join('×') : '';
}
// la punta prende GEOMETRIA (n. taglienti/elica) e COLORE (rivestimento) dal materiale scelto
function applyMaterialToBit() {
  MILL_PALETTE[5] = coatingColor(currentMaterial.coating);       // rivestimento = colore
  if (millBitReady) setMillBit(bitSpecForMaterial(currentMaterial));   // fresa reale diversa per materiale
}

// ricostruisce la simulazione con risoluzione/sovrametallo correnti e ri-carva
function rebuildMatSim() {
  if (!stockOn || !model) return;
  matSim = new MaterialSim5(model, { cellsTarget: millRes, allowance: millAllow, fiveAxis });
  if (!matSim.ok) return;
  matSim._cellsTarget = millRes; matSim._allow = millAllow;
  updateMillResLabel();
  lastStockDraw = 0;
  carveStock(state_progress(), true);
}

// ---------- taglio laser (lamiera + tubo) ----------
function isTube(m) { return !!(m && m.meta && m.meta.unrollAvailable); }
// il modello è una LAMIERA piana (tagli planari, non tubo)?
function isSheet(m) {
  if (!m || !m.bounds || isTube(m)) return false;
  let zmin = Infinity, zmax = -Infinity, cuts = 0;
  for (const s of m.segments) {
    if (s.type === 'rapid') continue;
    cuts++;
    for (const p of [s.from, s.to]) { if (p.z < zmin) zmin = p.z; if (p.z > zmax) zmax = p.z; }
  }
  return cuts > 0 && zmax - zmin < 2;   // taglio planare (lamiera)
}
function isLaserable(m) { return isSheet(m) || isTube(m); }

// punto di taglio 3D alla lunghezza percorsa `len` (per testa + FX). `cutting`
// è false sui movimenti rapidi (laser spento) → nessuna fiamma.
function worldPointAt(len) {
  const L = len == null ? viewer.getTotal() : len;
  let acc = 0;
  for (const s of model.segments) {
    const sl = s.len || 0;
    if (acc + sl >= L) {
      const cutting = s.type !== 'rapid';
      const pts = s.pts && s.pts.length >= 2 ? s.pts : [s.from, s.to];
      let rem = L - acc, cum = 0;
      for (let i = 1; i < pts.length; i++) {
        const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
        if (cum + d >= rem) {
          const t = (rem - cum) / (d || 1), a = pts[i - 1], b = pts[i];
          return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, cutting };
        }
        cum += d;
      }
      return { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y, z: pts[pts.length - 1].z, cutting };
    }
    acc += sl;
  }
  const last = model.segments[model.segments.length - 1];
  return last ? { x: last.to.x, y: last.to.y, z: last.to.z, cutting: false } : null;
}

// fonde la mesh lamiera (triTool 1/2) con la testa (triTool 3/4)
function mergeSheetHead(sheet, head) {
  const np = sheet.positions.length + head.positions.length;
  const ni = sheet.indices.length + head.indices.length;
  const positions = new Float64Array(np), indices = new Uint32Array(ni), triTool = new Uint32Array(ni / 3);
  positions.set(sheet.positions, 0); positions.set(head.positions, sheet.positions.length);
  indices.set(sheet.indices, 0);
  const base = sheet.positions.length / 3;
  for (let i = 0; i < head.indices.length; i++) indices[sheet.indices.length + i] = head.indices[i] + base;
  triTool.set(sheet.triTool, 0); triTool.set(head.triTool, sheet.triTool.length);
  return { positions, indices, triTool, palette: LASER_PALETTE };
}

// reveal del taglio laser fino all'avanzamento `len` (lamiera o tubo)
function revealLaser(len, force = false) {
  if (!laserOn || !laserSim || !laserSim.ready) return;
  const done = len == null;
  const cut = worldPointAt(len);
  // fiamma/scintille SOLO durante il taglio (mai nei rapidi o a fine programma);
  // l'effetto dipende dal processo (laser caldo / plasma blu / waterjet freddo / ossitaglio)
  viewer.setLaserFx(done || !cut || !cut.cutting ? null : cut, cutProcess.fx);
  const now = performance.now();
  if (force || now - lastLaserDraw > 60) {
    lastLaserDraw = now;
    let mesh = laserSim.meshAt(len);
    if (laserHeadReady && cut && !done) {
      let head;
      if (laserIsSheet) {
        head = placeHead(cut.x, cut.y, laserSim.thickness, { scale: laserScale, standoff: 2 });   // sopra, ugello −Z
      } else {
        const p = laserSim.profile;
        const n = outwardNormalAt(cut.y, cut.z, p);                    // normale esterna (piano sezione)
        const tip = [cut.x, cut.y + n[0] * 3, cut.z + n[1] * 3];       // ugello a standoff dalla parete
        head = placeHeadOriented(tip, [0, -n[0], -n[1]], { scale: laserScale });   // punta verso l'asse (radiale)
      }
      if (head) mesh = mergeSheetHead(mesh, head);
    }
    if (!mesh.palette) mesh.palette = LASER_PALETTE;
    viewer.setStock(mesh);
  }
}

// ---------- PIEGATURA tubo (fold dal programma LRA/YBC) ----------
let foldOn = false, lastFoldT = -1;
function isFoldable(m) { return !!(m && m.meta && m.meta.foldAvailable); }
function setFoldMode(on) {
  if (on) { setStockMode(false); setLaserMode(false); }     // mutua esclusione con taglio/fresatura
  foldOn = on && isFoldable(model);
  $('btnFold').classList.toggle('active', foldOn);
  if (!foldOn) { viewer.clearStock(); return; }
  if (viewer.getView() !== '3D') setViewUI('3D');
  startFromRaw();                          // slider a 0 = barra dritta
  lastFoldT = -1; foldStep(0, true);
  const b = model.meta.bend;
  toast(`Piegatura tubo (${b.format}): OD ${b.od}mm · CLR ${b.clr}mm · ${b.nBends} pieghe · sviluppo ${b.dev.toFixed(0)}mm — premi ▶`, true);
}
// t∈[0,1]: 0 = barra dritta, 1 = pezzo finito
function foldStep(t, force = false) {
  if (!foldOn || !model || !model.meta || !model.meta.bend) return;
  t = Math.max(0, Math.min(1, t));
  if (!force && Math.abs(t - lastFoldT) < 0.008) return;
  lastFoldT = t;
  const { centerline, clr, od } = model.meta.bend;
  const mesh = foldMeshFromCenterline(centerline, clr, od, t);
  mesh.palette = LASER_PALETTE;            // grigio metallico
  viewer.setStock(mesh);
}

let laserIsSheet = false;
async function setLaserMode(on) {
  if (on) { setStockMode(false); setFoldMode(false); }   // mutua esclusione con fresatura/piega
  laserOn = on && isLaserable(model);
  $('btnLaser').classList.toggle('active', laserOn);
  if (!laserOn) { viewer.clearStock(); viewer.setLaserFx(null); return; }
  if (viewer.getView() !== '3D') setViewUI('3D');
  laserIsSheet = isSheet(model);
  toast(`Taglio ${cutProcess.label}: preparazione geometria…`, true);
  laserSim = laserIsSheet
    ? new LaserSheetSim(model, { kerf: cutProcess.kerf, thickness: 3 })
    : new LaserTubeSim(model, { kerf: cutProcess.kerf, wall: (model.meta && model.meta.thickness) || 2 });
  await laserSim.precompute();
  if (!laserOn) return;                         // l'utente ha spento nel frattempo
  if (!laserSim.ok) { laserOn = false; $('btnLaser').classList.remove('active'); toast('Nessun contorno di taglio in questo file'); return; }
  laserHeadReady = false;
  try {
    await loadLaserHead();
    laserHeadReady = true;
    if (laserIsSheet) {
      laserScale = headScaleFor(0.8 * Math.max(model.bounds.max.x - model.bounds.min.x, model.bounds.max.y - model.bounds.min.y));
    } else {
      const p = laserSim.profile;
      const sm = p.type === 'round' ? 2 * p.r : Math.max(p.w, p.h);
      laserScale = headScaleFor(1.3 * sm);   // testa proporzionata alla sezione del tubo
    }
  } catch (e) { /* niente testa */ }
  startFromRaw();                              // parti dal GREZZO (lamiera/tubo intero), poi ▶ per tagliare
  lastLaserDraw = 0;
  revealLaser(0, true);
  const info = laserIsSheet
    ? `${laserSim.regions.filter((r) => !r.isFrame).length} pezzi`
    : `${laserSim.axials.filter((a) => !a.isEnd).length} spezzone, ${laserSim.slugs.length} finestre`;
  toast(`Taglio ${cutProcess.label} (${laserIsSheet ? 'lamiera' : 'tubo'}, kerf ${cutProcess.kerf}mm): ${info}${laserHeadReady ? ' · testa attiva' : ''}`, true);
}

// porta la simulazione all'inizio (pezzo GREZZO): slider a 0, poi ▶ per asportare
function startFromRaw() {
  stopAnim();
  animT = 0;
  /** @type {HTMLInputElement} */ ($('progress')).value = '0';
  viewer.setProgress(0);
  followLine(0);
}

// avanzamento corrente in mm (null = percorso completo)
function state_progress() {
  const v = Number(/** @type {HTMLInputElement} */($('progress')).value);
  return v >= 1000 ? null : (v / 1000) * viewer.getTotal();
}

function stopAnim(reset = false) {
  playing = false;
  $('btnPlay').textContent = '▶';
  if (reset) {
    animT = 0;
    viewer.setProgress(null);
    followLine(null);
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
    followLine(null);
    carveStock(null, true);
    revealLaser(null, true);
    foldStep(1, true);
    stopAnim();
    /** @type {HTMLInputElement} */ ($('progress')).value = '1000';
    return;
  }
  viewer.setProgress(animT);
  followLine(animT);
  carveStock(animT);
  revealLaser(animT);
  foldStep(animT / total);
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
  followLine(v >= 1000 ? null : animT);   // lo scrub manuale segue la riga come il play
  carveStock(v >= 1000 ? null : animT, true);
  revealLaser(v >= 1000 ? null : animT, true);
  foldStep(v / 1000, true);
});

// ---------- toolbar ----------
$('btnOpen').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', (e) => {
  const input = /** @type {HTMLInputElement} */ (e.target);
  if (input.files && input.files[0]) loadFile(input.files[0]);
  input.value = '';
});
$('btnDemo').addEventListener('click', loadDemo);

// DEMO CAM tubo/rotary: pattern sullo svolto → wrap su asse A → G-code QtPlasmaC
// → modello avvolto sul tubo (Svolto + 3D + simulazione). Il G-code emesso è
// mostrato nel pannello codice (sync con il 3D) e scaricabile con ⬇ NC.
$('btnDemoRotary').addEventListener('click', () => {
  try {
    const { model: m, gcode, name } = generateRotaryDemo();
    displayModel(m, name);
    lastGen = { name, text: gcode };
    lastStep = null;
    $('btnGenNc').hidden = true;
    $('btnDlNc').hidden = false;
    toast(`Demo tubo rotary: Ø60×300, ${m.segments.length} segmenti · G-code QtPlasmaC (X/A) pronto — ▶ per simulare, ⬇ NC per scaricarlo`, true);
  } catch (err) {
    console.error(err);
    toast(`Demo rotary fallita: ${/** @type {Error} */(err).message}`);
  }
});

// DXF → Tubo rotary: apre il pannello parametri (Ø, lunghezza, materiale/spessore
// → preset kerf/feed/pierce, lead-in). Genera il G-code QtPlasmaC con kerf
// compensation + lead-in/out e avvolge il disegno sul tubo per la simulazione.
(function initRotaryDlg() {
  const dlg = $('rotaryDlg');
  const mat = /** @type {HTMLSelectElement} */ ($('rMat'));
  // popola i materiali/spessori dal preset plasma
  mat.innerHTML = MILD_STEEL_PLASMA.map((p) => `<option value="${p.t}">Acciaio dolce ${p.t} mm (${p.amps}A)</option>`).join('');
  const applyPreset = () => {
    const p = cutParamsFor(parseFloat(mat.value));
    /** @type {HTMLInputElement} */ ($('rKerf')).value = String(p.kerf);
    /** @type {HTMLInputElement} */ ($('rFeed')).value = String(p.feed);
  };
  mat.addEventListener('change', applyPreset);
  const close = () => { dlg.hidden = true; };
  $('rotaryCancel').addEventListener('click', close);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });

  $('btnDxfRotary').addEventListener('click', () => {
    if (!rotarySrc) return;
    const ext = dxfDesignExtent(rotarySrc);
    if (!ext.contours) { toast('Nessun contorno chiuso nel DXF: servono profili chiusi da tagliare'); return; }
    $('rotaryInfo').textContent =
      `Disegno: ${ext.uSpan.toFixed(0)} mm (asse tubo) × ${ext.vSpan.toFixed(0)} mm (circonferenza) · ${ext.contours} contorni. `
      + `Ø ${ext.suggestedDiameter} mm = un giro esatto.`;
    /** @type {HTMLInputElement} */ ($('rDia')).value = String(ext.suggestedDiameter || 60);
    /** @type {HTMLInputElement} */ ($('rLen')).value = '';
    mat.value = String(2);
    applyPreset();
    dlg.hidden = false;
  });

  $('rotaryGo').addEventListener('click', async () => {
    const diameter = parseFloat(/** @type {HTMLInputElement} */ ($('rDia')).value);
    if (!(diameter > 0)) { toast('Diametro non valido'); return; }
    const lenRaw = parseFloat(/** @type {HTMLInputElement} */ ($('rLen')).value);
    const thickness = parseFloat(mat.value);
    const kerf = parseFloat(/** @type {HTMLInputElement} */ ($('rKerf')).value);
    const feed = parseFloat(/** @type {HTMLInputElement} */ ($('rFeed')).value);
    const lead = /** @type {HTMLSelectElement} */ ($('rLead')).value;
    const leadLen = parseFloat(/** @type {HTMLInputElement} */ ($('rLeadLen')).value);
    const overcut = parseFloat(/** @type {HTMLInputElement} */ ($('rOvercut')).value);
    const topology = /** @type {HTMLSelectElement} */ ($('rTopo')).value;
    const btn = /** @type {HTMLButtonElement} */ ($('rotaryGo'));
    btn.disabled = true;
    toast('Genero il G-code QtPlasmaC (kerf + lead-in)…', true);
    try {
      const { model: m, gcode, name, info } = await wrapDxfToRotary(rotarySrc, {
        diameter, length: Number.isFinite(lenRaw) ? lenRaw : undefined,
        thickness, kerf: Number.isFinite(kerf) ? kerf : undefined,
        feed: Number.isFinite(feed) ? feed : undefined,
        lead: /** @type {any} */ (lead), leadLen: Number.isFinite(leadLen) ? leadLen : undefined,
        overcut: Number.isFinite(overcut) ? overcut : 0, topology: /** @type {any} */ (topology),
      });
      close();
      displayModel(m, name);
      lastGen = { name, text: gcode };
      lastStep = null;
      $('btnGenNc').hidden = true;
      $('btnDlNc').hidden = false;
      toast(`DXF avvolto su tubo: ${info} — ▶ per simulare, ⬇ NC per scaricarlo`, true);
    } catch (err) {
      console.error(err);
      toast(`Wrap DXF→rotary fallito: ${/** @type {Error} */(err).message}`);
    } finally {
      btn.disabled = false;
    }
  });
})();
$('btnFit').addEventListener('click', () => viewer.fit());
$('btnStock').addEventListener('click', () => setStockMode(!stockOn));

// genera la fresatura 3-assi dal pezzo (mesh) col sovrametallo/materiale correnti e attiva la simulazione
async function generateMill(mesh, srcName) {
  const g = partToMillGcode(mesh, { allowance: millAllow });
  const b = g.bbox, mtl = currentMaterial;
  const name = srcName.replace(/\.[^.]+$/, '') + '.mill.ngc';
  applyMaterialToBit();
  await loadText(name, g.gcode);              // (loadText azzera partMillSrc)
  partMillSrc = { mesh, name: srcName };      // ricordo la sorgente per rigenerare al variare del sovrametallo
  setStockMode(true);
  toast(`Fresatura ${mtl.name}: ${g.moves} passate · D${g.toolDia.toFixed(1)} · ${mtl.flutes} taglienti ${mtl.coating} · solido minimo ${(b.x1 - b.x0).toFixed(0)}×${(b.y1 - b.y0).toFixed(0)}×${(b.z1 - b.z0).toFixed(0)}+${millAllow}mm — premi ▶`, true);
}
// → Fresa: dal pezzo 3D (STL/STEP/IGES) alla simulazione di fresatura
$('btnMillPart').addEventListener('click', async () => {
  const cad = isCadPart(model), dxf = !cad && isDxf2d(model);
  if (!cad && !dxf) return;
  const btn = /** @type {HTMLButtonElement} */ ($('btnMillPart'));
  btn.disabled = true;
  try {
    if (dxf) {                                   // DXF 2.5D: contorni → lastra con fori
      const g = dxfToPartMesh(model);
      toast(`DXF → lastra ${(g.outerBB[2] - g.outerBB[0]).toFixed(0)}×${(g.outerBB[3] - g.outerBB[1]).toFixed(0)}×${g.thickness.toFixed(0)}mm, ${g.holes} fori — fresatura…`);
      await generateMill({ positions: g.positions, indices: g.indices }, model.name || 'dxf');
    } else {
      await generateMill(model.mesh, model.name || 'pezzo');
    }
  }
  catch (e) { toast('Fresatura non generata: ' + (e && e.message)); }
  finally { btn.disabled = false; }
});

// selettore materiale: popola e cambia la punta consigliata + parametri
for (const mt of MATERIALS) {
  const o = document.createElement('option'); o.value = mt.id; o.textContent = mt.name;
  $('millMaterial').appendChild(o);
}
$('millMaterial').addEventListener('change', (e) => {
  currentMaterial = materialById(/** @type {HTMLSelectElement} */(e.target).value);
  applyMaterialToBit();
  const m = currentMaterial;
  toast(`${m.name}: metallo duro ${m.flutes} taglienti · ${m.coating} · ${m.geom} · Vc ${m.vc} m/min`, true);
  if (stockOn) carveStock(state_progress(), true);   // ridisegna la punta
});
// sovrametallo del solido di partenza: rigenera (part-based) o ricostruisce lo stock
$('millAllow').addEventListener('change', async (e) => {
  millAllow = Math.max(0, Number(/** @type {HTMLInputElement} */(e.target).value) || 0);
  if (partMillSrc && stockOn) { try { await generateMill(partMillSrc.mesh, partMillSrc.name); } catch { /* ignora */ } }
  else if (stockOn) rebuildMatSim();
});
// toggle 3 / 4-5 assi: in 4-5 assi il tri-dexel usa l'orientamento utensile dal G-code
$('millAxes').addEventListener('change', (e) => {
  fiveAxis = /** @type {HTMLSelectElement} */(e.target).value === '5';
  toast(fiveAxis ? 'Fresatura 4-5 assi: uso l\'orientamento utensile (B/C o EI/EJ/EK) dal G-code' : 'Fresatura 3 assi: utensile verticale (+Z)', true);
  if (stockOn) rebuildMatSim();
});

// slider risoluzione tri-dexel: aggiorna al rilascio (ricostruire è costoso)
$('millRes').addEventListener('input', (e) => { millRes = Number(/** @type {HTMLInputElement} */(e.target).value); });
$('millRes').addEventListener('change', () => rebuildMatSim());
// menu posizione punta: avanzamento vs segmento selezionato
$('bitMode').addEventListener('change', (e) => {
  bitMode = /** @type {HTMLSelectElement} */(e.target).value;
  if (stockOn) carveStock(state_progress(), true);
});
$('btnLaser').addEventListener('click', () => setLaserMode(!laserOn));

// selettore processo di taglio: popola le opzioni e cambia kerf/effetto al volo
for (const p of CUT_PROCESSES) {
  const o = document.createElement('option'); o.value = p.id; o.textContent = p.label;
  $('procSelect').appendChild(o);
}
$('procSelect').addEventListener('change', (e) => {
  cutProcess = processById(/** @type {HTMLSelectElement} */ (e.target).value);
  if (laserOn) setLaserMode(true);   // ricostruisce la simulazione col nuovo kerf
});

$('btnFold').addEventListener('click', () => setFoldMode(!foldOn));

// ---- controllo del 3D con le MANI (webcam) ----
// Disponibile su WEB (sviluppo/test diretto nel browser) e nell'app desktop: è lo
// stesso codice condiviso, così ciò che sistemiamo sul web finisce anche nell'app.
$('btnHands').hidden = false;
let handCtl = null, handsOn = false;
async function setHandsMode(on) {
  if (on) {
    if (viewer.getView() !== '3D') setViewUI('3D');
    if (!handCtl) handCtl = createHandControl(viewer, { onStatus: (m) => toast(m, true) });
    $('btnHands').classList.add('active'); handsOn = true;
    try {
      await handCtl.start();
      toast('Mani attive: 🖐 muovi il palmo per orbitare · 🤏 pinch pollice+indice per zoom', true);
    } catch (e) {
      handsOn = false; $('btnHands').classList.remove('active');
      if (handCtl) handCtl.stop();
      toast('Mani — ' + (e && e.message ? e.message : 'non disponibile'));
    }
  } else {
    handsOn = false; $('btnHands').classList.remove('active');
    if (handCtl) handCtl.stop();
    toast('Controllo a mani spento');
  }
}
$('btnHands').addEventListener('click', () => setHandsMode(!handsOn));

// ---------- STEP → NC (pipeline generatore + post) ----------
$('btnGenNc').addEventListener('click', async () => {
  if (!lastStep) return;
  const btn = /** @type {HTMLButtonElement} */ ($('btnGenNc'));
  const src = lastStep;
  btn.disabled = true;
  const oldLabel = btn.textContent;
  btn.textContent = '⚙ genero…';
  toast('Generazione NC dal B-rep (motore WASM)…', true);
  try {
    const { stepToNc } = await import('./generator/step2nc.js');
    const r = await stepToNc(src.text, { name: src.name });
    const genName = src.name.replace(/\.(stp|step)$/i, '') + '.gen.' + r.ext;
    lastGen = { name: genName, text: r.nc };
    await loadText(genName, r.nc);          // carica l'NC generato nel viewer
    $('btnDlNc').hidden = false;
    toast(`NC generato — ${r.info} (post ${r.post}) · ⬇ per salvarlo`, true);
  } catch (err) {
    console.error(err);
    toast(`Generazione fallita: ${/** @type {Error} */(err).message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = oldLabel;
  }
});

$('btnDlNc').addEventListener('click', () => {
  if (!lastGen) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lastGen.text], { type: 'text/plain' }));
  a.download = lastGen.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});
$('chkRapids').addEventListener('change', (e) => viewer.setShowRapids(/** @type {HTMLInputElement} */(e.target).checked));
$('chkPoints').addEventListener('change', (e) => viewer.setShowPoints(/** @type {HTMLInputElement} */(e.target).checked));

function setViewUI(v) {
  viewer.setView(v);
  document.querySelectorAll('#viewBtns button').forEach((x) => {
    x.classList.toggle('active', /** @type {HTMLElement} */(x).dataset.v === v);
  });
  // toggle Solido/Filo: solo in 3D e se il modello ha una mesh solida
  $('btnSolid').hidden = !(v === '3D' && viewer.hasMesh());
  updateZoomLabel();
}

$('btnSolid').addEventListener('click', () => {
  const on = !viewer.getSolid();
  viewer.setSolid(on);
  $('btnSolid').classList.toggle('active', on);
  $('btnSolid').innerHTML = on ? '&#9632; Solido' : '&#9633; Filo';
});
document.querySelectorAll('#viewBtns button').forEach((b) => {
  b.addEventListener('click', () => {
    lastUserView = /** @type {HTMLElement} */(b).dataset.v;   // ricorda la scelta esplicita per i file successivi
    try { localStorage.setItem('lge.view', lastUserView); } catch { /* storage non disponibile */ }
    setViewUI(lastUserView);
  });
});

for (const [btn, panel] of [['btnCode', 'codePanel'], ['btnInfo', 'infoPanel']]) {
  $(btn).addEventListener('click', () => {
    $(btn).classList.toggle('active');
    $(panel).classList.toggle('hidden', !$(btn).classList.contains('active'));
  });
}

window.addEventListener('keydown', (e) => {
  // Ctrl+F apre la ricerca da qualsiasi punto
  if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    /** @type {HTMLInputElement} */ ($('searchInput')).focus();
    /** @type {HTMLInputElement} */ ($('searchInput')).select();
    return;
  }
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
/** @type {any} */ (window).__viewer = viewer;

// avvio: ?file=percorso/relativo carica un file servito dal server, altrimenti demo
const startFile = new URLSearchParams(location.search).get('file');
if (startFile) {
  const name = startFile.split('/').pop() || startFile;
  fetch(startFile)
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r; })
    .then(async (r) => loadText(name, isBinaryExt(name) ? new Uint8Array(await r.arrayBuffer()) : await r.text()))
    .catch((e) => toast(`Impossibile caricare ${startFile}: ${e.message}`));
} else {
  loadDemo();
}
