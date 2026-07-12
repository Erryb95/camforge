# Ricerca: tool open-source riciclabili & architettura CAM laser tubo/lamiera

Sintesi della ricerca multi-agente (2026-07, 8 agenti, WebSearch + verifica). Obiettivo:
capire cosa riciclare invece di scrivere tutto a mano, e progettare il motore
**drawing → sequenza di taglio → .cn preciso per macchina**.

> ⚠️ La fase di verifica per-risorsa del workflow è stata saltata (mismatch di
> filtro), quindi **le licenze vanno riconfermate dal file LICENSE prima del
> riuso del codice**. Gli URL/licenze sotto sono da WebSearch, non da audit.

## 0. Correzione importante sul nostro `.cn`

Il `.cn` reale (`TUBE__2.cn`) si auto-dichiara `SaveApp="AlmaCAM"` **ma** usa il
container `<LXDDocument>` (`HandleSeed`, `DocHeader`, `ExtMin/ExtMax`, `Polyline3D`):
è il **formato LXD di Friendess/Bochu** (CypCut/TubePro), scritto DA AlmaCAM perché
il controllo macchina è Friendess. Conseguenza pratica: l'XML LXD ha campi
documentati (manuali su d.fscut.com) → il nostro parser `.cn` può seguire lo schema
LXD invece di indovinare. I formati binari Friendess `.zx/.zzx/.zh` NON sono documentati.

## 1. Tool riciclabili (per stack JS zero-dep + WASM vendorizzato)

