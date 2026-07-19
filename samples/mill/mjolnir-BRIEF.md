# 02 — Decorative Mjolnir-style hammer

> **Status: design complete + reviewed. CAM prep next.**

## Goal

A decorative hammer that's mechanically credible — looks and feels
like a real tool, but isn't intended for use. Mjolnir-inspired
polished-aluminium head, carved oak handle with twin Odin bas-reliefs
and Norse runic engravings.

## Stock

| Part | Material | Stock dimensions | Orientation |
|---|---|---|---|
| Head | 7075 aluminium | 50 × 50 × 100 mm | 100 = strike axis (X) |
| Handle | American (white) oak | 50 × 30 × 300 mm | 50 = thickness (Y, relief axis), 30 = grip width (X), 300 = length (Z) |

## Design — final

### Head (aluminium) — modelled

- **Body:** rectangular block, **100 × 50 × 50 mm**
  - X = 100 mm (strike axis)
  - Y = 50 mm (depth)
  - Z = 50 mm (eye axis, vertical when assembled), Z range 190..240
- **All 12 long edges chamfered 5 mm × 45°** (Mjolnir clean-block silhouette,
  with enough chamfer width to host engraved bands).
- **Eye:** rectangular through-hole, **25 × 22 mm**, full Z (50 mm),
  centered on origin. Matches the handle's full cross-section so the
  handle passes through at full thickness (no tenon shoulder — Norse
  / Viking-style construction, head locked by wedge expansion).
- **Decorations** (live as sketches, V-bit engraved in CAM):
  - **Long faces (×2, ±Y, 100 × 50 mm):** Yggdrasil + Celtic-knot
    medallions side by side (Yggdrasil at world X=−25, Celtic at X=+25,
    both Z=215, 25 mm dia each).
  - **Strike faces (×2, ±X, 50 × 50 mm):** Helm-of-Awe centered
    (30 mm dia).
  - **Top/bottom chamfers of long faces (×4):** Hávamál stanza 77 in
    Elder Futhark, one phrase per band:
    - +Y top: `DEYR FE` ("Cattle die")
    - +Y bottom: `DEYJA FRAENDR` ("Kinsmen die")
    - −Y top: `DEYR SIALFR` ("You yourself die")
    - −Y bottom: `ORÞSTIR LIFIR` ("Renown lives")
  - **Side chamfers of long faces (×4):** vertical inscriptions —
    `OLIVIER` on the left of each face, `HAMARR` (Old Norse for hammer)
    on the right, oriented to read upright when viewed face-on.
- All V-bit engravings designed for **black resin / blackwash** post-fill.

### Handle (white oak) — modelled

- **Total length:** **240 mm**, two-section profile:
  - **Shaft:** **28 × 33 mm** cross-section, Z=0..190 (190 mm long),
    all 4 long edges filleted **R6**. Comfortable grip, fills more
    of the 30 × 50 mm stock.
  - **Tenon:** **25 × 22 mm** cross-section, Z=190..240 (50 mm long),
    R6 long edges. Sized to pass through the head's 25 × 22 eye.
  - **Shoulder at Z=190:** sharp 90° step where the shaft meets the
    tenon. Y-step of 5.5 mm per side (33 → 22), X-step of 1.5 mm per
    side (28 → 25). The head bottom rests on this shoulder.
- **Mechanical features:**
  - **Wedge kerf:** **22 × 1.5 × 14 mm** saw slot at the top of the
    tenon (Z=226..240). Wedge driven from above splits the top 14 mm
    of the tenon, splaying it against the eye walls — locks the head
    permanently after a single tap.
  - **Strap hole:** **Ø6 mm** cross-bore at Z = 15 mm from bottom
    (through the shaft).
  - **Pommel:** **R5** rounding on the 4 bottom-perimeter edges.
- **Odin bas-reliefs (×2):** Z 130..190 mm, both ±Y faces of the shaft,
  mirrored.
  - Source: user-provided `Viking+Bust+100%+248mm` STL, converted to
    bas-relief via `convert_bust_to_relief.py` (slice + cap + scale).
  - Final relief footprint: **~23.5 × 7 × 60 mm** — flat bas-relief
    style (back of relief at shaft face Y=±16.5 mm, peak at Y=±23.5 mm).
- **Smooth grip:** Z 80..130 mm of the shaft (no engravings).
- **Runic inscription (shaft ±X faces, vertical):** `HAMMER OF
  OLIVIER` (15 runes) in Elder Futhark, centered at Z = 99 mm. Spans
  ~158 mm of the shaft.
- **Small decorative medallions (shaft ±Y faces):** Triquetra (Z=35),
  Valknut (Z=75), Celtic-knot (Z=115) — 11 mm dia each, between the
  strap hole and the bust.

### Joinery

- **Shouldered tenon + Viking wood wedge** (no glue).
- The tenon (25 × 22 mm) slides up through the head's eye from below.
  The shaft (28 × 33 mm) is too wide for the eye, so it shoulders
  against the head's bottom face at Z=190.
- Top of tenon is flush with top of head (Z=240 for both).
- Wood wedge driven into the kerf at the top splits the upper 14 mm
  of the tenon and presses it against the eye walls. The R6 fillets
  on the tenon leave 4 small corner gaps in the eye that are filled
  by this expansion — locks permanently.

## Files in `design/`

