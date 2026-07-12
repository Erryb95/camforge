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

## 5. Per GENERARE il .cn (prossimo, non ancora fatto)
Serve replicare la struttura §2: per ogni contorno estratto (dallo STEP o dal disegno)
emettere il blocco setup→attacco→lead-in→contorno(con EI/EJ/EK)→lead-out→fine, con:
- mapping coordinate §3 (invertire X, mantenere Y/Z, calcolare C dalla posizione perimetrale),
- normali EI/EJ/EK dalla faccia,
- tecnologia (feed/potenza) dai parametri G510/G650 — da tabelle per materiale×spessore,
- sequenza interno→esterno + lead-in off-edge (regole in RESEARCH.md).
Le coppie forniscono i valori di riferimento esatti per validare l'output byte-per-byte.
