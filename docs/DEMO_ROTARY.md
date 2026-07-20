# DEMO Tubo/Rotary → QtPlasmaC (validazione di mercato)

Primo tassello a costo ~0 della direzione di prodotto **CAM tubo/rotary economico per
controller aperti** (LinuxCNC/GRBL/FluidNC). Obiettivo: **validare la domanda PRIMA di
costruire il prodotto completo**, mostrando sul forum LinuxCNC (thread PlasmaC 49214)
una pipeline che oggi manca "nativa" e semplice: *disegno sullo svolto del tubo →
avvolgimento su asse A → G-code QtPlasmaC → simulazione del taglio*.

## Cosa fa (in 20 secondi)
Un click su **🌀 Tubo rotary** nella toolbar:
1. genera un pattern 2D sullo **svolto** di un tubo tondo Ø60×300 mm (due file di fori +
   un'asola assiale + un'asola **circonferenziale che si avvolge di ~180°**);
2. lo **avvolge** sull'asse A: `A[°] = v / circonferenza · 360`, `X = u`;
3. emette il **G-code QtPlasmaC rotary** (X asse tubo, A rotazione, torcia fissa);
4. costruisce il **tubo solido 3D** con i tagli avvolti sopra → visibile in **Svolto** e
   **3D**, **simulabile** con ▶, e con il **G-code sincronizzato** al 3D (click su una
   riga → evidenzia il taglio sul tubo). Il file è scaricabile con **⬇ NC**.

## La pipeline (riuso ~70% del motore esistente)
```
demoPattern()        pattern 2D sullo svolto (u = asse mm, v = perimetro mm)
   │                 src/generator/tubeWrap.js  (circleUV / obroundUV)
   ▼
postRotaryPlasmaC()  wrap v→A + emissione G-code QtPlasmaC
   │                 src/generator/post/plasmac.js
   ▼                 → { text (G-code), moves[] (per il sync codice↔3D) }
buildWrappedModel()  moves → SceneModel avvolto sul tubo solido
   │                 riusa core/unroll.js (profilo) + loaders/cad/tube3d.js (mesh)
   ▼
viewer               Svolto + 3D + simulazione, seg.line → riga del G-code
```
Moduli nuovi: `src/generator/post/plasmac.js`, `src/generator/tubeWrap.js`.
Test: `tests/tube-wrap.test.mjs` (7 test: matematica wrap, round-trip, struttura
QtPlasmaC, coerenza modello e sync). Sample committato:
`samples/generated/rotary-demo-qtplasmac.ngc`.

## Convenzioni QtPlasmaC emesse — modalità NATIVA turnkey
Verificate su **fonti primarie** (manuale QtPlasmaC `linuxcnc.org/docs/html/plasma/qtplasmac.html`
+ sorgente `qtplasmac.adoc`), non su un post SheetCam. È la differenza che rende il file
"pronto a tagliare" senza editare il post:

| Elemento | Uso |
|---|---|
| `G21 G40 G49 G64 P0.1 G80 G90 G92.1 G97` | preambolo sicuro raccomandato dal manuale |
| `#<keep-z-motion>=1` | **NATIVO**: QtPlasmaC non forza il proprio Z/probe → il file pilota Z. Salta il touch-off (inaffidabile sul tubo tondo rotante) senza hack. *(Il `#<tube-cut>` dei post SheetCam è un nome che QtPlasmaC **ignora**: non salta nulla.)* |
| `M190 P<n>` + `M66 P3 L3 Q1` | selezione materiale + attesa conferma cambio (Automatic Material Handling) |
| `M03 $0 S1` / `M05 $0` | torcia ON/OFF. QtPlasmaC gestisce **arco, arc-OK e pierce delay** dalla tabella materiale ⇒ **niente `G04` a mano** (lo raddoppierebbe). *(`$3` non esiste: spindle validi solo `$0`/`$1`/`$2`.)* |
| `G93` … `G94` | feed **inverse-time**: velocità di superficie corretta su moti X/A/misti |
| `X` / `A` (/ `Z`) | X = asse tubo (mm) · A = rotazione (gradi) · Z (solo follow) = standoff |
| `M2` | fine programma |

**THC off** (enable indipendente dallo spindle) e **nessuna subroutine `o<touchoff>`** (assente
in QtPlasmaC → errore): sono proprio i due punti su cui i post SheetCam/generici inciampano.

