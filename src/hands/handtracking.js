// @ts-check
// Controllo del piano 3D con le MANI via webcam (MediaPipe Hand Landmarker).
// Offline: MediaPipe è vendorizzato in /vendor/tasks-vision e caricato pigramente
// solo all'attivazione. Disponibile su web (sviluppo/test) e app desktop.
//
// Toggle 1/2 mani (nell'anteprima camera). Anteprima specchiata come un selfie.
//   1 MANO:  palmo che si muove → ORBITA · PINCH pollice+indice → ZOOM
//   2 MANI:  allontana/avvicina le mani → ZOOM · muovi entrambe → ORBITA

const BUNDLE = '/vendor/tasks-vision/vision_bundle.mjs';
const WASM_DIR = '/vendor/tasks-vision/wasm';
const MODEL = '/vendor/tasks-vision/hand_landmarker.task';

// palmo stabile = media di polso + le 4 nocche (i polpastrelli ballano troppo)
const PALM = [0, 5, 9, 13, 17];
const PINCH_THRESH = 0.55;   // dist(pollice,indice)/dimensione-mano sotto cui è "pinch"
const DEADZONE = 0.004;      // ignora micro-movimenti (anti-drift)
const EMA = 0.5;             // smorzamento del delta (0..1, più alto = più reattivo)
const ORBIT_GAIN = 6.0;      // delta normalizzato → radianti orbita (1 mano)
const ZOOM_GAIN = 14;        // delta verticale → esponente zoom (1 mano)
const TWO_ORBIT_GAIN = 6.0;  // movimento comune delle due mani → orbita
const TWO_ZOOM_GAIN = 6.0;   // variazione distanza tra le mani → zoom

/** centroide del palmo (mirror escluso). @param {{x:number,y:number}[]} lm */
function palmCentroid(lm) {
  let x = 0, y = 0;
  for (const i of PALM) { x += lm[i].x; y += lm[i].y; }
  return { x: x / PALM.length, y: y / PALM.length };
}

// ---------- gesto a UNA mano ----------
export function newGestureState() { return { px: null, py: null, vdx: 0, vdy: 0, mode: '' }; }

/**
 * Mappa i landmark di UNA mano in un'azione camera. PURA e testabile senza webcam.
 * @param {{x:number,y:number}[]} lm @param {ReturnType<newGestureState>} S
 * @returns {{mode:string, orbit?:[number,number], zoom?:number}}
 */
export function stepGesture(lm, S) {
  const c = palmCentroid(lm);
  const cx = 1 - c.x, cy = c.y;   // mirror: webcam specchiata
  const d = (a, b) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y);
  const handSize = d(0, 9) || 0.15;
  const pinch = d(4, 8) / handSize;
  const mode = pinch < PINCH_THRESH ? 'zoom' : 'orbit';

  if (S.px == null || mode !== S.mode) {
    S.px = cx; S.py = cy; S.vdx = 0; S.vdy = 0; S.mode = mode;
    return { mode };
  }
  const rdx = cx - S.px, rdy = cy - S.py; S.px = cx; S.py = cy;
  S.vdx = EMA * rdx + (1 - EMA) * S.vdx;
  S.vdy = EMA * rdy + (1 - EMA) * S.vdy;

  if (mode === 'zoom') {
    if (Math.abs(S.vdy) > DEADZONE) return { mode, zoom: Math.max(0.85, Math.min(1.18, Math.exp(-S.vdy * ZOOM_GAIN))) };
    return { mode };
  }
  if (Math.abs(S.vdx) > DEADZONE || Math.abs(S.vdy) > DEADZONE) return { mode, orbit: [S.vdx * ORBIT_GAIN, S.vdy * ORBIT_GAIN] };
  return { mode };
}

// ---------- gesto a DUE mani ----------
export function newTwoHandState() { return { pmx: null, pmy: null, pd: null, vmx: 0, vmy: 0, vd: 0 }; }

/**
 * Mappa i landmark di DUE mani: distanza tra le mani → zoom, movimento comune →
 * orbita. Applica entrambi insieme. PURA e testabile.
 * @param {{x:number,y:number}[]} a @param {{x:number,y:number}[]} b @param {ReturnType<newTwoHandState>} S
 * @returns {{orbit?:[number,number], zoom?:number}}
 */
