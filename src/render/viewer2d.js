// @ts-check
// Renderer 2D su canvas: griglia adattiva, pan/zoom, colori per utensile,
// hit-test per hover/selezione, simulazione del percorso con marker.
// Consuma SOLO lo SceneModel: non sa nulla dei formati file.
import { foldToStrip } from '../core/unroll.js';
import { createThree3D } from './three3d.js';   // backend WebGL della SOLA vista 3D

export const TOOL_COLORS = [
  '#4cc9f0', '#f8961e', '#90be6d', '#f94144',
  '#c77dff', '#ffd166', '#43aa8b', '#ff70a6',
];
const RAPID_COLOR = '#8a5560';
const DIM_ALPHA = 0.18;

// proiezioni di vista (indipendenti dal piano degli archi)
// DEV = "tubo svolto": usa seg.uv precalcolato dai loader (u assiale, v perimetro)
// 3D = orbita ortografica (azimut/elevazione), Z-up
const VIEWS = {
  XY: { u: (p) => p.x, v: (p) => p.y, labels: ['X', 'Y'] },
  XZ: { u: (p) => p.x, v: (p) => p.z, labels: ['X', 'Z'] },
  YZ: { u: (p) => p.y, v: (p) => p.z, labels: ['Y', 'Z'] },
  DEV: { u: null, v: null, labels: ['L', 'C'] },
  '3D': { u: null, v: null, labels: ['3D'], orbit: true },
};

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{onHover?:Function, onPick?:Function, onViewChange?:Function}} cb
 */