**Nota scope**: default = **rotary tondo a torcia fissa** (nessun moto Z; il file lascia la Z
alla config macchina), la forma più robusta. Il **tubo rettangolare** usa la *torcia che segue*
(Z variabile). **Limite fisico noto** (non risolvibile in CAM): sul rotary "wrapped" il
look-ahead di LinuxCNC può cappare la velocità rotativa negli spigoli ad alte velocità.

## Come riprodurla in locale
```
node server.mjs                 # → http://localhost:8123
# click su "🌀 Tubo rotary" → Svolto / 3D / ▶ / ⬇ NC
node --test tests/tube-wrap.test.mjs
```
Generare solo il file G-code:
```
node -e "import('./src/generator/tubeWrap.js').then(m=>{const{gcode}=m.generateRotaryDemo();process.stdout.write(gcode)})" > out.ngc
```

## Matematica del wrap (tubo tondo)
```
circonferenza C = π·D            (Ø60 → C ≈ 188.50 mm)
A[gradi]        = v / C · 360    (v = ascissa perimetrale sullo svolto, mm)
X[mm]           = u             (u = ascissa assiale)
punto 3D sul tubo: φ = v/R ; { x:u, y:R·sinφ, z:R·cosφ }  (v=0 al centro faccia sup.)
```
`vToDegrees` / `degreesToV` in `post/plasmac.js` sono l'inverso l'una dell'altra (testato).

---

## Bozza post forum LinuxCNC (EN) — da rifinire prima di pubblicare

> **Subject:** Free/open web tool: draw on the tube's flat pattern → wrap to A axis →
> QtPlasmaC rotary G-code → simulate
>
> Hi all — I'm prototyping a small, zero-install web tool for **rotary/tube plasma on
> open controllers**. It takes a design on the *unrolled* tube (u = axial mm, v =
> circumferential mm), **wraps it onto the A axis** (`A = v / (π·D) · 360`, `X = u`) and
> emits **native QtPlasmaC rotary G-code**: `#<keep-z-motion>=1` (so QtPlasmaC skips its
> touch-off and lets the file own Z — no probing on a spinning tube), `M03 $0 S1` / `M05 $0`
> with the pierce delay left to QtPlasmaC's material table (no manual `G04`), material via
> `M190 P<n>` + `M66 P3 L3 Q1`, and G93 inverse-time feed for correct surface speed. It then
> rebuilds the tube in 3D and **simulates the cut**, with the G-code synced to the 3D view.
>
> It's browser-based (three.js), no dependencies to run. Fixed-torch for round tube (THC off,
> no probe) — the community-documented way — and torch-follows-Z for square tube. Attached: a
> generated demo program for a Ø60×300 tube (holes + an axial slot + a ~180° wrapping slot).
>
> **Before I build this out** I'd like a reality check from people actually cutting tube:
> 1. Does the fixed-torch `X + A` form match your machine, or do you need the
>    torch-follows-profile (X/Y/Z + A) style?
> 2. What's missing to make it useful day-to-day (lead-in/out, kerf comp, material sets,
>    hole cutting rules, tube shapes beyond round)?
> 3. Would a validated flat-pattern → rotary post save you time vs your current flow?
>
> Happy to share the generated G-code and iterate. Thanks!

**Prima di postare**: allega `samples/generated/rotary-demo-qtplasmac.ngc`, verifica il
numero/URL del thread, e rileggi le regole del forum. Non pubblicare nulla senza l'OK
dell'utente.

## Input reale: DXF svolto → tubo rotary  ✅
Oltre alla demo generata, si può **avvolgere un DXF** (il disegno sullo svolto:
fori/asole/lettere) su un tubo. Carica un `.dxf` → compare **🌀 → Tubo rotary**:
interpreta `X = asse tubo`, `Y = circonferenza`, propone un Ø che fa stare il disegno
in un giro (`Ø = altezza/π`), avvolge e genera il G-code QtPlasmaC.
- `contoursFromDxfModel()` estrae i contorni chiusi (riusa `dxfmill.closedRingsFromDxf`
  + cerchi/ellissi); `dxfDesignExtent()` suggerisce il Ø; `wrapDxfToRotary()` fa il wrap.
- Risponde al caso reale del thread (santy: *"cut letters above a tube"*).

