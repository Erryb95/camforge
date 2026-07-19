# Campioni TAGLIO 2D non-laser (plasma) — test reali

Programmi di taglio **plasma reali** (LinuxCNC PlasmaC/QtPlasmaC) per testare il
selettore di processo (laser / plasma / waterjet / ossitaglio). Stessa primitiva del
motore laser (`src/sim/lasercut.js` + `src/sim/processes.js`): cambia solo il **kerf**
(larghezza solco) e l'effetto visivo.

| File | Contenuto | Note |
|---|---|---|
| `plasma_wrench.ngc` | chiave inglese ritagliata da lamiera | pezzo che si stacca; buon test kerf largo |
| `plasma_circles.ngc` | cerchi | fori + pezzi |
| `plasma_material_change.ngc` | multi-materiale (M190/M66) | mostra feed/kerf da preset di processo |
| `plasma_ramp_pierce.ngc` | ramp pierce + THC | parametri di pierce plasma (M-code THC/IHS ignorati come metadati) |
| `plasma_pipe.ngc` | taglio rotary su tubo (asse A) | grande, wrap su tubo |

Kerf tipici applicati dal selettore: **laser 0.2 · waterjet 1.0 · plasma 1.5 · ossitaglio 2.0 mm**.

**Fonte:** `LinuxCNC/linuxcnc` → `nc_files/plasmac/` (**GPL-2.0**). Usati come **materiale
di test locale** (dati G-code, non codice ridistribuito), coerentemente con gli altri
campioni LinuxCNC in `samples/`. I post-processor plasma (SheetCam `.scpost`, waterjet
`.cps`) sono stati consultati solo come **specifica** dei parametri, non copiati.
