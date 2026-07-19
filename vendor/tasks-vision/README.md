# @mediapipe/tasks-vision (vendorizzato, offline)

Riconoscimento **mani** (Hand Landmarker) per il controllo gestuale del piano 3D.
Usato **solo nell'app desktop (Electron)**, mai caricato dal sito.

- **Pacchetto**: `@mediapipe/tasks-vision@0.10.35` (Google MediaPipe) — **Apache-2.0**
- **Modello**: `hand_landmarker.task` (float16) — **Apache-2.0**
- **Fonte**: https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/ e
  https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task

Tutto in locale (nessuna richiesta di rete a runtime). Servono **tutti e 4** i file
in `wasm/` (SIMD + no-SIMD): il bundle sceglie a runtime in base al browser.

```
vision_bundle.mjs         bundle ESM (FilesetResolver, HandLandmarker, DrawingUtils)
wasm/vision_wasm_internal.{js,wasm}          runtime SIMD
wasm/vision_wasm_nosimd_internal.{js,wasm}   runtime fallback
hand_landmarker.task      modello (~7.8 MB)
```

Licenza Apache-2.0: copyright Google LLC. La notice va mantenuta in caso di redistribuzione.
