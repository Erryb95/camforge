// @ts-check
// Backend di rendering 3D su three.js (WebGL) — SOLO per la vista 3D del viewer.
// Le viste 2D (XY/XZ/YZ/Svolto) restano sul canvas 2D. Qui: solido/mesh, stock
// scavato + punta, percorsi, griglia, luci e OrbitControls (orbita attorno al
// PEZZO). Rendering ON-DEMAND (render() esplicito): niente loop rAF, così funziona
// anche a tab in background e si integra col modello di disegno del viewer 2D.
//
// Il motore di SIMULAZIONE (tri-dexel, loader) resta custom: qui three.js sostituisce
// soltanto lo strato di rendering+navigazione (GPU invece del raster canvas-2D).

import * as THREE from '../../vendor/three/three.module.js';
import { OrbitControls } from '../../vendor/three/OrbitControls.js';

// direzione camera (target→camera) e "up" per ogni vista. 2D = camere ortografiche
// bloccate lungo un asse (niente rotazione), come le viste XY/XZ/YZ del canvas 2D.
const VIEW_DIR = { '3D': [1, -1, 0.8], XY: [0, 0, 1], XZ: [0, -1, 0], YZ: [-1, 0, 0], DEV: [0, 0, 1] };
const VIEW_UP = { '3D': [0, 0, 1], XY: [0, 1, 0], XZ: [0, 0, 1], YZ: [0, 0, 1], DEV: [0, 1, 0] };

const _c = new THREE.Color();
/** [r,g,b] 0-255 (sRGB) → componenti lineari nel buffer colore. */
function rgb255(out, o, r, g, b) {
  _c.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
  out[o] = _c.r; out[o + 1] = _c.g; out[o + 2] = _c.b;
}