## CAM plasma reale: kerf + lead-in/out + preset materiale  ✅
Il DXF→rotary ora è un CAM plasma vero (`src/generator/rotaryCut.js`), col **pannello
parametri tubo** (`#rotaryDlg`):
- **Kerf compensation** (Clipper `offsetClosed`): perimetro esterno `+kerf/2`, fori
  `−kerf/2` — il finito resta in quota. Fori più piccoli del kerf vengono segnalati e saltati.
- **Direzione di taglio** convenzione Hypertherm (swirl orario): esterni **orari (G02)**,
  fori **antiorari (G03)** → bordo squadrato sul pezzo, bava sullo sfrido.
- **Lead-in ad arco** tangente dal **lato sfrido** (fori dentro, perimetro fuori), con
  fallback lineare; **overcut** (overburn) solo sui fori per chiuderli puliti (default
  QtPlasmaC `#<oclength>` = 4 mm).
- **Preset materiale/spessore** con **dati reali Hypertherm Powermax SYNC** (doc 810500MU
  R4, aria): **acciaio dolce · inox 304 · alluminio** (kerf/feed/pierce/arc-volts per spessore).
- **Export material file QtPlasmaC** (`.cfg`, `src/generator/plasmacMaterial.js`): genera le
  sezioni `[MATERIAL_NUMBER_x]` (KERF_WIDTH/PIERCE_HEIGHT/PIERCE_DELAY/CUT_HEIGHT/CUT_SPEED/
  CUT_AMPS/CUT_VOLTS/…) da caricare in config e richiamare con `M190 P<n>` — colma il fatto
  che LinuxCNC **non ha un database ufficiale** di parametri (si compilano a mano dai cut chart).
- **Feed corretto sui moti rotativi**: G-code in **G93 inverse-time** (`F = 1/T`, T = lunghezza
  superficie/velocità) → la velocità di taglio rispetta le cut chart su moti assiali, di sola
  rotazione e misti (F in mm/min su un moto di sola A verrebbe letto come gradi/min).
- **Asse A shortest-path**: ogni angolo è l'equivalente più vicino al precedente → niente giri
  lunghi/riavvolgimenti attorno al tubo.
- **Topologia** (auto/tube/sheet): su tubo lo stock è la parete → i contorni top-level sono
  **fori**; `auto` sceglie "ritaglio sagoma" solo se c'è un unico perimetro che racchiude gli altri.
- **Containment robusto** (frazione di vertici interni + guard sull'area) per annidati/concentrici/
  inscritti/non-convessi; **offset che spezza** un foro in più lobi → ogni lobo è un taglio;
  **ordine inside-out** (interni prima). Pannello iterabile senza ricaricare il DXF.

Esempi DXF reali per il test in `samples/dxf/real/` (MIT, repo jscad/sample-files):
`squareandcircle.dxf` (piastra + foro, mostra il kerf), `heart.dxf`, `texts.dxf`.

## Tubo RETTANGOLARE + torcia che segue (Z)  ✅
Oltre al tondo, il wrap gestisce il **tubo rettangolare** (`src/generator/tubeGeom.js`:
perimetro `2(w+h)`, punto sezione sull'outline, distanza radiale). Poiché su un rett il
raggio varia (spigolo più lontano del centro faccia), è disponibile il **post "torcia che
segue"**: emette `Z = raggio + cut height` per mantenere lo standoff — costante sul tondo,
**variabile sul rettangolare** (necessario). Selettore forma (Tondo Ø / Rett L×H) + spunta
"torcia che segue" nel pannello.

## Materiali (5) con dati reali Hypertherm
Acciaio dolce · Acciaio dolce **FineCut** (lamiere sottili) · Inox 304 · Inox 304 **F5**
(95%N2/5%H2, spessi) · Alluminio — kerf/feed/pierce/arc-volts per spessore, ed **export
material file QtPlasmaC** per ognuno.

## Limiti attuali / prossimi passi
- Rett: A continua (non indicizzata a 90°); la torcia segue lo standoff ma non ruota per
  restare perpendicolare alle facce (limite del modello a torcia fissa+Z).
- Kerf/lead-in sul piano svolto (valido per Ø ragionevoli); niente G41/G42 (compensato dal CAM).
- DXF: solo contorni **chiusi**; testo/MTEXT e spline a scala minuscola non ancora avvolgibili.
- Prossimo: feature da **STEP**, gas/pressione nel material file, indicizzazione 90° per rett.
