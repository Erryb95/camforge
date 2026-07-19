# Banco di test FRESATURA — pezzi reali (da GitHub)

Programmi di fresatura **reali** con stock/materiale/utensile noti, per validare la
simulazione di asportazione tri-dexel (`src/sim/tridexel.js`). Scaricati da progetti
open-source; qui sono **materiale di test locale** (non ridistribuiti nel prodotto).

Carica un file nel viewer (📂 Apri) → 3D → **⛏ Fresatura** → ▶: parte dal **grezzo**
(blocco pieno) e vedi l'asportazione progressiva.

| File | Materiale reale | Stock (mm) | Lavorazione | Utensile | Lic. |
|---|---|---|---|---|---|
| `mjolnir_eye_rough.cnc` | **Alluminio 7075** | 100×50×50 (testa) | sgrossatura tasca "occhio" | fresa piatta | MIT |
| `mjolnir_contour.cnc` | **Rovere bianco** (oak) | 30×50×300 (manico) | contornatura profilo | piatta Ø3.175 | MIT |
| `bear.nc` | legno/plastica (rilievo) | 80×80×20 | rilievo 3D raster | **ballnose Ø3.175** | GPL‑2.0 |
| `flower_mold.nc` | stampo | 65×65×10 | cavità/mold, pareti verticali | **cilindrica Ø1** | GPL‑2.0 |
| `cds.ngc` | metallo (NIST) | 101.6×101.6×50.8 (4×4×2″) | tasca chiusa + contornatura 2.5D | — | GPL‑2.0 |
| `tball-pocket.gcode` | plastica/legno tenero | ~136×136 | svuotamento tasca 2.5D | — | MIT |

I file `*.camotics` (JSON di [CAMotics](https://camotics.org)) accanto a `bear`/`flower_mold`
definiscono **stock bounds + tabella utensili + risoluzione** originali — usati come
riferimento per il materiale di partenza. `mjolnir-BRIEF.md` documenta stock e materiali
del martello (testa alluminio 7075 + manico rovere).

## Fonti
- **Mjolnir** — `olivierpieltain/cnc-cam-recipes` (MIT). Ricette CAM reali con materiali
  espliciti (alluminio 7075, rovere); header Fusion con altezza stock e tabella utensile.
- **bear / flower_mold** — `CauldronDevelopmentLLC/CAMotics` (GPL‑2.0), esempi del
  simulatore CNC di riferimento; `.camotics` = stock+utensili+risoluzione.
- **cds** — `LinuxCNC/linuxcnc` `nc_files/cds.ngc` (GPL‑2.0), storico NIST (Tom Kramer),
  stock 4×4×2″ dichiarato nei commenti → volume di partenza noto.
- **tball** — `cncjs/cncjs` (MIT), G‑code pulito con profondità/passata nei commenti.

## Note licenze
MIT (`mjolnir_*`, `tball-*`) = pulito. GPL‑2.0 (`bear`, `flower_mold`, `cds`) = usati
solo come **input di test in locale**, coerentemente con gli altri campioni in
`samples/nc/` (LinuxCNC). Nessun file di test è incorporato o ridistribuito nel prodotto.