/** Geometria NON indicizzata con colore per-faccia (flat shading). */
function coloredGeometry(mesh, faceRGB) {
  const P = mesh.positions, I = mesh.indices, TT = mesh.triTool, F = mesh.fresh, PAL = mesh.palette;
  const nTri = I.length / 3;
  const pos = new Float32Array(nTri * 9);
  const col = new Float32Array(nTri * 9);
  const rgb = [0, 0, 0];
  for (let t = 0; t < nTri; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const o = t * 9;
    pos[o] = P[a]; pos[o + 1] = P[a + 1]; pos[o + 2] = P[a + 2];
    pos[o + 3] = P[b]; pos[o + 4] = P[b + 1]; pos[o + 5] = P[b + 2];
    pos[o + 6] = P[c]; pos[o + 7] = P[c + 1]; pos[o + 8] = P[c + 2];
    faceRGB(rgb, t, TT, F, PAL);
    for (let k = 0; k < 9; k += 3) rgb255(col, o + k, rgb[0], rgb[1], rgb[2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{toolRGB:(tool:number)=>number[], rapidRGB:number[], onChange?:Function, onPick?:Function, onHover?:Function}} opts
 */
export function createThree3D(canvas, opts) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x14171c, 1);
  const scene = new THREE.Scene();

  // camera ORTOGRAFICA (stile CAD, come la proiezione ortografica precedente), Z-up
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1e6);
  camera.up.set(0, 0, 1);
  camera.position.set(1, -1, 0.8);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;              // niente inerzia → render on-demand senza loop
  controls.rotateSpeed = 0.9;
  controls.zoomToCursor = true;
  controls.addEventListener('change', () => { renderer.render(scene, camera); opts.onChange && opts.onChange(); });

  // luci: ambiente + direzionale davanti-alto (segue la camera per illuminazione stabile)
  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  const fill = new THREE.DirectionalLight(0xffffff, 0.8);
  scene.add(key, fill);

  // assi macchina all'origine (orientamento) — dimensione impostata in fit()
  const axes = new THREE.AxesHelper(1);
  /** @type {any} */ (axes.material).depthTest = false;
  scene.add(axes);

  // gruppo PEZZO (stock scavato + tavola): in 4-5 assi a TAVOLA BASCULANTE lo ruotiamo
  // della rotazione tavola Q → il pezzo si inclina e la punta (fusa nello stock) diventa
  // verticale, come sulla macchina reale. currentQ serve a proiettare gli overlay (FX/marker).
  const stockGroup = new THREE.Group();
  stockGroup.matrixAutoUpdate = false;
  scene.add(stockGroup);
  /** @type {THREE.Mesh|null} */ let table = null;
  let currentQ = null;   // rotazione tavola corrente (3x3) o null (nessuna, verticale)

  /** @type {THREE.GridHelper|null} */ let grid = null;
  /** @type {THREE.Mesh|null} */ let solid = null;
  /** @type {THREE.Mesh|null} */ let stock = null;
  /** @type {THREE.LineSegments|null} */ let path = null;
  /** @type {THREE.LineSegments|null} */ let drills = null;   // marker cicli di foratura
  /** @type {THREE.LineSegments|null} */ let flat = null;     // vista SVOLTO (DEV): linee piatte u,v
  let pivot = new THREE.Vector3(0, 0, 0);
  let radius = 50;
  let viewMode = '3D';

  const mkMeshMat = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });

  function disposeObj(o) {
    if (!o) return;
    if (o.parent) o.parent.remove(o); else scene.remove(o);
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  }
  // Matrix4 three da una rotazione 3x3 row-major (0 traslazione)
  function mat4FromR(Q) {
    const m = new THREE.Matrix4();
    if (Q) m.set(Q[0], Q[1], Q[2], 0, Q[3], Q[4], Q[5], 0, Q[6], Q[7], Q[8], 0, 0, 0, 0, 1);
    return m;
  }

  // colore per-faccia dello STOCK: palette[triTool] (fresatura/laser) · altrimenti
  // grigio metallo / tinta calda sul taglio fresco (replica il canvas 2D)
  function stockFaceRGB(out, t, TT, F, PAL) {
    if (PAL && TT) { const c = PAL[TT[t]] || PAL[0] || [0x8c, 0x98, 0xa6]; out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; }
    else if (F && F[t]) { out[0] = 0xf0; out[1] = 0xa8; out[2] = 0x5a; }
    else { out[0] = 0x8c; out[1] = 0x98; out[2] = 0xa6; }
  }
  // colore per-faccia del SOLIDO: colore utensile del triangolo
  function solidFaceRGB(out, t, TT) {
    const c = opts.toolRGB(TT ? TT[t] : 1);
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  }

  const api = {
    /** Ridimensiona il renderer alla dimensione CSS del canvas. */
    resize(cssW, cssH, dpr) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(cssW, cssH, false);
      api._cssW = cssW; api._cssH = cssH;
      api._aspect = cssW / Math.max(1, cssH);
      api._applyFrustum();
    },
    /** Punto mondo → pixel CSS del canvas (per gli overlay 2D: FX, marker). */
    worldToScreen(x, y, z) {
      let X = x, Y = y, Z = z;
      if (currentQ) { const Q = currentQ; X = Q[0] * x + Q[1] * y + Q[2] * z; Y = Q[3] * x + Q[4] * y + Q[5] * z; Z = Q[6] * x + Q[7] * y + Q[8] * z; }   // pezzo ruotato dalla tavola
      const v = new THREE.Vector3(X, Y, Z).project(camera);
      return [(v.x * 0.5 + 0.5) * api._cssW, (-v.y * 0.5 + 0.5) * api._cssH];
    },
    _cssW: 800, _cssH: 600,
    _aspect: 1,
    _fit: 50,
    _applyFrustum() {
      const f = api._fit, a = api._aspect;
      camera.left = -f * a; camera.right = f * a; camera.top = f; camera.bottom = -f;
      camera.near = -radius * 50; camera.far = radius * 50;   // ortho: near negativo per non clippare
      camera.updateProjectionMatrix();
    },

    /** (Ri)costruisce solido + percorsi dal modello. */
    setScene(model) {
      disposeObj(solid); solid = null;
      disposeObj(path); path = null;
      disposeObj(drills); drills = null;
      if (model && model.mesh && model.mesh.positions.length) {
        solid = new THREE.Mesh(coloredGeometry(model.mesh, solidFaceRGB), mkMeshMat());
        scene.add(solid);
      }
      if (model && model.segments) api._buildPath(model);
      if (model && model.drillPoints && model.drillPoints.length) api._buildDrills(model);
    },

    // marker fori: crocino 3D (assi X/Y/Z) su ogni punto di foratura, colore utensile
    _buildDrills(model) {
      const b = model.bounds;
      const s = 0.02 * Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z, 1);
      const pos = [], rawcol = [];
      for (const d of model.drillPoints) {
        const p = d.at, rgb = opts.toolRGB(d.tool);
        const add = (ax, ay, az, bx, by, bz) => { pos.push(ax, ay, az, bx, by, bz); for (let k = 0; k < 2; k++) rawcol.push(rgb[0], rgb[1], rgb[2]); };
        add(p.x - s, p.y, p.z, p.x + s, p.y, p.z);
        add(p.x, p.y - s, p.z, p.x, p.y + s, p.z);
        add(p.x, p.y, p.z - s, p.x, p.y, p.z + s);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const cf = new Float32Array(rawcol.length);
      for (let i = 0; i < rawcol.length; i += 3) rgb255(cf, i, rawcol[i], rawcol[i + 1], rawcol[i + 2]);
      g.setAttribute('color', new THREE.BufferAttribute(cf, 3));
      drills = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));
      scene.add(drills);
    },
    setDrillsVisible(b) { if (drills) drills.visible = b; api.render(); },

    // vista SVOLTO (DEV): linee piatte (u,v,0) dal tubo svolto + guide facce.
    // lines: [{pts:Float64Array(u,v…), rgb:[r,g,b], breaks:Set|null}]
    setFlat(lines, guides, uRange) {
      disposeObj(flat); flat = null;
      const pos = [], rawcol = [];
      for (const ln of lines) {
        const p = ln.pts, rgb = ln.rgb, n = p.length / 2;
        for (let i = 1; i < n; i++) {
          if (ln.breaks && ln.breaks.has(i)) continue;
          pos.push(p[(i - 1) * 2], p[(i - 1) * 2 + 1], 0, p[i * 2], p[i * 2 + 1], 0);
          for (let k = 0; k < 2; k++) rawcol.push(rgb[0], rgb[1], rgb[2]);
        }
      }
      if (guides && uRange) for (const v of guides) { pos.push(uRange[0], v, 0, uRange[1], v, 0); for (let k = 0; k < 2; k++) rawcol.push(0x2e, 0x41, 0x60); }
      if (!pos.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const cf = new Float32Array(rawcol.length);
      for (let i = 0; i < rawcol.length; i += 3) rgb255(cf, i, rawcol[i], rawcol[i + 1], rawcol[i + 2]);
      g.setAttribute('color', new THREE.BufferAttribute(cf, 3));
      flat = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));
      flat.visible = viewMode === 'DEV';
      scene.add(flat);
    },

    _buildPath(model, showRapids = true) {
      disposeObj(path); path = null;
      const pos = [], rawcol = [];           // rawcol: [r,g,b] 0-255 per vertice
      for (const seg of model.segments) {
        const rapid = seg.type === 'rapid';
        if (rapid && !showRapids) continue;
        const src = seg.tubePts || seg.pts || [seg.from, seg.to];
        const rgb = rapid ? opts.rapidRGB : opts.toolRGB(seg.tool);
        for (let i = 1; i < src.length; i++) {
          const a = src[i - 1], b = src[i];
          pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
          rawcol.push(rgb[0], rgb[1], rgb[2], rgb[0], rgb[1], rgb[2]);
        }
      }
      if (!pos.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const cf = new Float32Array(rawcol.length);
      for (let i = 0; i < rawcol.length; i += 3) rgb255(cf, i, rawcol[i], rawcol[i + 1], rawcol[i + 2]);
      g.setAttribute('color', new THREE.BufferAttribute(cf, 3));
      path = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));
      path.visible = !stock;                 // sotto lo stock il percorso si nasconde (come nel 2D)
      scene.add(path);
    },

    setStock(mesh) {
      disposeObj(stock);
      stock = new THREE.Mesh(coloredGeometry(mesh, stockFaceRGB), mkMeshMat());
      stockGroup.add(stock);
      if (!table) api._buildTable(mesh);     // tavola sotto il pezzo (una volta per stock)
      if (solid) solid.visible = false;      // lo stock scavato ha la precedenza
      if (path) path.visible = false;
    },
    clearStock() {
      disposeObj(stock); stock = null;
      disposeObj(table); table = null;
      api.setStockRot(null);
      if (solid) solid.visible = true;
      if (path) path.visible = true;
    },
    // piano TAVOLA sotto il pezzo (ruota con lo stock in modo che il pezzo "poggi" su di essa)
    _buildTable(mesh) {
      const P = mesh.positions; let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity;
      for (let i = 0; i < P.length; i += 3) { if (P[i] < mnx) mnx = P[i]; if (P[i] > mxx) mxx = P[i]; if (P[i + 1] < mny) mny = P[i + 1]; if (P[i + 1] > mxy) mxy = P[i + 1]; if (P[i + 2] < mnz) mnz = P[i + 2]; }
      const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2, rr = 0.75 * Math.hypot(mxx - mnx, mxy - mny) || 50;
      const g = new THREE.CircleGeometry(rr, 48);
      table = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x3a4048, side: THREE.DoubleSide }));
      table.position.set(cx, cy, mnz - rr * 0.02);   // appena sotto la base dello stock
      table.visible = false;                           // mostrata solo in modalità tavola
      stockGroup.add(table);
    },
    /** Rotazione TAVOLA corrente Q (3x3) o null: ruota pezzo+tavola (vista a tavola basculante). */
    setStockRot(Q) {
      currentQ = Q || null;
      stockGroup.matrix.copy(mat4FromR(Q));
      if (table) table.visible = !!Q;
      api.render();
    },

    setPivot(p) { pivot.set(p.x, p.y, p.z); controls.target.copy(pivot); },

    /** Modalità vista: '3D' (orbita) · 'XY'/'XZ'/'YZ' (ortografica bloccata, pan+zoom). */
    setViewMode(mode) {
      viewMode = VIEW_DIR[mode] ? mode : '3D';
      const u = VIEW_UP[viewMode];
      camera.up.set(u[0], u[1], u[2]);
      const d = VIEW_DIR[viewMode];
      const dist = camera.position.distanceTo(controls.target) || radius * 4;
      camera.position.copy(controls.target).add(new THREE.Vector3(d[0], d[1], d[2]).normalize().multiplyScalar(dist));
      const twoD = viewMode !== '3D';
      controls.enableRotate = !twoD;
      controls.screenSpacePanning = true;
      controls.mouseButtons = { LEFT: twoD ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      // visibilità per modalità: in DEV mostro lo svolto piatto e nascondo il 3D
      const dev = viewMode === 'DEV';
      if (flat) flat.visible = dev;
      if (solid) solid.visible = !dev && !stock;
      if (stock) stock.visible = !dev;
      if (path) path.visible = !dev && !stock;
      if (grid) grid.visible = !dev && (viewMode === '3D' || viewMode === 'XY');
      axes.visible = viewMode === '3D';
      controls.update();
    },

    /** Inquadra il bbox {min,max} tenendo l'orientamento corrente della camera. */
    fit(bb) {
      const cx = (bb.min.x + bb.max.x) / 2, cy = (bb.min.y + bb.max.y) / 2, cz = (bb.min.z + bb.max.z) / 2;
      const sx = bb.max.x - bb.min.x, sy = bb.max.y - bb.min.y, sz = bb.max.z - bb.min.z;
      radius = 0.5 * Math.hypot(sx, sy, sz) || 50;
      pivot.set(cx, cy, cz);
      controls.target.copy(pivot);
      // mantieni la direzione di vista attuale; riposiziona la camera attorno al pivot
      const dir = camera.position.clone().sub(controls.target);
      if (dir.length() < 1e-6) dir.set(1, -1, 0.8);
      dir.normalize().multiplyScalar(radius * 4);
      camera.position.copy(pivot).add(dir);
      api._fit = radius * 1.15;
      camera.zoom = 1;
      api._applyFrustum();
      axes.scale.setScalar(radius * 0.25);
      api._makeGrid(bb);
      controls.update();
      renderer.render(scene, camera);
    },

    _makeGrid(bb) {
      if (grid) { scene.remove(grid); grid.geometry.dispose(); /** @type {any} */ (grid.material).dispose(); }
      const span = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y) || 100;
      const step = Math.pow(10, Math.floor(Math.log10(span / 8 || 10)));
      const size = Math.ceil(span / step) * step * 1.4;
      const div = Math.max(4, Math.round(size / step));
      grid = new THREE.GridHelper(size, div, 0x2a3340, 0x1b212a);
      grid.rotation.x = Math.PI / 2;         // XY (z=0) invece del piano XZ di default
      grid.position.set((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, 0);
      scene.add(grid);
    },

    resetView() {
      const d = new THREE.Vector3(1, -1, 0.8).normalize().multiplyScalar(radius * 4);
      camera.position.copy(pivot).add(d);
      controls.target.copy(pivot);
      controls.update();
      renderer.render(scene, camera);
    },
    orbitBy(dyaw, dpitch) {
      // gira attorno al target: azimut/elevazione (usato dal controllo a mani)
      const off = camera.position.clone().sub(controls.target);
      const sph = new THREE.Spherical().setFromVector3(off);
      sph.theta += dyaw; sph.phi = Math.max(0.05, Math.min(Math.PI - 0.05, sph.phi - dpitch));
      off.setFromSpherical(sph);
      camera.position.copy(controls.target).add(off);
      controls.update();
      renderer.render(scene, camera);
    },

    // luce che segue la camera (illuminazione stabile durante l'orbita)
    render() {
      const d = camera.position.clone().sub(controls.target).normalize();
      key.position.copy(d).multiplyScalar(1000).add(new THREE.Vector3(0, 0, 500));
      fill.position.copy(d).multiplyScalar(-800).add(new THREE.Vector3(0, 0, -200));
      renderer.render(scene, camera);
    },

    setShowRapids(b, model) { if (model) { api._buildPath(model, b); api.render(); } },
    setWireframe(on) { if (solid) { solid.material.wireframe = on; solid.material.needsUpdate = true; } api.render(); },

    // ---- picking (raycaster) su percorso/solido → segmento del modello ----
    pick(px, py, model) {
      if (!model) return null;
      const rc = new THREE.Raycaster();
      rc.params.Line.threshold = radius * 0.02;
      const ndc = new THREE.Vector2((px / canvas.clientWidth) * 2 - 1, -(py / canvas.clientHeight) * 2 + 1);
      rc.setFromCamera(ndc, camera);
      const target = (path && path.visible) ? path : (solid || stock);
      if (!target) return null;
      const hit = rc.intersectObject(target, false)[0];
      if (!hit) return null;
      if (target === path) {
        // ogni segmento del modello = N coppie di vertici consecutive; risalgo per indice
        let base = 0;
        for (const seg of model.segments) {
          const src = seg.tubePts || seg.pts || [seg.from, seg.to];
          const pairs = Math.max(0, src.length - 1);
          if (hit.index != null && hit.index < (base + pairs) * 2) return seg;
          base += pairs;
        }
      }
      return null;
    },

    getElement() { return canvas; },
    dispose() { renderer.dispose(); controls.dispose(); },
  };
  return api;
}