export function stepTwoHand(a, b, S) {
  const ca = palmCentroid(a), cb = palmCentroid(b);
  const mx = 1 - (ca.x + cb.x) / 2, my = (ca.y + cb.y) / 2;   // punto medio (mirror x)
  const dist = Math.hypot(ca.x - cb.x, ca.y - cb.y);          // distanza tra le mani
  if (S.pmx == null) { S.pmx = mx; S.pmy = my; S.pd = dist; S.vmx = S.vmy = S.vd = 0; return {}; }
  const rdx = mx - S.pmx, rdy = my - S.pmy, rdd = dist - S.pd;
  S.pmx = mx; S.pmy = my; S.pd = dist;
  S.vmx = EMA * rdx + (1 - EMA) * S.vmx;
  S.vmy = EMA * rdy + (1 - EMA) * S.vmy;
  S.vd = EMA * rdd + (1 - EMA) * S.vd;
  const out = {};
  if (Math.abs(S.vmx) > DEADZONE || Math.abs(S.vmy) > DEADZONE) out.orbit = [S.vmx * TWO_ORBIT_GAIN, S.vmy * TWO_ORBIT_GAIN];
  if (Math.abs(S.vd) > DEADZONE) out.zoom = Math.max(0.82, Math.min(1.2, Math.exp(S.vd * TWO_ZOOM_GAIN)));   // allarga = zoom in
  return out;
}

/**
 * @param {{orbitBy:(a:number,b:number)=>void, zoomBy:(f:number)=>void, getView:()=>string}} viewer
 * @param {{onStatus?:(msg:string)=>void, hands?:1|2}} [opts]
 */
