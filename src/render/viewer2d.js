// @ts-check
// Renderer 2D su canvas: griglia adattiva, pan/zoom, colori per utensile,
// hit-test per hover/selezione, simulazione del percorso con marker.
// Consuma SOLO lo SceneModel: non sa nulla dei formati file.

export const TOOL_COLORS = [
  '#4cc9f0', '#f8961e', '#90be6d', '#f94144',
  '#c77dff', '#ffd166', '#43aa8b', '#ff70a6',
];
const RAPID_COLOR = '#8a5560';
const DIM_ALPHA = 0.18;

// proiezioni di vista (indipendenti dal piano degli archi)
// DEV = "tubo svolto": usa seg.uv precalcolato dai loader (u assiale, v perimetro)
const VIEWS = {
  XY: { u: (p) => p.x, v: (p) => p.y, labels: ['X', 'Y'] },
  XZ: { u: (p) => p.x, v: (p) => p.z, labels: ['X', 'Z'] },
  YZ: { u: (p) => p.y, v: (p) => p.z, labels: ['Y', 'Z'] },
  DEV: { u: null, v: null, labels: ['L', 'C'] },
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
    showRapids: true,
    showPoints: true,
    hiddenTools: new Set(),
    selected: /** @type {any} */ (null),
    hovered: /** @type {any} */ (null),
    progress: /** @type {number|null} */ (null),  // lunghezza percorsa (mm), null = tutto
    // cache per vista corrente
    proj: /** @type {{seg:any, pts:Float64Array}[]} */ ([]),
    cum: /** @type {number[]} */ ([]),             // lunghezza cumulata per segmento
    total: 0,
  };

  let w = 0, h = 0, dpr = 1;
  let pendingFit = false;   // fit richiesto quando il canvas non era ancora misurato

  function resize() {
    const r = canvas.getBoundingClientRect();
    w = r.width; h = r.height;
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
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

  // ---------- cache proiezione ----------
  function rebuildProjection() {
    state.proj = [];
    state.cum = [];
    state.total = 0;
    if (!state.model) return;
    const V = VIEWS[state.view];
    for (const seg of state.model.segments) {
      let pts;
      if (state.view === 'DEV') {
        if (!seg.uv) continue;   // segmento senza sviluppo
        pts = new Float64Array(seg.uv.length * 2);
        for (let i = 0; i < seg.uv.length; i++) {
          pts[i * 2] = seg.uv[i].u;
          pts[i * 2 + 1] = seg.uv[i].v;
        }
      } else {
        pts = new Float64Array(seg.pts.length * 2);
        for (let i = 0; i < seg.pts.length; i++) {
          pts[i * 2] = V.u(seg.pts[i]);
          pts[i * 2 + 1] = V.v(seg.pts[i]);
        }
      }
      state.proj.push({ seg, pts });
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
    const { seg, pts } = p;
    const n = pts.length / 2;
    ctx.beginPath();
    let [sx, sy] = toScreen(pts[0], pts[1]);
    ctx.moveTo(sx, sy);
    if (uptoLen === undefined || uptoLen >= seg.len) {
      for (let i = 1; i < n; i++) {
        [sx, sy] = toScreen(pts[i * 2], pts[i * 2 + 1]);
        ctx.lineTo(sx, sy);
      }
    } else {
      // parziale: cammina lungo la polilinea
      const frac = Math.max(0, uptoLen) / seg.len;
      let target = frac * polyLen(pts);
      let acc = 0;
      for (let i = 1; i < n; i++) {
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
        [sx, sy] = toScreen(pts[i * 2], pts[i * 2 + 1]);
        ctx.lineTo(sx, sy);
      }
    }
    ctx.stroke();
  }

  function polyLen(pts) {
    let L = 0;
    for (let i = 2; i < pts.length; i += 2) {
      L += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    }
    return L;
  }

  function toolColor(tool) {
    if (!state.model) return TOOL_COLORS[0];
    const idx = state.model.stats.tools.indexOf(tool);
    return TOOL_COLORS[(idx < 0 ? 0 : idx) % TOOL_COLORS.length];
  }

  function drawModel() {
    if (!state.model) return;
    const animating = state.progress !== null && state.progress < state.total;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (let i = 0; i < state.proj.length; i++) {
      const p = state.proj[i];
      if (!visible(p.seg)) continue;
      const done = !animating || state.cum[i] <= state.progress;
      const startLen = state.cum[i] - p.seg.len;
      const partial = animating && !done && startLen < /** @type {number} */(state.progress);

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
    if (state.showPoints) {
      const V = VIEWS[state.view];
      for (const d of state.model.drillPoints) {
        if (state.hiddenTools.has(d.tool)) continue;
        let du, dv;
        if (state.view === 'DEV') {
          if (!d.uv) continue;
          du = d.uv.u; dv = d.uv.v;
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

    // marker posizione corrente (animazione)
    if (animating) {
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
    let target = local * polyLen(pts);
    let acc = 0;
    for (let k = 2; k < pts.length; k += 2) {
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

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawGrid();
    drawGuides();
    drawModel();
  }

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
  let panning = false, moved = false, lastX = 0, lastY = 0;

  canvas.addEventListener('mousedown', (e) => {
    panning = true; moved = false;
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
        state.camU -= dx / state.scale;
        state.camV += dy / state.scale;
        lastX = ox; lastY = oy;
        draw();
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
    draw();
  }, { passive: false });

  // ---------- API ----------
  const api = {
    setModel(model) {
      state.model = model;
      state.selected = null;
      state.hovered = null;
      state.progress = null;
      rebuildProjection();
      this.fit();
    },
    setView(view) {
      if (!VIEWS[view]) return;
      state.view = view;
      rebuildProjection();
      this.fit();
      cb.onViewChange && cb.onViewChange(view);
    },
    fit() {
      if (w <= 0 || h <= 0) { pendingFit = true; return; }
      if (!state.proj.length) { draw(); return; }
      let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
      for (const p of state.proj) {
        const pts = p.pts;
        for (let i = 0; i < pts.length; i += 2) {
          if (pts[i] < minU) minU = pts[i];
          if (pts[i] > maxU) maxU = pts[i];
          if (pts[i + 1] < minV) minV = pts[i + 1];
          if (pts[i + 1] > maxV) maxV = pts[i + 1];
        }
      }
      const bw = Math.max(maxU - minU, 1e-6), bh = Math.max(maxV - minV, 1e-6);
      state.scale = Math.min((w * 0.86) / bw, (h * 0.86) / bh);
      state.scale = Math.min(5000, Math.max(0.01, state.scale));
      state.camU = (minU + maxU) / 2;
      state.camV = (minV + maxV) / 2;
      draw();
    },
    setShowRapids(b) { state.showRapids = b; draw(); },
    setShowPoints(b) { state.showPoints = b; draw(); },
    setHiddenTools(set) { state.hiddenTools = set; draw(); },
    setSelected(seg) { state.selected = seg; draw(); },
    /** @param {number|null} len lunghezza percorsa in mm (null = percorso completo) */
    setProgress(len) { state.progress = len; draw(); },
    getTotal() { return state.total; },
    getView() { return state.view; },
    getAxisLabels() { return VIEWS[state.view].labels; },
    getZoom() { return state.scale; },
    redraw: draw,
  };
  return api;
}
