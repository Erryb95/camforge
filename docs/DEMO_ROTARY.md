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

## Convenzioni QtPlasmaC emesse
Verificate sul file reale `samples/cut/plasma_pipe.ngc` (post *PlasmaRotary PlasmaC.scpost*):

| Elemento | Uso |
|---|---|
| `G21` | unità mm |
| `#<tube-cut>=1` | modalità taglio tubo (QtPlasmaC gestisce THC/altezza) |
| `M190 P0` | selezione materiale (opzionale) |
| `M03 $0 S1` | torcia ON (arco/materiale corrente) |
| `G04 P<s>` | pierce delay (dwell) prima del taglio |
| `M05 $0` | torcia OFF |
| `X` / `A` | X = asse tubo (mm) · A = rotazione tubo (gradi) |

**Nota scope**: la demo usa il **rotary semplice a torcia fissa** (nessun moto Z, THC
off) — la forma più chiara e robusta per validare, e proprio ciò che oggi è scomodo da
ottenere. Il post "torcia che segue il profilo" (X/Y/Z/A del file reale) è una possibile
estensione successiva.

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
> emits **QtPlasmaC rotary G-code** (`G21`, `#<tube-cut>=1`, `M03 $0 S1` / `M05 $0`,
> pierce dwell). It then rebuilds the tube in 3D and **simulates the cut**, with the
> G-code synced to the 3D view.
>
> It's browser-based (three.js), no dependencies to run. Simple fixed-torch rotary
> (THC off) for now. Attached: a generated demo program for a Ø60×300 tube (holes + an
> axial slot + a ~180° wrapping slot).
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

## Limiti attuali / prossimi passi
- Solo tubo **tondo** (il rettangolare esiste nel motore svolto, non ancora esposto qui).
- Rotary **semplice** (torcia fissa, no Z/THC). Estensione: post "torcia che segue".
- Lead-in corto verso lo sfrido; nessuna compensazione **kerf** (roadmap).
- DXF: solo contorni **chiusi**; pannello parametri tubo (oggi Ø via prompt) da rifinire.
- Prossimo: feature da **STEP**, tubo rettangolare, kerf/lead-in configurabili.