export function createHandControl(viewer, opts = {}) {
  const onStatus = opts.onStatus || (() => {});
  let landmarker = null, HandLM = null, Draw = null;
  let video = null, ui = null, overlay = null, octx = null, badge = null, modeLabel = null;
  let stream = null, raf = 0, running = false;
  let lastVideoTime = -1;
  let hands = opts.hands === 2 ? 2 : 1;     // 1 o 2 mani
  const S = newGestureState();
  const S2 = newTwoHandState();

  async function ensureLib() {
    const mod = await import(BUNDLE);
    HandLM = mod.HandLandmarker; Draw = mod.DrawingUtils;
    const vision = await mod.FilesetResolver.forVisionTasks(WASM_DIR);
    const make = (delegate) => mod.HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO', numHands: 2,          // rileva SEMPRE fino a 2: il toggle cambia solo l'uso
    });
    try { landmarker = await make('GPU'); } catch { landmarker = await make('CPU'); }
  }

  function injectStyle() {
    if (document.getElementById('handStyle')) return;
    const s = document.createElement('style');
    s.id = 'handStyle';
    s.textContent = `
      .hand-cam{position:fixed;left:14px;bottom:14px;width:240px;z-index:60;
        border:1px solid #2b3442;border-radius:10px;overflow:hidden;
        background:#0d1013;box-shadow:0 8px 30px rgba(0,0,0,.5)}
      .hand-cam .wrap{position:relative;width:240px;height:180px;transform:scaleX(-1)}
      .hand-cam video,.hand-cam canvas{position:absolute;inset:0;width:240px;height:180px}
      .hand-cam video{object-fit:cover}
      .hand-cam .badge{position:absolute;left:0;right:0;bottom:0;
        font:600 12px Consolas,monospace;color:#cfe;background:linear-gradient(transparent,#000c);
        padding:16px 8px 6px;letter-spacing:.3px;pointer-events:none;text-align:center}
      .hand-cam .ttl{position:absolute;top:0;left:0;right:0;
        font:600 10px Consolas,monospace;color:#8aa;background:#0d1013cc;padding:3px 6px;
        display:flex;justify-content:space-between;align-items:center}
      .hand-cam .mbtn{cursor:pointer;color:#9fd8ff;border:1px solid #2b5068;border-radius:6px;
        padding:1px 7px;background:#12202b;user-select:none}
      .hand-cam .mbtn:hover{background:#1b3242;color:#dff}`;
    document.head.appendChild(s);
  }

  function buildUI() {
    injectStyle();
    ui = document.createElement('div'); ui.className = 'hand-cam';
    const wrap = document.createElement('div'); wrap.className = 'wrap';
    video = document.createElement('video');
    video.autoplay = true; video.muted = true; video.playsInline = true;
    overlay = document.createElement('canvas'); overlay.width = 240; overlay.height = 180;
    octx = overlay.getContext('2d');
    wrap.appendChild(video); wrap.appendChild(overlay);
    badge = document.createElement('div'); badge.className = 'badge'; badge.textContent = 'avvio…';
    const ttl = document.createElement('div'); ttl.className = 'ttl';
    const lbl = document.createElement('span'); lbl.textContent = '✋ CONTROLLO MANI';
    modeLabel = document.createElement('span'); modeLabel.className = 'mbtn';
    modeLabel.title = 'Alterna controllo a 1 o 2 mani';
    modeLabel.textContent = hands === 2 ? '2 mani' : '1 mano';
    modeLabel.addEventListener('click', () => setHands(hands === 1 ? 2 : 1));
    ttl.appendChild(lbl); ttl.appendChild(modeLabel);
    ui.appendChild(wrap); ui.appendChild(ttl); ui.appendChild(badge);
    document.body.appendChild(ui);
  }

  function setHands(n) {
    hands = n === 2 ? 2 : 1;
    S.px = S.py = null; S.vdx = S.vdy = 0; S.mode = '';
    S2.pmx = S2.pmy = S2.pd = null; S2.vmx = S2.vmy = S2.vd = 0;
    if (modeLabel) modeLabel.textContent = hands === 2 ? '2 mani' : '1 mano';
    setBadge(hands === 2 ? 'mostra DUE mani ✌️' : 'mostra una mano…');
    onStatus(hands === 2 ? 'Due mani: allarga=zoom · muovi entrambe=orbita' : 'Una mano: muovi=orbita · pinch=zoom');
  }

  function setBadge(t) { if (badge) badge.textContent = t; }

  function drawOverlay(res) {
    if (!octx) return;
    octx.clearRect(0, 0, overlay.width, overlay.height);
    if (!res || !res.landmarks || !res.landmarks.length) return;
    const du = new Draw(octx);
    for (const lm of res.landmarks) {
      du.drawConnectors(lm, HandLM.HAND_CONNECTIONS, { color: '#4cc9f0', lineWidth: 2 });
      du.drawLandmarks(lm, { color: '#ffdd00', lineWidth: 1, radius: 3 });
    }
  }

  function loop() {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (!video || video.readyState < 2) return;
    if (video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
    let res;
    try { res = landmarker.detectForVideo(video, performance.now()); } catch { return; }
    drawOverlay(res);
    const hs = (res && res.landmarks) || [];

    if (hands === 2) {
      if (hs.length >= 2) {
        const a = stepTwoHand(hs[0], hs[1], S2);
        if (a.orbit) viewer.orbitBy(a.orbit[0], a.orbit[1]);
        if (a.zoom) viewer.zoomBy(a.zoom);
        setBadge('✌️ due mani');
      } else { S2.pmx = S2.pmy = S2.pd = null; setBadge('mostra DUE mani ✌️'); }
    } else if (hs.length >= 1) {
      const a = stepGesture(hs[0], S);
      if (a.orbit) viewer.orbitBy(a.orbit[0], a.orbit[1]);
      else if (a.zoom) viewer.zoomBy(a.zoom);
      setBadge(a.mode === 'zoom' ? '🤏 zoom' : '🖐 orbita');
    } else { S.px = S.py = null; setBadge('mostra una mano…'); }
  }

  async function start() {
    if (running) return;
    onStatus('Avvio…');
    buildUI();
    setBadge('carico MediaPipe…');
    try { await ensureLib(); }
    catch (e) { console.error('[mani] MediaPipe non caricato:', e); setBadge('MediaPipe KO'); throw new Error('MediaPipe non caricato: ' + (e && e.message || e)); }
    setBadge('accendo la camera…');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } } });
    } catch (e) {
      const n = (e && e.name) || 'Errore';
      console.error('[mani] getUserMedia:', e);
      const hint = n === 'NotReadableError' ? 'camera occupata da un\'altra app (chiudi l\'app desktop/Teams/Zoom)'
        : n === 'NotAllowedError' ? 'permesso camera negato'
        : n === 'NotFoundError' ? 'nessuna webcam trovata'
        : n === 'OverconstrainedError' ? 'risoluzione non supportata' : n;
      setBadge('camera: ' + n);
      throw new Error('Camera: ' + hint);
    }
    video.srcObject = stream;
    try { await video.play(); } catch (e) { console.error('[mani] video.play:', e); }
    running = true;
    S.px = S.py = null; S.vdx = S.vdy = 0; S.mode = '';
    S2.pmx = S2.pmy = S2.pd = null; S2.vmx = S2.vmy = S2.vd = 0;
    lastVideoTime = -1;
    setBadge(hands === 2 ? 'mostra DUE mani ✌️' : 'mostra una mano…');
    loop();
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf), raf = 0;
    if (stream) { for (const t of stream.getTracks()) t.stop(); stream = null; }
    if (landmarker) { try { landmarker.close(); } catch { /* ignora */ } landmarker = null; }
    if (ui && ui.parentNode) ui.parentNode.removeChild(ui);
    ui = video = overlay = octx = badge = modeLabel = null;
  }

  return { start, stop, setHands, getHands: () => hands, isRunning: () => running };
}
