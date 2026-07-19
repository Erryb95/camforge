# Post-processor FreeCAD CAM — materiale di riferimento

Scaricati il 2026-07-12 da
`https://github.com/FreeCAD/FreeCAD/tree/main/src/Mod/CAM/Path/Post/scripts`
(licenza **LGPL-2.1-or-later**, header intatti nei file).

| File | Perché è qui |
|---|---|
| `grbl_post.py` | dialetto GRBL (il più diffuso sui laser): preamble `G17 G90`, postamble `M5/M2`, ordine parametri |
| `linuxcnc_post.py` | dialetto LinuxCNC/RS-274 canonico: preamble di sicurezza `G17 G54 G40 G49 G80 G90` |
| `generic_plasma_post.py` | semantica dei PROCESSI DI TAGLIO (plasma/laser/waterjet): M3/M5 = sorgente ON/OFF, **pierce delay** dopo M3 (~70 ms/mm di spessore, minimo 500 ms) |

**Adattamento**: la logica è stata portata in JavaScript in
`src/generator/post/gcode.js` (dialetti `grbl` e `linuxcnc`), che emette il
programma dal toolpath IR di `src/generator/toolpath.js`. Questi .py NON
vengono eseguiti: sono la fonte/oracolo della struttura del programma.

Uso della pipeline completa:

```
node tools/step2nc.mjs samples/cad/plate-demo.step out.nc --post grbl --check
node tools/step2nc.mjs COPPIE/TEST/TUBE4.step out.cn --post cutlite --check
```
