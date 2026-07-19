# Reverse engineering coppie STEP → NC (cartella COPPIE)

Analisi di 4 coppie reali `TUBEn.step` + `TUBEn.cn` (gitignorate). Tutte: tubo
**quadro 40×40 (spigoli raccordati), pezzo 250 mm**, da barra 6000 mm, con feature
diverse (fori Ø20/Ø6/Ø2, asole). Correlazione STEP↔NC **validata visivamente**:
il nostro pipeline ricostruisce dal `.cn` la stessa geometria dello STEP.

## 1. `.cn` è un'estensione SOVRACCARICA
- `.cn` / `.ctd` **XML `<LXDDocument>`** = formato LXD (AlmaCAM che esporta per Friendess). → parser `alma`.
- `.cn` **G-code** (`% .cn`, `G2292 …`) = **programma macchina**, dialetto Cutlite/Soitaab (stesso dei `.pgm`). → parser `nc`.
- Il loader ora sceglie dal **contenuto** (primo char `<` → LXD, altrimenti NC), non dall'estensione.

## 2. Struttura del programma macchina (.cn G-code)
```
% .cn
G2292 Y-20 V20 Z-20 W20 I3 X0 U-6000   ← header: sezione (V-Y=40, W-Z=40), U=lunghezza barra 6000
G168 … M1000 … JMPF(start_track)       ← wrapper/init + salto di flusso
N1
;W_T_Master_J2_B2                       ← etichetta operazione (Master = troncatura/profilo)
G510 A1 V-2200 W330 M2 L-0.95 P258.1    ← SETUP tecnologia (V/W/L/P = parametri; M2 qui NON è fine prog.)
G650 T3 W1                              ← utensile/tecnologia
G806 A11 T3 N1 H1 D1 E1 S(safe_dist)    ← approccio
G153 G0 Z(optimized_lift)               ← sollevamento rapido
G180 X.. Y.. Z.. B0 C0                  ← posizionamento
G1000 G0 X(kine_x) Y(kine_y) …          ← posizionamento cinematico (espressioni parametriche)
G800 D1 G10 X.. Y.. Z.. … F(feed1) …    ← inizio taglio (attacco)
G832                                    ← inizio contorno
;M821                                   ← marker LEAD-IN
G834 W4                                 ← ?
G1 X.. Y.. Z.. C.. B.. EI.. EJ.. EK..   ← moti di taglio (con NORMALE superficie EI/EJ/EK)
;M831                                   ← marker LEAD-OUT
G840                                    ← fine taglio
… M30
```
- **Ogni feature = un blocco** setup(G510/G650/G806) → posizionamento(G180/G1000) → attacco(G800/G10) → contorno(G832…G1…G840), delimitato da `;M821`(in) e `;M831`(out).
- **G≥100 = direttive macchina** (nessun moto). `M`/`T`/`F` su queste righe sono parametri della macro, non comandi. Espressioni `LETTERA(nome)` (`F(feed1)`, `X(kine_x)`, `Z(optimized_lift)`) sono parametri → rimosse dal parser, non "testo ignoto".
- **`EI/EJ/EK`** = coseni direttori della **normale alla superficie** nel punto (l'orientamento della testa laser). Su un tubo quadro sono costanti per faccia e ruotano sugli spigoli raccordati.
- **`C`** = rotazione tubo (gradi); **`B`** = inclinazione testa. Coordinate `(Y,Z)` = sezione nel sistema pezzo (come per Adige).

## 3. Mapping coordinate STEP ↔ NC (per il futuro generatore)
- **Sezione**: `Y,Z` NC = `Y,Z` STEP **1:1** (entrambi ±20 su tubo 40×40).
- **Asse**: `X_NC ≈ −X_STEP − trim` (STEP 0…250, NC −255…0). La barra è lavorata dall'estremità libera all'indietro; il ~5 mm di offset = trim frontale (primo Master).
- **Header** `G2292`: `V−Y`=larghezza, `W−Z`=altezza, `|U|`=lunghezza barra.

## 4. Stato parser (near-perfect)
- I 4 `.cn` caricano con **2 soli avvisi strutturali** (`?%…` assegnazione variabile, `JMPF` salto), zero "testo non riconosciuto", sezione/lunghezza/unroll corretti, mesh tubo generata.
- STEP e `.cn` rendono la **stessa geometria** in 3D e svolto → estrazione + srotolamento allineati al CAM reale.

## 4-bis. Struttura confermata di TUBE1.cn (3 operazioni)

- **N1 "Master_J2"** — taglio di testa ANTERIORE: X=−4.95 costante, C 0→360, i punti
  (Y,Z) tracciano il perimetro della sezione (quadro 40×40, spigoli r3).
- **N2 "Master_J3"** — il FORO Ø20: X∈[−139.95,−120.05] (centro −130), C=0 (faccia
  superiore piana), cerchio r10, normale (0,0,1).
- **N3 "Master_J"** — taglio di testa POSTERIORE: X=−255.05, C −360→0.

Mapping confermato: **X_NC = −X_STEP − trim** (front −4.95 ↔ STEP 0; foro −130 ↔
STEP 125; back −255 ↔ STEP 250). **C = atan2(normale_Y, normale_Z)°** (verificato:
punto con EJ0.63/EK0.77 → C≈39.3°). EI=0 sui tagli radiali.

## 5. Generatore STEP → NC — FATTO (validato su TUBE1 **e TUBE4**)

`src/generator/`: `features.js` (B-rep → sezione W×H, raggio spigoli, lunghezza,
tagli della superficie) + `tubeNc.js` (emette il dialetto: header G2292, tagli di
testa che tracciano `sectionPath()`, feature, con mapping X/C/normali di sopra).

**Asole/slot (fatto)**: i tagli NON vengono più ricostruiti dai cilindri, ma dai
**wire interni delle facce esterne** del B-rep (`src/loaders/step/wires.js`,
`BRepTools_WireExplorer` = edge in ordine di connessione → contorno continuo;
`BRepTools.OuterWire` = wire esterno; l'orientamento è `shape.Orientation_1()`
in questo build emscripten). `features.js` fa il fit di cerchio su ogni loop:
cerchio → foro (centro+raggio), altro → ASOLA come contorno esatto (2 archi+2
linee). Fallback storico sui cilindri se i loop mancano. Validato su TUBE4
(2 asole, di cui una a cavallo della cucitura): tests/generator.test.mjs.

**Sequenza (fatto)**: testa ANTERIORE prima → feature interne ordinate lungo la
barra → testa POSTERIORE per ULTIMA (il pezzo resta attaccato fino alla fine).
Il punto d'attacco dei contorni chiusi è ruotato verso la posizione precedente
(endpoint cutting problem) e ogni op inizia con un **G0 di approccio in rapido**:
nessun moto di taglio tra un contorno e il successivo, ogni contorno UNA passata.

**Ancora da fare**: tecnologia per materiale×spessore (G510/G650 reali) e — se
serve byte-exact — i valori C/feed del post proprietario.

## 6. Post-processor 2D (piastre) e pipeline dimostrativa

- `src/generator/toolpath.js`: IR CAM 2D — contenimento (interni PRIMA del
  perimetro), nearest-neighbor, rotazione punto di partenza, **lead-in dal lato
  sfrido** (dentro il foro / fuori dal perimetro).
- `src/generator/post/gcode.js`: post GRBL e LinuxCNC **adattati dai post
  ufficiali FreeCAD CAM** (LGPL, copie in `vendor/reference/freecad-posts/`),
  incluso il pierce delay del post plasma (~70 ms/mm, min 0.5 s).
- `tools/make-demo-plate.mjs`: genera `samples/cad/plate-demo.step`
  (120×80×4, 5 fori + 1 asola) con occt-full + STEPControl_Writer.
- `tools/step2nc.mjs`: STEP → NC end-to-end (`--post grbl|linuxcnc|cutlite`),
  auto-verifica `--check` col nostro parser. Output demo in `samples/generated/`.
- e2e in tests/post.test.mjs: 7 contorni estratti, ordine corretto, NC parsabile
  senza avvisi, ingombro = piastra.

## 7. Svolto per file CAD 3D (.stp/.step/.igs)

`src/loaders/cad/tubeDetect.js`: rileva il tubo dalla nuvola di segmenti (asse
PCA — i pezzi non sono axis-aligned — sezione tonda se raggio ~costante al 95°
percentile, altrimenti rettangolare da PCA 2D del piano trasversale; guardia
lunghezza > 2.2×sezione), poi calcola `seg.uv` con `perimeterParam`. La vista
Svolto dei renderer (ripiegatura a UNA sezione + stacco alla cucitura) vale
quindi anche per gli STEP: TUBE1.step ≈ TUBE1.cn (perimetro/guide identici,
tests/tube-detect.test.mjs). La banda della faccia è definita a meno di
rotazioni di 90° (da pura geometria non esiste un "top" canonico).

### (storico) note iniziali
Serve replicare la struttura §2: per ogni contorno estratto (dallo STEP o dal disegno)
emettere il blocco setup→attacco→lead-in→contorno(con EI/EJ/EK)→lead-out→fine, con:
- mapping coordinate §3 (invertire X, mantenere Y/Z, calcolare C dalla posizione perimetrale),
- normali EI/EJ/EK dalla faccia,
- tecnologia (feed/potenza) dai parametri G510/G650 — da tabelle per materiale×spessore,
- sequenza interno→esterno + lead-in off-edge (regole in RESEARCH.md).
Le coppie forniscono i valori di riferimento esatti per validare l'output byte-per-byte.