| Tool | Licenza | A cosa serve | Come integrarlo |
|---|---|---|---|
| **cncjs/gcode-parser** | MIT | Tokenizer G-code (`[['G',1],['X',10.5]…]`) | Drop-in ES module; tokenizza già il dialetto Adige (KG10, X_1). Serve solo un layer semantico |
| **cncjs/gcode-interpreter** | MIT | Macchina a stati modale G0-G3 | Subclass con handler per le word + asse C tubo |
| **cncjs/gcode-toolpath** | MIT | G-code → segmenti line/arc | Il trio sostituisce il parser fatto a mano |
| **nodtem66/gcode_visualizer** | MIT | three.js; mappa asse rotativo→angolo via diametro, **wrap tubolare** | Unico OSS vicino al caso tubo: copia il transform circonferenza→gradi |
| **aligator/gcode-viewer** | MIT | three.js, linee come mesh (spessore costante) | Layer rendering se si adotta three.js |
| **noahlias/nc_view_vscode** | MIT | Viewer three.js offline self-contained | Scheletro legale (NCviewer è all-rights-reserved) |
| **Clipper2 / js-angusj-clipper / Clipper2-WASM** | BSL-1.0 / MIT | Offset poligoni + boolean | **Primitiva di kerf-compensation** (offset ±kerf/2); anche per lead-in e outer/hole |
| **Kiri:Moto (grid-apps)** | MIT | CAM browser con laser mode | Precedente architetturale: studia `src/mode/laser`, worker+driver, tabs |
| **SVGnest** | MIT | Nesting vettoriale (genetico + NFP, part-in-part) | JS puro droppabile; feed coi contorni estratti |
| **Deepnest / deepnest-next** | NOASSERTION (audit!) | Nesting true-shape + **common-line merge** | Lifta la routine common-line; addon Minkowski C non browser-ready |
| **jagua-rs + sparrow + nestasm** | MIT / MPL-2.0 | Nesting SOTA Rust→WASM; nestasm = blueprint browser | Se SVGnest è troppo lento; nestasm mostra la glue wasm-bindgen+Worker |
| **scalenc/{geo,lst,nc,tmt}-format** | BSD-3 | Parser TRUMPF (TypeScript, npm @scalenc/*) | Solo per file TRUMPF; buon modello di tokenizer a sezioni |
| **occt-import-js** (già vendorizzato) | LGPL-2.1 | STEP/IGES → mesh + JSON | Tienilo per il **rendering veloce**; NON dà edge B-rep |
| **opencascade.js** | LGPL-2.1 | Binding WASM completo OCCT (`TopExp_Explorer`, `BRepTools::OuterWire`, STEP) | **Chiave per gli edge veri**; custom build coi soli moduli TopExp/BRep/STEP/GProp/HLRBRep; link dinamico per LGPL |
| **brepjs** | Apache-2.0 (kernel LGPL) | API alto livello `edgeFinder`/`faceFinder` | Alternativa ergonomica; **verificare se importa STEP** |

**Solo riferimento algoritmico (GPL/copyleft o non-JS — non copiare il codice):**
jscut (GPL), dxf2gcode + fork **plasma-leadin** (GPL, migliore ref per la matematica lead-in),
DerpCAM (GPL, lead-in/out+tabs), FreeCAD_SheetMetal (LGPL, Python, unfold lamiera),
YouCanNotUnfold (`unfold.py`, graph traversal pulito), Analysis Situs (BSD-3, C++,
AAG + thickness faces + unfolding — la ref più completa), pythonocc-core/CADquery
(prototipazione), review ResearchGate cutting-path + MDPI Machines 14(6):631 (matematica unroll tubo).
**Evitare in prodotto chiuso:** replicad (AGPL), pynest2d (AGPL).

## 2. Estrazione percorso da solido 3D (il problema "solo faccia esterna")

- **occt-import-js NON basta**: dà mesh + `brep_faces` (range di triangoli), non curve.
- **Per gli edge veri**: `opencascade.js` (o `brepjs`) → `TopExp_Explorer` (FACE/WIRE/EDGE),
  `BRepAdaptor_Curve` (geometria esatta), `BRepTools::OuterWire(face)` (wire esterno; gli
  altri wire = fori).
- **Duplicato parete interna/esterna** (il nostro caso): metodo **Analysis Situs** —
  Attributed Adjacency Graph, escludi le "thickness faces", tieni la faccia ESTERNA.
  Regola industriale laser tubo = "normale alla superficie ESTERNA": trim della sola
  faccia esterna, scarta la copia interna. (Oggi lo facciamo con euristica PCA su mesh;
  la strada pulita è AAG sul B-rep.)
- Alternativa: silhouette via `HLRBRep_Algo` + `HLRBRep_HLRToShape` (outline 2D esatto,
  ma mescola silhouette e spigoli e non srotola).

## 3. Srotolamento (unfold / unroll)

- **TUBO = analitico e banale** (portare in JS, poche righe): cilindro sviluppabile
  (curvatura gaussiana 0) → `(R·cosθ, R·sinθ, z)` mappa a `(u,v) = (R·θ, z)`. Ogni punto
  del contorno: `(R·atan2(y,x), z_asse)`. Zero distorsione, **niente k-factor**. Cono →
  settore circolare. (È esattamente il nostro "tubo svolto", ma da fare sul B-rep esatto.)
- **LAMIERA multi-bend = algoritmo a grafo** (FreeCAD_SheetMetal / YouCanNotUnfold /
  Analysis Situs): facce=nodi, adiacenze=archi, spanning tree, comporre trasformazioni
  rigide da una faccia radice. k-factor solo per lo stretch nelle pieghe press-brake.
- **Nessun unfolder JS/WASM turnkey** né port WASM di Analysis Situs. Strada: OCCT
  primitives (opencascade.js) + reimplementare la matematica. Prototipare prima in
  pythonocc-core, poi tradurre le stesse chiamate OCCT in JS. Opzione: Analysis Situs
  server-side (BSD-3, uso commerciale ok) come preprocessing.
- **Caveat DXF unfold**: il flat pattern include le bend line come geometria separata →
  filtrarle (layer dedicato), tenere solo contorni di taglio + fori.

## 4. Motore "drawing → sequenza → .cn preciso"

Pipeline a stadi (worker + driver, stile Kiri:Moto):

```
STEP/DXF ─► [opencascade.js] facce/edge B-rep
         ─► [AAG] escludi thickness faces, tieni faccia esterna
         ─► outer wire + fori (OuterWire)
         ─► [unroll] tubo (R·θ,z) / lamiera (graph)
         ─► contorni 2D
         ─► [Clipper2] offset kerf/2 (ext +, fori −) = cut path
         ─► [motore regole] lead-in/out, pierce, micro-giunti, sequenza, tecnologia
         ─► [nesting SVGnest/Deepnest] posa + common-line
         ─► [post-processor] emit .cn (dialetto reverse-engineered)
```

### Regole di taglio da implementare (da Lantek / OSH Cut / SendCutSend)

- **Sequenza**: feature interne (fori/asole) PRIMA, perimetro esterno DOPO (il pezzo resta
  ancorato allo scheletro finché possibile). Dentro il pezzo inside→out. Nel nest: evitare
  che la testa attraversi pezzi già tagliati (ribaltamento→collisione); minimizzare rapidi.
- **Cut-order = TSP**: nearest-neighbor + 2-opt/simulated annealing sui pierce point
  (~100 righe, da implementare — nessuna lib JS off-the-shelf). *Già fatto: nearest-neighbor
  da un'estremità in `cad/sequence.js`; manca il 2-opt e l'interno-prima-dell'esterno.*
- **Termico**: non tagliare contorni adiacenti consecutivi; distribuire i pierce.
- **Lead-in/out**: pierce FUORI dal bordo finito (lato scarto per esterni, dentro il foro
  per interni). Linea o arco (arco su spessori alti). Lunghezza ~ `tool_radius + start_radius`,
  ~1.3 mm scalata con lo spessore. Ref: fork plasma-leadin di dxf2gcode.
- **Pierce**: parametri separati (power, delay/dwell, gas, pressione, focus). Delay completa
  la penetrazione prima del moto. Piastra spessa → pierce rampato.
- **Micro-giunti**: per il laser = breve GAP nel taglio (beam off → jog corto → beam on).
  Numero/larghezza per materiale/spessore/dimensione.
- **Kerf**: SEMPRE polygon offset (Clipper), MAI G41/G42. +kerf/2 esterno, −kerf/2 fori.
- **Common-line**: feature di NESTING (Deepnest), un bordo condiviso tagliato una volta.
- **Tabelle tecnologia** (materiale × spessore × gas): velocità/potenza/frequenza/focus.
  O2 per acciaio dolce, N2 per inox/alluminio. **È ciò che il post-processor/DLL consuma**,
  ma i valori numerici per Cutlite/Soitaab/Triumph/JQ NON sono pubblici → catturarli dalle macchine.

## 5. Formati & macchine (documentato vs proprietario)

- **Cutlite Penta** → Smart Manager Plus, post **Smart Iso**, stack OEM gruppo **Alma**. Formati non documentati.
- **Adige/BLM** → CAD/CAM **ArTube** → Lasertube, controllo Siemens; dialetto `.nc` (LT/DM/WW/WH, KG10, X_1). Proprietario, nessun parser open.
- **JQ / Bodor / HSG** → tipicamente controller **Friendess/Bochu (FSCUT)**: CypCut (lamiera), TubesT+TubePro (tubo).
- **Soitaab / Triumph** → info pubblica quasi nulla; probabilmente controller di terze parti (verosimilmente Friendess), non confermato.
- **Friendess LXD** (`.lxd`, e il nostro `.cn`): XML ispezionabile → parser fattibile. Binari `.zx/.zzx` non documentati.
- **TRUMPF**: unico ecosistema con parser open (scalenc, BSD-3).
- **Post-processing a DLL**: modello "DLL con profili macchina" plausibile ma non documentato → verificare sull'installazione o col fornitore.

## 6. Gap principali

1. Formati macchina proprietari senza spec né parser open (`.nc` Adige, `.cn/.ctd`, `.pgm`,
   `.zx/.zzx`): reverse engineering dai file reali. Nemmeno gli opcode documentati.
2. Meccanismo post-processor DLL non documentato (cuore proprietario).
3. Nessun unfolder JS/WASM turnkey: reimplementare.
4. occt-import-js non espone edge B-rep → migrare/affiancare opencascade.js (WASM più pesante, LGPL).
5. Licenze da chiudere: Deepnest (NOASSERTION), Analysis Situs/lst2ngc, import STEP di brepjs.
6. `.atd` = Parasolid (Siemens), non leggibile senza licenza.

## 7. Prossimi passi consigliati

1. **Apri un `.cn` e conferma `<LXDDocument>`** → scrivi il parser JS seguendo lo schema LXD.
2. Valuta il trio **cncjs** (MIT) come base parser + **nodtem66/gcode_visualizer** per il wrap tubo.
3. Vendorizza **Clipper2-WASM** → kerf-offset (primitiva fondante).
4. Affianca **opencascade.js** a occt-import-js (custom build) → outer wire faccia esterna;
   prototipa in pythonocc-core, poi traduci.
5. **Unroll tubo** esatto sul B-rep (R·θ, z); rinvia l'unfold lamiera multi-bend a fase 2.
6. **SVGnest** per nesting MVP; poi common-line di Deepnest (post audit) o jagua-rs/sparrow.
7. **Motore regole** proprio (interno→esterno, lead-in off-edge, micro-giunti=gap, TSP NN+2-opt).
8. Cattura le **tabelle tecnologia** dalle macchine; reverse-engineering del `.cn` target.