export function createViewer(canvas, cb = {}) {
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));

  const state = {
    model: /** @type {any} */ (null),
    view: 'XY',
    camU: 0, camV: 0,          // centro vista in coordinate mondo
    scale: 4,                  // px per mm
    yaw: -0.8,                 // azimut orbita 3D (rad)
    pitch: 0.5,                // elevazione orbita 3D (rad)
    pivot: { x: 0, y: 0, z: 0 }, // centro di rotazione 3D = centro del pezzo (l'orbita gira attorno al modello, non aggancia l'origine)
    showRapids: true,
    showPoints: true,
    solid: true,               // vista 3D: solido ombreggiato (true) o solo filo (false)
    hiddenTools: new Set(),
    selected: /** @type {any} */ (null),
    hovered: /** @type {any} */ (null),
    progress: /** @type {number|null} */ (null),  // lunghezza percorsa (mm), null = tutto
    // cache per vista corrente
    proj: /** @type {{seg:any, pts:Float64Array}[]} */ ([]),
    cum: /** @type {number[]} */ ([]),             // lunghezza cumulata per segmento
    total: 0,
    // simulazione asportazione: mesh dello stock scavato (rimpiazza il solido in 3D)
    stock: /** @type {{positions:Float64Array, indices:Uint32Array, fresh?:Uint8Array, triTool?:Uint32Array, palette?:number[][]}|null} */ (null),
    stockVersion: 0,
    laserFx: /** @type {{x:number,y:number,z:number}|null} */ (null),   // punto di lavoro (FX)
    laserFxKind: 'laser',   // 'laser' = bagliore+scintille · 'mill' = trucioli
    laserFxSeed: 0,
  };

  let w = 0, h = 0, dpr = 1;
  let pendingFit = false;   // fit richiesto quando il canvas non era ancora misurato

  // ---- backend 3D WebGL (three.js): canvas sovrapposto, init pigra, fallback 2D ----
  let three = null, threeOn = false, threeFailed = false, canvas3d = null, threeSceneModel = null;
  let canvasFx = null, ctxFx = null;   // overlay 2D sopra il WebGL per FX/marker (screen-space)
  function ensureThree() {
    if (three) return true;
    if (threeFailed || !canvas.parentNode) return false;
    try {
      canvas3d = document.createElement('canvas');
      canvas3d.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:none;touch-action:none;';
      canvas.parentNode.insertBefore(canvas3d, canvas.nextSibling);
      // overlay 2D per FX/marker (screen-space), sopra il WebGL, trasparente ai click
      canvasFx = document.createElement('canvas');
      canvasFx.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:none;pointer-events:none;';
      canvas.parentNode.insertBefore(canvasFx, canvas3d.nextSibling);
      ctxFx = canvasFx.getContext('2d');
      three = createThree3D(canvas3d, {
        toolRGB,
        rapidRGB: [0x8a, 0x55, 0x60],
      });
      // hover/selezione sul canvas 3D (l'orbita/zoom/pan li gestisce OrbitControls)
      let downX = 0, downY = 0, dragged = false;
      canvas3d.addEventListener('mousedown', (e) => { downX = e.offsetX; downY = e.offsetY; dragged = false; });
      canvas3d.addEventListener('mousemove', (e) => {
        if (e.buttons) { if (Math.abs(e.offsetX - downX) + Math.abs(e.offsetY - downY) > 3) dragged = true; return; }
        const seg = three.pick(e.offsetX, e.offsetY, state.model);
        if (seg !== state.hovered) { state.hovered = seg; cb.onHover && cb.onHover(seg, null); three.render(); }
      });
      canvas3d.addEventListener('mouseup', (e) => {
        if (dragged) return;
        const seg = three.pick(e.offsetX, e.offsetY, state.model);
        state.selected = seg; cb.onPick && cb.onPick(seg); three.render();
      });
      canvas3d.addEventListener('mouseleave', () => { if (state.hovered) { state.hovered = null; cb.onHover && cb.onHover(null, null); three.render(); } });
      // misura subito (il ResizeObserver potrebbe non aver ancora impostato w,h)
      const r = canvas.getBoundingClientRect();
      const cw = r.width || w || 800, ch = r.height || h || 600;
      three.resize(cw, ch, window.devicePixelRatio || 1);
      return true;
    } catch (err) { console.warn('three.js non disponibile → uso il canvas 2D per il 3D:', err); threeFailed = true; three = null; return false; }
  }
  // sincronizza la scena three.js col modello/stock correnti
  function threeSyncScene() {
    if (threeSceneModel !== state.model) { three.setScene(state.model); threeSceneModel = state.model; }
    if (state.stock) three.setStock(state.stock); else three.clearStock();
    three.setDrillsVisible(state.showPoints);
  }
  // costruisce le linee dello SVOLTO (DEV) per three da state.proj (coord u,v già ripiegate)
  function buildThreeFlat() {
    const lines = [];
    let minU = Infinity, maxU = -Infinity;
    for (const p of state.proj) {
      if (!visible(p.seg)) continue;
      const rgb = p.seg.type === 'rapid' ? [0x8a, 0x55, 0x60] : toolRGB(p.seg.tool);
      lines.push({ pts: p.pts, rgb, breaks: p.breaks });
      for (let i = 0; i < p.pts.length; i += 2) { if (p.pts[i] < minU) minU = p.pts[i]; if (p.pts[i] > maxU) maxU = p.pts[i]; }
    }
    const guides = (state.model && state.model.meta && state.model.meta.unrollGuides) || null;
    three.setFlat(lines, guides, [minU === Infinity ? 0 : minU, maxU === -Infinity ? 0 : maxU]);
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    w = r.width; h = r.height;
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    if (three && w > 0 && h > 0) three.resize(w, h, dpr);
    if (canvasFx && w > 0 && h > 0) { canvasFx.width = Math.round(w * dpr); canvasFx.height = Math.round(h * dpr); }
    if (pendingFit && w > 0 && h > 0) {
      pendingFit = false;
      api.fit();
    } else {
      draw();
    }
  }
  new ResizeObserver(resize).observe(canvas);

  // ---------- trasformazioni ----------
  const toScreen = (u, v) => [ (u - state.camU) * state.scale + w / 2,
                               h / 2 - (v - state.camV) * state.scale ];
  const toWorld = (sx, sy) => [ (sx - w / 2) / state.scale + state.camU,
                                (h / 2 - sy) / state.scale + state.camV ];

  // rotazione orbitale pura di una DIREZIONE (azimut attorno a Z world-up, elevazione).
  // Restituisce [u destra, v alto] sul piano schermo. Niente traslazione: per i vettori
  // (gizmo assi) e come base della proiezione dei punti.
  function rot3d(x, y, z) {
    const sa = Math.sin(state.yaw), ca = Math.cos(state.yaw);
    const se = Math.sin(state.pitch), ce = Math.cos(state.pitch);
    return [
      x * sa - y * ca,
      -x * se * ca - y * se * sa + z * ce,
    ];
  }

  // proiezione orbitale 3D di un PUNTO: ruota attorno al PIVOT (centro del pezzo),
  // così l'orbita gira intorno al modello e non "aggancia" l'origine 0,0,0 (turntable CAD).
  function project3d(p) {
    return rot3d(p.x - state.pivot.x, p.y - state.pivot.y, p.z - state.pivot.z);
  }

  // versore verso la camera (per profondità painter's e illuminazione)
  function viewDir() {
    const sa = Math.sin(state.yaw), ca = Math.cos(state.yaw);
    const se = Math.sin(state.pitch), ce = Math.cos(state.pitch);
    return [ce * ca, ce * sa, se];
  }

  // ---------- cache proiezione ----------
  function rebuildProjection() {
    state.proj = [];
    state.cum = [];
    state.total = 0;
    if (!state.model) return;
    const V = VIEWS[state.view];
    const per = state.model.meta && state.model.meta.perimeter;
    for (const seg of state.model.segments) {
      let pts;
      let breaks = null;   // indici (vista DEV) in cui la polilinea attraversa la cucitura
      if (state.view === 'DEV') {
        if (!seg.uv) continue;   // segmento senza sviluppo
        pts = new Float64Array(seg.uv.length * 2);
        let prevV = 0;
        for (let i = 0; i < seg.uv.length; i++) {
          // ripiega su UNA sola sezione: i giri completi (troncatura) restano
          // nella stessa striscia [-per/2, per/2) invece di scorrere via
          const v = per ? foldToStrip(seg.uv[i].v, per) : seg.uv[i].v;
          if (per && i > 0 && Math.abs(v - prevV) > per / 2) (breaks ||= new Set()).add(i);
          pts[i * 2] = seg.uv[i].u;
          pts[i * 2 + 1] = v;
          prevV = v;
        }
      } else if (state.view === '3D') {
        const src = seg.tubePts || seg.pts;   // tubi: punti avvolti sul solido
        pts = new Float64Array(src.length * 2);
        for (let i = 0; i < src.length; i++) {
          const [u, v] = project3d(src[i]);
          pts[i * 2] = u; pts[i * 2 + 1] = v;
        }
      } else {
        pts = new Float64Array(seg.pts.length * 2);
        for (let i = 0; i < seg.pts.length; i++) {
          pts[i * 2] = V.u(seg.pts[i]);
          pts[i * 2 + 1] = V.v(seg.pts[i]);
        }
      }
      state.proj.push({ seg, pts, breaks });
      state.total += seg.len;
      state.cum.push(state.total);
    }
  }

  function visible(seg) {
    if (seg.type === 'rapid' && !state.showRapids) return false;
    if (state.hiddenTools.has(seg.tool)) return false;
    return true;
  }

  // ---------- griglia ----------
  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 5, 10]) if (raw <= m * p) return m * p;
    return 10 * p;
  }

  // bbox {min,max} da un buffer di posizioni piatto (x,y,z…); null se vuoto
  function meshBBox(P) {
    if (!P || !P.length) return null;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { const v = P[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
    return { min: { x: mn[0], y: mn[1], z: mn[2] }, max: { x: mx[0], y: mx[1], z: mx[2] } };
  }

  // pivot dell'orbita = centro dell'ingombro 3D corrente (stock scavato, altrimenti
  // mesh, altrimenti bbox del percorso). Così il modello ruota attorno a sé stesso.
  function computePivot() {
    const bb = (state.stock && meshBBox(state.stock.positions)) || bounds3d();
    state.pivot = bb && bb.min
      ? { x: (bb.min.x + bb.max.x) / 2, y: (bb.min.y + bb.max.y) / 2, z: (bb.min.z + bb.max.z) / 2 }
      : { x: 0, y: 0, z: 0 };
  }

  // estensione 3D per la griglia: usa la mesh (tubo/solido) se presente
  function bounds3d() {
    const m = state.model;
    if (m && m.mesh) {
      const P = m.mesh.positions;
      const min = { x: Infinity, y: Infinity, z: Infinity };
      const max = { x: -Infinity, y: -Infinity, z: -Infinity };
      for (let i = 0; i < P.length; i += 3) {
        if (P[i] < min.x) min.x = P[i]; if (P[i] > max.x) max.x = P[i];
        if (P[i + 1] < min.y) min.y = P[i + 1]; if (P[i + 1] > max.y) max.y = P[i + 1];
        if (P[i + 2] < min.z) min.z = P[i + 2]; if (P[i + 2] > max.z) max.z = P[i + 2];
      }
      return { min, max };
    }
    return m && m.bounds;
  }

  // griglia di terra sul piano XY (z=0) per la vista 3D + gizmo assi
  function draw3dScene() {
    const b = bounds3d();
    if (b) {
      const step = niceStep(Math.max(b.max.x - b.min.x, b.max.y - b.min.y) / 8 || 10);
      const x0 = Math.floor(b.min.x / step) * step, x1 = Math.ceil(b.max.x / step) * step;
      const y0 = Math.floor(b.min.y / step) * step, y1 = Math.ceil(b.max.y / step) * step;
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#1b212a';
      const line3 = (ax, ay, az, bx, by, bz) => {
        const [su, sv] = project3d({ x: ax, y: ay, z: az });
        const [eu, ev] = project3d({ x: bx, y: by, z: bz });
        const [s0, s1] = toScreen(su, sv), [e0, e1] = toScreen(eu, ev);
        ctx.beginPath(); ctx.moveTo(s0, s1); ctx.lineTo(e0, e1); ctx.stroke();
      };
      for (let x = x0; x <= x1 + 1e-6; x += step) line3(x, y0, 0, x, y1, 0);
      for (let y = y0; y <= y1 + 1e-6; y += step) line3(x0, y, 0, x1, y, 0);
    }
    drawGizmo();
  }

  // gizmo assi (orientamento corrente) in basso a sinistra
  function drawGizmo() {
    const ox = 46, oy = h - 46, L = 26;
    const axes = [
      [1, 0, 0, '#f94144', 'X'],
      [0, 1, 0, '#90be6d', 'Y'],
      [0, 0, 1, '#4cc9f0', 'Z'],
    ];
    ctx.font = 'bold 11px Consolas, monospace';
    for (const [ax, ay, az, col, lab] of axes) {
      const [u, v] = rot3d(ax, ay, az);   // direzione: rotazione pura (no pivot)
      const ex = ox + u * L, ey = oy - v * L;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillText(lab, ex + (u >= 0 ? 2 : -9), ey + (v >= 0 ? -2 : 9));
    }
  }

  // rendering solido ombreggiato della mesh (vista 3D)
  let triOrder = null, triOrderKey = '';
  function drawSolidMesh() {
    const mesh = state.model && state.model.mesh;
    if (!mesh) return;
    const P = mesh.positions, I = mesh.indices, TT = mesh.triTool;
    const nTri = I.length / 3;
    const [dx, dy, dz] = viewDir();

    // ordine painter's: ricalcola solo se l'orbita è cambiata sensibilmente
    const okey = `${Math.round(state.yaw * 20)},${Math.round(state.pitch * 20)}`;
    if (!triOrder || triOrder.length !== nTri || triOrderKey !== okey) {
      triOrder = new Int32Array(nTri);
      const depth = new Float64Array(nTri);
      for (let t = 0; t < nTri; t++) {
        const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
        const cxp = (P[a] + P[b] + P[c]) / 3, cyp = (P[a + 1] + P[b + 1] + P[c + 1]) / 3, czp = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
        depth[t] = cxp * dx + cyp * dy + czp * dz;
        triOrder[t] = t;
      }
      triOrder.sort((s, t) => depth[s] - depth[t]);   // lontano → vicino
      triOrderKey = okey;
    }

    // luce da davanti-alto
    let lx = dx, ly = dy, lz = dz + 0.65;
    const ll = Math.hypot(lx, ly, lz) || 1; lx /= ll; ly /= ll; lz /= ll;

    for (let oi = 0; oi < nTri; oi++) {
      const t = triOrder[oi];
      const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
      // normale
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const diff = Math.abs(nx * lx + ny * ly + nz * lz);   // illuminazione a due facce
      const shade = 0.32 + 0.68 * diff;

      const [r, g, bl] = toolRGB(TT ? TT[t] : 1);
      ctx.fillStyle = `rgb(${(r * shade) | 0},${(g * shade) | 0},${(bl * shade) | 0})`;
      const [x0, y0] = toScreen(...project3d({ x: P[a], y: P[a + 1], z: P[a + 2] }));
      const [x1, y1] = toScreen(...project3d({ x: P[b], y: P[b + 1], z: P[b + 2] }));
      const [x2, y2] = toScreen(...project3d({ x: P[c], y: P[c + 1], z: P[c + 2] }));
      ctx.beginPath();
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.closePath();
      ctx.fill();
    }
  }

  // rendering dello STOCK scavato (simulazione asportazione): materiale grigio
  // metallico, triangoli "appena tagliati" (mesh.fresh) in tinta calda.
  let stockOrder = null, stockOrderKey = '';
  function drawStock() {
    const mesh = state.stock;
    if (!mesh) return;
    const P = mesh.positions, I = mesh.indices, F = mesh.fresh, TT = mesh.triTool, PAL = mesh.palette;
    const nTri = I.length / 3;
    const [dx, dy, dz] = viewDir();
    // ordine painter's: ricalcola su cambio orbita O su nuovo carve (stockVersion)
    const okey = `${Math.round(state.yaw * 20)},${Math.round(state.pitch * 20)},${state.stockVersion}`;
    if (!stockOrder || stockOrder.length !== nTri || stockOrderKey !== okey) {
      stockOrder = new Int32Array(nTri);
      const depth = new Float64Array(nTri);
      for (let t = 0; t < nTri; t++) {
        const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
        depth[t] = (P[a] + P[b] + P[c]) * dx + (P[a + 1] + P[b + 1] + P[c + 1]) * dy + (P[a + 2] + P[b + 2] + P[c + 2]) * dz;
        stockOrder[t] = t;
      }
      stockOrder.sort((s, t) => depth[s] - depth[t]);
      stockOrderKey = okey;
    }
    let lx = dx, ly = dy, lz = dz + 0.65;
    const ll = Math.hypot(lx, ly, lz) || 1; lx /= ll; ly /= ll; lz /= ll;
    for (let oi = 0; oi < nTri; oi++) {
      const t = stockOrder[oi];
      const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const shade = 0.34 + 0.66 * Math.abs(nx * lx + ny * ly + nz * lz);
      let r, g, bl;
      if (PAL && TT) { const c = PAL[TT[t]] || PAL[0] || [0x8c, 0x98, 0xa6]; r = c[0]; g = c[1]; bl = c[2]; }  // palette per triTool (laser)
      else { const fresh = F && F[t]; r = fresh ? 0xf0 : 0x8c; g = fresh ? 0xa8 : 0x98; bl = fresh ? 0x5a : 0xa6; }
      ctx.fillStyle = `rgb(${(r * shade) | 0},${(g * shade) | 0},${(bl * shade) | 0})`;
      const [x0, y0] = toScreen(...project3d({ x: P[a], y: P[a + 1], z: P[a + 2] }));
      const [x1, y1] = toScreen(...project3d({ x: P[b], y: P[b + 1], z: P[b + 2] }));
      const [x2, y2] = toScreen(...project3d({ x: P[c], y: P[c + 1], z: P[c + 2] }));
      ctx.beginPath();
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.closePath();
      ctx.fill();
    }
  }

  // effetto al punto di lavoro (px `sx,sy`) sul contesto `gc`: laser=bagliore+scintille,
  // fresatura=trucioli, waterjet=getto. Riusabile su canvas 2D e overlay 3D (three.js).
  function drawFxAt(gc, sx, sy, R) {
    const seed = state.laserFxSeed || 0;
    gc.save();
    if (state.laserFxKind === 'mill') {
      // trucioli: frammenti metallici che schizzano fuori con gravità
      gc.lineCap = 'round'; gc.lineWidth = 1.7;
      for (let i = 0; i < 11; i++) {
        const a = (i * 2.399 + seed * 1.9);
        const d = R * (0.5 + ((seed * 7 + i * 13) % 10) / 10);
        gc.strokeStyle = i % 3 ? 'rgba(196,206,218,0.9)' : 'rgba(150,162,178,0.85)';
        gc.beginPath();
        gc.moveTo(sx + Math.cos(a) * R * 0.2, sy + Math.sin(a) * R * 0.2);
        gc.lineTo(sx + Math.cos(a) * d, sy + Math.sin(a) * d + R * 0.45);
        gc.stroke();
      }
    } else if (state.laserFxKind === 'waterjet') {
      gc.lineCap = 'round';
      gc.strokeStyle = 'rgba(120,210,255,0.55)'; gc.lineWidth = 2.2;
      gc.beginPath(); gc.moveTo(sx, sy - R * 0.4); gc.lineTo(sx, sy + R * 1.3); gc.stroke();
      for (let i = 0; i < 9; i++) {
        const spread = (((seed * 7 + i * 11) % 10) / 10 - 0.5) * 1.1;
        const d = R * (0.7 + ((seed * 5 + i * 13) % 10) / 10);
        gc.strokeStyle = i % 2 ? 'rgba(180,235,255,0.8)' : 'rgba(90,180,230,0.7)';
        gc.lineWidth = 1.3;
        gc.beginPath(); gc.moveTo(sx, sy);
        gc.lineTo(sx + Math.sin(spread) * d, sy + Math.cos(spread) * d);
        gc.stroke();
      }
    } else {
      const C = state.laserFxKind === 'plasma'
        ? { core: '235,245,255', mid: '120,170,255', edge: '40,90,255', spark: '170,210,255', grav: 0.25, n: 8 }
        : state.laserFxKind === 'oxy'
          ? { core: '255,240,210', mid: '255,140,40', edge: '210,40,10', spark: '255,160,60', grav: 0.6, n: 7 }
          : { core: '255,255,240', mid: '255,180,60', edge: '255,90,20', spark: '255,210,120', grav: 0.25, n: 6 };
      const grad = gc.createRadialGradient(sx, sy, 0, sx, sy, R);
      grad.addColorStop(0, `rgba(${C.core},0.95)`);
      grad.addColorStop(0.3, `rgba(${C.mid},0.7)`);
      grad.addColorStop(1, `rgba(${C.edge},0)`);
      gc.globalCompositeOperation = 'lighter';
      gc.fillStyle = grad;
      gc.beginPath(); gc.arc(sx, sy, R, 0, Math.PI * 2); gc.fill();
      gc.strokeStyle = `rgba(${C.spark},0.9)`; gc.lineWidth = 1.4;
      for (let i = 0; i < C.n; i++) {
        const a = ((i * 2.399 + seed * 1.7) % (Math.PI * 2));
        const len = R * (0.8 + ((seed * 13 + i * 7) % 10) / 10);
        gc.beginPath(); gc.moveTo(sx, sy);
        gc.lineTo(sx + Math.cos(a) * len, sy + Math.sin(a) * len + len * C.grav);
        gc.stroke();
      }
    }
    gc.restore();
  }
  // canvas 2D: proietta il punto di lavoro con la proiezione interna
  function drawLaserFx() {
    const [u, v] = project3d(state.laserFx);
    drawFxAt(ctx, ...toScreen(u, v), Math.max(7, 16 * Math.min(2, state.scale / 4)));
  }

  function drawGrid() {
    const step = niceStep(70 / state.scale);
    const [u0, v1] = toWorld(0, 0);
    const [u1, v0] = toWorld(w, h);
    ctx.lineWidth = 1;
    ctx.font = '10px Consolas, monospace';
    ctx.fillStyle = '#5a6473';
    const dec = step < 1 ? Math.min(3, -Math.floor(Math.log10(step))) : 0;
    for (let u = Math.floor(u0 / step) * step; u <= u1; u += step) {
      const [sx] = toScreen(u, 0);
      ctx.strokeStyle = Math.abs(u) < step / 2 ? '#3d4757' : '#1d232c';
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
      ctx.fillText(u.toFixed(dec), sx + 3, h - 5);
    }
    for (let v = Math.floor(v0 / step) * step; v <= v1; v += step) {
      const [, sy] = toScreen(0, v);
      ctx.strokeStyle = Math.abs(v) < step / 2 ? '#3d4757' : '#1d232c';
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
      ctx.fillText(v.toFixed(dec), 4, sy - 3);
    }
    // etichette assi della vista
    const V = VIEWS[state.view];
    ctx.fillStyle = '#7f8a99';
    ctx.font = 'bold 11px Consolas, monospace';
    ctx.fillText(V.labels[0] + ' →', w - 40, h - 18);
    ctx.fillText(V.labels[1] + ' ↑', 8, 16);
  }

  // ---------- disegno segmenti ----------
  function strokeSeg(p, fromLen, uptoLen) {
    // disegna il segmento p, eventualmente solo fino a uptoLen (per l'animazione)
    const { seg, pts, breaks } = p;
    const n = pts.length / 2;
    ctx.beginPath();
    let [sx, sy] = toScreen(pts[0], pts[1]);
    ctx.moveTo(sx, sy);
    if (uptoLen === undefined || uptoLen >= seg.len) {
      for (let i = 1; i < n; i++) {
        [sx, sy] = toScreen(pts[i * 2], pts[i * 2 + 1]);
        if (breaks && breaks.has(i)) ctx.moveTo(sx, sy);   // salta la cucitura
        else ctx.lineTo(sx, sy);
      }
    } else {
      // parziale: cammina lungo la polilinea
      const frac = Math.max(0, uptoLen) / seg.len;
      let target = frac * polyLen(p);
      let acc = 0;
      for (let i = 1; i < n; i++) {
        [sx, sy] = toScreen(pts[i * 2], pts[i * 2 + 1]);
        if (breaks && breaks.has(i)) { ctx.moveTo(sx, sy); continue; }   // cucitura: sposta senza tracciare né contare
        const du = pts[i * 2] - pts[(i - 1) * 2];
        const dv = pts[i * 2 + 1] - pts[(i - 1) * 2 + 1];
        const l = Math.hypot(du, dv);
        if (acc + l >= target && l > 0) {
          const t = (target - acc) / l;
          [sx, sy] = toScreen(pts[(i - 1) * 2] + du * t, pts[(i - 1) * 2 + 1] + dv * t);
          ctx.lineTo(sx, sy);
          break;
        }
        acc += l;
        ctx.lineTo(sx, sy);
      }
    }
    ctx.stroke();
  }

  function polyLen(p) {
    const pts = p.pts || p;
    const breaks = p.breaks;
    let L = 0;
    for (let i = 2; i < pts.length; i += 2) {
      if (breaks && breaks.has(i / 2)) continue;   // non contare il salto di cucitura
      L += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    }
    return L;
  }

  function toolColor(tool) {
    if (!state.model) return TOOL_COLORS[0];
    const idx = state.model.stats.tools.indexOf(tool);
    return TOOL_COLORS[(idx < 0 ? 0 : idx) % TOOL_COLORS.length];
  }
  function toolRGB(tool) {
    const hex = toolColor(tool);
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }

  function drawModel() {
    if (!state.model) return;
    const animating = state.progress !== null && state.progress < state.total;
    // In simulazione asportazione (fresatura/laser) il pezzo è il SOLIDO scavato:
    // mostrare l'intero percorso lo farebbe sembrare già finito. Disegno solo la
    // SCIA già percorsa, sottile e tenue; niente rapidi, niente percorso futuro.
    const overStock = !!state.stock;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (let i = 0; i < state.proj.length; i++) {
      const p = state.proj[i];
      if (!visible(p.seg)) continue;
      const done = !animating || state.cum[i] <= state.progress;
      const startLen = state.cum[i] - p.seg.len;
      const partial = animating && !done && startLen < /** @type {number} */(state.progress);

      if (overStock) {
        if (p.seg.type === 'rapid') continue;                 // niente rapidi sul solido
        if (!done && !partial) continue;                      // niente percorso ANCORA da tagliare
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = toolColor(p.seg.tool);
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        if (partial) strokeSeg(p, 0, /** @type {number} */(state.progress) - startLen);
        else strokeSeg(p);
        continue;
      }

      ctx.globalAlpha = done || partial ? 1 : DIM_ALPHA;
      if (p.seg.type === 'rapid') {
        ctx.strokeStyle = RAPID_COLOR;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
      } else {
        ctx.strokeStyle = toolColor(p.seg.tool);
        ctx.lineWidth = 1.6;
        ctx.setLineDash([]);
      }
      if (partial) {
        // parte percorsa piena…
        strokeSeg(p, 0, /** @type {number} */(state.progress) - startLen);
        // …resto attenuato
        ctx.globalAlpha = DIM_ALPHA;
        strokeSeg(p);
      } else {
        strokeSeg(p);
      }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // punti di foratura
    if (state.showPoints && !overStock) {
      const V = VIEWS[state.view];
      for (const d of state.model.drillPoints) {
        if (state.hiddenTools.has(d.tool)) continue;
        let du, dv;
        if (state.view === 'DEV') {
          if (!d.uv) continue;
          du = d.uv.u; dv = d.uv.v;
        } else if (state.view === '3D') {
          [du, dv] = project3d(d.at);
        } else {
          du = V.u(d.at); dv = V.v(d.at);
        }
        if (animating && state.cum[Math.min(d.afterSeg, state.cum.length) - 1] > state.progress
            && d.afterSeg > 0) ctx.globalAlpha = DIM_ALPHA;
        const [sx, sy] = toScreen(du, dv);
        ctx.strokeStyle = toolColor(d.tool);
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sx - 6, sy); ctx.lineTo(sx + 6, sy);
        ctx.moveTo(sx, sy - 6); ctx.lineTo(sx, sy + 6);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // evidenziazione hover / selezione
    for (const [seg, color, lw] of [
      [state.hovered, '#9fd8ff', 3],
      [state.selected, '#ffffff', 3.5],
    ]) {
      if (!seg) continue;
      const p = state.proj.find((q) => q.seg === seg);
      if (!p) continue;
      ctx.strokeStyle = /** @type {string} */ (color);
      ctx.lineWidth = /** @type {number} */ (lw);
      ctx.globalAlpha = 0.9;
      ctx.setLineDash(seg.type === 'rapid' ? [5, 4] : []);
      strokeSeg(p);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // marker posizione corrente (animazione) — non sul solido: lo marca già l'utensile/FX
    if (animating && !overStock) {
      const pos = positionAt(/** @type {number} */(state.progress));
      if (pos) {
        const [sx, sy] = toScreen(pos[0], pos[1]);
        ctx.fillStyle = '#ffdd00';
        ctx.strokeStyle = '#00000088';
        ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
  }

  /** Coordinate mondo (u,v) alla lunghezza percorsa `len`. */
  function positionAt(len) {
    const i = lowerBound(state.cum, len);
    if (i >= state.proj.length) return null;
    const p = state.proj[i];
    const startLen = state.cum[i] - p.seg.len;
    const local = Math.max(0, len - startLen) / (p.seg.len || 1);
    const pts = p.pts;
    const breaks = p.breaks;
    let target = local * polyLen(p);
    let acc = 0;
    for (let k = 2; k < pts.length; k += 2) {
      if (breaks && breaks.has(k / 2)) continue;   // salto cucitura: non conta
      const du = pts[k] - pts[k - 2], dv = pts[k + 1] - pts[k - 1];
      const l = Math.hypot(du, dv);
      if (acc + l >= target) {
        const t = l > 0 ? (target - acc) / l : 0;
        return [pts[k - 2] + du * t, pts[k - 1] + dv * t];
      }
      acc += l;
    }
    return [pts[pts.length - 2], pts[pts.length - 1]];
  }

  function lowerBound(arr, x) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < x) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  // bordi facce / quadranti nella vista svolta
  function drawGuides() {
    if (state.view !== 'DEV' || !state.model || !state.model.meta
        || !state.model.meta.unrollGuides) return;
    ctx.strokeStyle = '#2e4160';
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 6]);
    for (const v of state.model.meta.unrollGuides) {
      const [, sy] = toScreen(0, v);
      if (sy < -5 || sy > h + 5) continue;
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // punto 3D (mondo) alla lunghezza percorsa `len` (per il marker sull'overlay three.js)
  function position3dAt(len) {
    const i = lowerBound(state.cum, len);
    if (i >= state.proj.length) return null;
    const seg = state.proj[i].seg;
    const startLen = state.cum[i] - seg.len;
    const local = Math.max(0, len - startLen) / (seg.len || 1);
    const pts = seg.tubePts || seg.pts || [seg.from, seg.to];
    let total = 0; const dl = [];
    for (let k = 1; k < pts.length; k++) { const d = Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y, pts[k].z - pts[k - 1].z); dl.push(d); total += d; }
    let target = local * total, acc = 0;
    for (let k = 1; k < pts.length; k++) {
      const d = dl[k - 1];
      if (acc + d >= target && d > 0) { const t = (target - acc) / d, a = pts[k - 1], b = pts[k]; return [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t]; }
      acc += d;
    }
    const L = pts[pts.length - 1]; return [L.x, L.y, L.z];
  }

  // overlay 2D screen-space sopra il WebGL: FX al punto di taglio + marker posizione
  function drawThreeOverlay() {
    if (!ctxFx) return;
    ctxFx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctxFx.clearRect(0, 0, w, h);
    if (state.laserFx) {
      const s = three.worldToScreen(state.laserFx.x, state.laserFx.y, state.laserFx.z);
      if (s) drawFxAt(ctxFx, s[0], s[1], 16);
    }
    if (state.progress !== null && state.progress < state.total && !state.stock) {
      const p3 = position3dAt(state.progress);
      const s = p3 && three.worldToScreen(p3[0], p3[1], p3[2]);
      if (s) { ctxFx.fillStyle = '#ffdd00'; ctxFx.strokeStyle = '#00000088'; ctxFx.beginPath(); ctxFx.arc(s[0], s[1], 5, 0, Math.PI * 2); ctxFx.fill(); ctxFx.stroke(); }
    }
  }

  function draw() {
    // vista 3D su three.js (WebGL): render GPU on-demand, il canvas 2D resta sotto
    if (threeOn && three) { three.render(); drawThreeOverlay(); return; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (state.view === '3D') {
      draw3dScene();
      if (state.stock) drawStock();                                        // stock scavato: ha precedenza sul solido
      else if (state.solid && state.model && state.model.mesh) drawSolidMesh();
      if (state.laserFx) drawLaserFx();                                    // hot-spot/scintille al punto di taglio
    } else {
      drawGrid();
    }
    drawGuides();
    // in modo Solido con mesh, gli spigoli restano come rifinitura sottile;
    // il percorso/segmenti si disegna sempre (contorni di taglio, wireframe)
    drawModel();
  }

  // true se ha senso proporre il toggle Solido/Filo (c'è una mesh e siamo in 3D)
  function hasSolid() { return state.view === '3D' && state.model && !!state.model.mesh; }

  // ---------- hit-test ----------
  function pick(sx, sy) {
    if (!state.model) return null;
    const [mu, mv] = toWorld(sx, sy);
    const thr = 8 / state.scale;
    let best = null, bestD = thr;
    for (const p of state.proj) {
      if (!visible(p.seg)) continue;
      const pts = p.pts;
      for (let i = 2; i < pts.length; i += 2) {
        const d = distToSeg(mu, mv, pts[i - 2], pts[i - 1], pts[i], pts[i + 1]);
        if (d < bestD) { bestD = d; best = p.seg; }
      }
      if (pts.length === 2) { // segmento degenere nella proiezione (es. Z in vista XY)
        const d = Math.hypot(mu - pts[0], mv - pts[1]);
        if (d < bestD) { bestD = d; best = p.seg; }
      }
    }
    return best;
  }

  function distToSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
  }

  // ---------- interazione ----------
  // Ridisegno coalescato su requestAnimationFrame: più eventi mouse nello stesso
  // frame producono UNA sola riproiezione+draw (perf su modelli grandi durante l'orbita).
  let drawScheduled = false, reprojPending = false;
  function scheduleDraw(reproject) {
    if (reproject) reprojPending = true;
    if (drawScheduled) return;
    drawScheduled = true;
    requestAnimationFrame(() => {
      drawScheduled = false;
      if (reprojPending) { reprojPending = false; rebuildProjection(); }
      draw();
    });
  }

  let panning = false, moved = false, lastX = 0, lastY = 0, dragShift = false;

  canvas.addEventListener('mousedown', (e) => {
    panning = true; moved = false;
    dragShift = e.shiftKey;
    lastX = e.offsetX; lastY = e.offsetY;
  });
  window.addEventListener('mouseup', (e) => {
    if (!panning) return;
    panning = false;
    if (!moved) {
      const seg = pick(lastX, lastY);
      state.selected = seg;
      cb.onPick && cb.onPick(seg);
      draw();
    }
  });
  window.addEventListener('mousemove', (e) => {
    if (panning) {
      const r = canvas.getBoundingClientRect();
      const ox = e.clientX - r.left, oy = e.clientY - r.top;
      const dx = ox - lastX, dy = oy - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      if (moved) {
        if (state.view === '3D' && !dragShift) {
          // orbita: trascinamento orizzontale = azimut, verticale = elevazione.
          // la riproiezione dei percorsi è differita al frame (coalescata) → fluida
          state.yaw += dx * 0.01;
          state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch + dy * 0.01));
          lastX = ox; lastY = oy;
          scheduleDraw(true);
        } else {
          state.camU -= dx / state.scale;
          state.camV += dy / state.scale;
          lastX = ox; lastY = oy;
          scheduleDraw(false);
        }
      }
    }
  });
  canvas.addEventListener('mousemove', (e) => {
    const [mu, mv] = toWorld(e.offsetX, e.offsetY);
    if (!panning) {
      const seg = pick(e.offsetX, e.offsetY);
      if (seg !== state.hovered) {
        state.hovered = seg;
        cb.onHover && cb.onHover(seg, [mu, mv]);
        draw();
      } else {
        cb.onHover && cb.onHover(seg, [mu, mv]);
      }
    }
  });
  canvas.addEventListener('mouseleave', () => {
    state.hovered = null;
    cb.onHover && cb.onHover(null, null);
    draw();
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = Math.pow(1.0015, -e.deltaY);
    const [mu, mv] = toWorld(e.offsetX, e.offsetY);
    state.scale = Math.min(5000, Math.max(0.01, state.scale * factor));
    const [nu, nv] = toWorld(e.offsetX, e.offsetY);
    state.camU += mu - nu;
    state.camV += mv - nv;
    scheduleDraw(false);
  }, { passive: false });

  // ---------- API ----------
  const api = {
    setModel(model) {
      state.model = model;
      state.stock = null;        // nuovo modello: via lo stock scavato del precedente
      state.selected = null;
      state.hovered = null;
      state.progress = null;
      computePivot();            // centro orbita = centro del nuovo pezzo
      rebuildProjection();
      if (threeOn && three) threeSyncScene();
      this.fit();
    },
    setView(view) {
      if (!VIEWS[view]) return;
      state.view = view;
      canvas.style.cursor = view === '3D' ? 'grab' : 'crosshair';
      // tutte le viste → backend WebGL (three.js) se disponibile (DEV = svolto piatto)
      threeOn = ['3D', 'XY', 'XZ', 'YZ', 'DEV'].includes(view) && ensureThree();
      if (canvas3d) { canvas3d.style.display = threeOn ? 'block' : 'none'; canvas3d.style.cursor = view === '3D' ? 'grab' : 'move'; }
      if (canvasFx) canvasFx.style.display = threeOn ? 'block' : 'none';
      rebuildProjection();
      if (threeOn) {
        threeSyncScene();
        if (view === 'DEV') buildThreeFlat();
        three.setViewMode(view);
      }
      this.fit();
      cb.onViewChange && cb.onViewChange(view);
    },
    resetOrbit() {
      if (threeOn && three) { three.resetView(); return; }
      state.yaw = -0.8; state.pitch = 0.5; rebuildProjection(); this.fit();
    },
    isOrbit() { return state.view === '3D'; },
    getOrbit() { return { az: state.yaw * 180 / Math.PI, el: state.pitch * 180 / Math.PI }; },
    // ---- controllo camera programmatico (usato dal controllo a mani / gesti) ----
    // orbita di (dyaw,dpitch) radianti; zoom moltiplicativo; pan in pixel schermo.
    orbitBy(dyaw, dpitch) {
      if (state.view !== '3D') return;
      if (threeOn && three) { three.orbitBy(dyaw, dpitch); return; }
      state.yaw += dyaw;
      state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch + dpitch));
      scheduleDraw(true);
    },
    zoomBy(factor) {
      if (!(factor > 0)) return;
      state.scale = Math.min(5000, Math.max(0.01, state.scale * factor));
      draw();
    },
    panByScreen(dx, dy) {
      state.camU -= dx / state.scale;
      state.camV += dy / state.scale;
      draw();
    },
    fit() {
      if (w <= 0 || h <= 0) { pendingFit = true; return; }
      // three.js: inquadra via la sua camera. DEV = bbox dello svolto (u,v); altrimenti solido/stock/percorso
      if (threeOn && three) {
        let bb;
        if (state.view === 'DEV') {
          let mnu = Infinity, mnv = Infinity, mxu = -Infinity, mxv = -Infinity;
          for (const p of state.proj) for (let i = 0; i < p.pts.length; i += 2) { const u = p.pts[i], v = p.pts[i + 1]; if (u < mnu) mnu = u; if (u > mxu) mxu = u; if (v < mnv) mnv = v; if (v > mxv) mxv = v; }
          const gd = state.model && state.model.meta && state.model.meta.unrollGuides;
          if (gd) for (const v of gd) { if (v < mnv) mnv = v; if (v > mxv) mxv = v; }
          bb = mnu === Infinity ? null : { min: { x: mnu, y: mnv, z: 0 }, max: { x: mxu, y: mxv, z: 0 } };
        } else {
          bb = (state.stock && meshBBox(state.stock.positions)) || bounds3d();
        }
        if (bb && bb.min) three.fit(bb); else three.render();
        return;
      }
      let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
      const acc = (u, v) => { if (u < minU) minU = u; if (u > maxU) maxU = u; if (v < minV) minV = v; if (v > maxV) maxV = v; };
      for (const p of state.proj) {
        const pts = p.pts;
        for (let i = 0; i < pts.length; i += 2) acc(pts[i], pts[i + 1]);
      }
      // in 3D includi anche l'ingombro del SOLIDO/stock: così i modelli con sola mesh
      // (STL/STEP/IGES senza percorso) si inquadrano e tutto resta centrato sul pivot
      if (state.view === '3D') {
        const bb = (state.stock && meshBBox(state.stock.positions)) || bounds3d();
        if (bb && bb.min) {
          for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
            const [u, v] = project3d({ x, y, z }); acc(u, v);
          }
        }
      }
      if (minU === Infinity) { draw(); return; }
      const bw = Math.max(maxU - minU, 1e-6), bh = Math.max(maxV - minV, 1e-6);
      state.scale = Math.min((w * 0.86) / bw, (h * 0.86) / bh);
      state.scale = Math.min(5000, Math.max(0.01, state.scale));
      state.camU = (minU + maxU) / 2;
      state.camV = (minV + maxV) / 2;
      draw();
    },
    setShowRapids(b) { state.showRapids = b; if (threeOn && three) three.setShowRapids(b, state.model); draw(); },
    setShowPoints(b) { state.showPoints = b; if (threeOn && three) three.setDrillsVisible(b); draw(); },
    setSolid(b) { state.solid = b; if (threeOn && three) three.setWireframe(!b); draw(); },
    getSolid() { return state.solid; },
    hasMesh() { return !!(state.model && state.model.mesh); },
    setHiddenTools(set) { state.hiddenTools = set; draw(); },
    setSelected(seg) { state.selected = seg; draw(); },
    /** @param {number|null} len lunghezza percorsa in mm (null = percorso completo) */
    setProgress(len) { state.progress = len; draw(); },
    /** Segmento in esecuzione alla lunghezza percorsa `len` (per il follow del codice). */
    segAt(len) {
      const i = lowerBound(state.cum, len);
      return i < state.proj.length ? state.proj[i].seg : null;
    },
    getTotal() { return state.total; },
    /** Imposta/aggiorna la mesh dello stock scavato (simulazione asportazione). */
    setStock(mesh) { state.stock = mesh; state.stockVersion++; if (threeOn && three) three.setStock(mesh); draw(); },
    /** Rotazione tavola Q (3x3) o null: vista 4-5 assi a TAVOLA BASCULANTE (pezzo si inclina). */
    setStockRot(Q) { if (threeOn && three) three.setStockRot(Q); },
    clearStock() { if (state.stock) { state.stock = null; state.laserFx = null; if (threeOn && three) three.clearStock(); draw(); } },
    hasStock() { return !!state.stock; },
    /** Punto di lavoro per gli FX (kind: 'laser' bagliore/scintille · 'mill' trucioli); null = spento. */
    setLaserFx(pt, kind) { state.laserFx = pt; state.laserFxKind = kind || 'laser'; state.laserFxSeed = (state.laserFxSeed + 1) % 1000; if (state.view === '3D') draw(); },
    getView() { return state.view; },
    getAxisLabels() { return VIEWS[state.view].labels; },
    getZoom() { return state.scale; },
    redraw: draw,
  };
  return api;
}
