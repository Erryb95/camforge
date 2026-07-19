# Campioni PIEGATURA — dati reali

Per testare la ricostruzione 3D del tubo piegato + animazione fold (`src/loaders/lra/`,
`src/sim/tubebend.js`, matematica in `src/core/bend.js`).

| File | Cosa | Formato | Fonte / licenza |
|---|---|---|---|
| `pipe_example.xyz` / `pipe_example_xyz.csv` | centerline REALE di tubo piegato a "graffa" (4 pieghe, sviluppo ~3138 mm) | XYZ (nodi centerline) | `tayfurcnr/LRA` ("Pipe LRA Studio") — ⚠️ nessuna licenza dichiarata; usato come **piccolo dato di test locale** (129 byte), non ridistribuito |
| `fan-grid-40x40.dxf` | pannello lamiera reale (per test loader DXF) | DXF | `lhondareyte/DXF-Templates` |

**Come si usa:** 📂 Apri → `pipe_example.xyz` → **3D** → **⟳ Piega** → ▶: parte dalla
**barra dritta** e si piega fino al **pezzo finito** (barra → graffa).

Il loader accetta due formati (rileva automaticamente):
- **XYZ**: una riga `x y z` per nodo della centerline (come questo file).
- **LRA/YBC**: una riga `L R A` per piega (Length avanzamento · Rotation piano · Angle piega).

## Riferimenti matematici (in `vendor/reference/bend/`)
- **FreeCAD SheetMetal** `calc-unfold.py` (LGPL) — golden per bend allowance/sviluppo lamiera
  (verificato: r1.64/T2/K0.38/90° → BA 3.77). `tests/bend.test.mjs` valida contro questi numeri.
- **Tetrees/xyz-lra-converter** `convertX2L.py` — matematica LRA↔XYZ (portata in `bend.js`).

Nota: un vero file `.lra/.ybc` standalone non è risultato disponibile pubblicamente
(sono programmi macchina-specifici); l'artefatto reale più vicino è la centerline XYZ
sopra. La **correttezza** della matematica è ancorata ai riferimenti FreeCAD/convertX2L.