| File | What it is |
|---|---|
| `convert_bust_to_relief.py` | Slices the user's 248 mm bust into a 60 mm bas-relief panel at 7 mm depth. Manual front-axis override (face is on −Y in the source bust's native frame). |
| `mirror_relief.py` | Mirrors the relief across XZ to create the −Y handle copy. |
| `preview_meshes.py` | matplotlib renderer for visually verifying orientation. |
| `stl_to_mesh_json.py` | Decimates STLs and emits JSON payloads for `MeshBodies.addByTriangleMeshData`. Workaround for missing `createSTLImportOptions` in this Fusion API version. |
| `odin_relief_panel.stl` | Final Odin relief, +Y orientation, 7 mm depth. |
| `odin_relief_panel_mirrored.stl` | Same relief mirrored for −Y face. |
| `decoration/svg_to_dxf.py` | Norse SVGs → DXF in millimeters, normalized to a target bbox, ready for deterministic import into Fusion. |
| `decoration/rune_inscription_to_dxf.py` | Elder Futhark rune library + horizontal/vertical layout engine, renders Norse-spelled phrases as line-segment DXFs. |
| `decoration/*.svg`, `*.dxf` | Source SVGs (Yggdrasil, Vegvisir, Helm-of-Awe, etc.) + their DXF conversions in mm scale. |
| `02-decorative-hammer-mjolnir.f3d` | TODO — needs interactive Save-As in Fusion. |

## Hard constraints — verified

- Carvera Air work envelope ~360 × 240 × 140 mm — both blanks fit.
- 200 W spindle ceiling. 7075 with a 1/8" tool is the limiting
  factor — light DOC, narrow WOC, plenty of patience.
- No 4th axis — every relief and engraving is reachable from a 3-axis
  flip strategy (4 sides + 2 ends per piece).
- White oak grain (~0.5–1 mm) sets a practical lower bound on
  engraved feature size; rune cells are 5+ mm tall to stay legible.
- **Stock-Y check (handle):** shaft thickness 33 mm + relief depth
  7 mm × 2 sides = **47 mm total** out of 50 mm Y-stock available.
  Leaves 3 mm back clearance — tighter than before, but still
  workable with a side-clamp fixturing strategy.
- **Stock-X check (handle):** shaft width 28 mm out of 30 mm
  X-stock — leaves 2 mm total clearance.
- **Stock check (head):** body is exactly 50 × 50 × 100 mm, matching
  stock. Engraving depths are <1 mm so no interference with stock walls.
- **Wedge kerf vs tool:** kerf is 1.5 mm wide — narrower than the
  1/8" (3.175 mm) end mill. **Cut path:** the CNC scribes a 3.5 mm
  starter slot, then the 1.5 mm final dimension is hand-finished with
  a fine saw post-CNC. See `documentation/MILLABILITY_REVIEW.md`.

## Documentation

- [`documentation/MECHANICAL_REVIEW.md`](documentation/MECHANICAL_REVIEW.md) — fit-up, wedge mechanics, stock checks
- [`documentation/MILLABILITY_REVIEW.md`](documentation/MILLABILITY_REVIEW.md) — tooling, fixturing, problem features
- [`documentation/DESIGN_CHANGELOG.md`](documentation/DESIGN_CHANGELOG.md) — key design pivots and why

## Pending before CAM

1. **Carvera bed layout** — dowel pin positions for 4-sided + ends
   indexed fixturing on both pieces.
2. **Aluminium tooling decision** — air assist (no coolant) confirmed.
3. **Build CAM setups** — 4 sides + 2 ends per piece, 1/8" recipes
   for 7075. V-bit pencil for engravings (60° or 90°). 3D adaptive +
   ball finish for Odin bust.
4. **Validate + post G-code** for Carvera Air post processor.

## Folder layout

```
02-decorative-hammer-mjolnir/
├── BRIEF.md                this file — design final
├── design/                 conversion scripts + STLs + Fusion .f3d
│   └── decoration/         SVG/DXF library, rune inscription generator
├── cam/                    recipe snapshots, post settings (TODO)
├── nc/                     posted .cnc files (TODO)
├── documentation/          design reviews, mechanical + millability
└── photos/                 build photos, fixture photos (TODO)
```

## References

- Visual target — head + handle: [AncientSmithy Viking hammer history & craftsmanship](https://ancientsmithy.com/blogs/news/the-viking-hammer-myth-history-and-modern-craftsmanship)
- [Project 01 — Sylvan Dragoness pear relief](../01-relief-pear-150x150x45/)
  — same flow basis (3D adaptive + ball + V-bit pencil).

## Decisions taken (closed)

- **Curvature: cancelled.** "Let's not overcomplicate things — it
  will already be challenging to mill this."
- **Tenon narrowing: kept (shouldered).** First design had a 24 × 14
  tenon, then it was removed (full pass-through), then re-added
  with new dimensions: shaft 28 × 33, tenon 25 × 22, sharp 90°
  shoulder. Wider shaft uses more stock + gives a chunkier grip;
  retracted tenon keeps the head's eye unchanged.
- **Bust depth: halved.** Originally 14 mm protrusion. Now 7 mm
  protrusion (peak at Y=±23.5 from shaft face Y=±16.5).
- **Head chamfer: 3 mm → 5 mm.** Bigger faceting + more area on the
  chamfer surface to host the runic border bands.
- **Handle resize:** 25 × 22 → 28 × 33 shaft to use more of the
  30 × 50 stock and feel like a real war-hammer handle in hand.
