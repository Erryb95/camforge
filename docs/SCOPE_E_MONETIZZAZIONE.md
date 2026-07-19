# Scope & Monetizzazione — riflessione strategica

_Aggiornato: 2026-07-14. Complementa `BUSINESS_PLAN.md`, `MARKET_RESEARCH.md`, `ONE_PAGER.md`.
Qui rispondiamo a due domande: **cosa possiamo ancora costruire** e **come lo monetizziamo**,
con dati di mercato freschi (ricerca 2026) e alla luce di ciò che l'asset fa **oggi**._

---

## 1. Dove siamo oggi (onesto)

**Cosa funziona già** (non è una promessa, è codice testato — 118 test verdi):
- **Viewer zero-dipendenze** (web + desktop): NC/G-code (+dialetti tubo Adige, .pgm Cutlite), AlmaCAM `.cn`, DXF, DWG, STEP/IGES/BREP. Vista 2D + 3D solido + **svolto tubo**.
- **Simulazione asportazione**: taglio **laser** lamiera e tubo (kerf attraverso lo spessore, pezzi che si staccano) e **fresatura** (tri-dexel 4/5 assi) con testa/utensile che segue il percorso.
- **Generatore STEP → NC** (tubo Cutlite, piastra GRBL/LinuxCNC) validato su pezzi reali.
- **App desktop** (Electron): portable + installer, **offline**, associazioni file, icona. Feature-complete.
- **Demo "wow": controllo del 3D con le mani** via webcam (1/2 mani, GPU-ready) — non monetizza, ma è un differenziatore da pitch che nessun concorrente ha.

**Cosa NON abbiamo ancora** (ed è dove stanno i soldi): nesting, preventivazione, collision detection, cinematica macchina reale, 5-assi bevel, import Parasolid/JT, cloud multi-utente, connettori MES.

> **In una frase:** abbiamo un **viewer + simulatore credibile** e un **contenitore desktop pronto alla vendita**. Ci manca lo strato che il cliente **paga davvero**: il *numero economico* (costo, tempo, materiale).

---

## 2. Il mercato in una pagina

| Prodotto | Fascia / modello | Prezzo (dove noto) | Limite sfruttabile |
|---|---|---|---|
| **Vericut** (CGTech) | Enterprise, perpetua+15%/anno | moduli 15k–36k$, suite ~78k$, seat reali **>70k$** | costosissimo, complesso, **asportazione non laser-tubo** |
| **NCSIMUL 4CAM** (Hexagon) | Enterprise, subscription/floating | quote-only, >10k€/seat/anno | prezzo opaco, no tubo, lock-in Hexagon |
| **Eureka** (Roboris, IT) | Mid-market, perpetua/floating | quote-only | miglior prezzo/prestazioni ma brand debole, macchina generica |
| **Lantek / SigmaNEST / Radan** | CAM lamiera nesting | quote-only (~5–20k/seat stimati) | **tubo è add-on secondario** sopra il core lamiera-piana |
| **BySoft** (Bystronic) / **TruTops** (Trumpf) | OEM chiuso | col parco macchine | **solo con le loro macchine** → parchi misti scoperti |
| **Fusion 360** (Autodesk) | Cloud subscription | **680–2.190€/anno** (trasparente) | CAM laser solo 2D, **NESSUN tubo**, forza cloud/account |
| **CAMotics** (GPL) / **NCnetic** | Gratuito (il "floor") | 0€ | solo 3-assi / viewer base, **nessuno fa dialetti tubo** |

**Cosa ci dicono questi dati (leve di posizionamento):**
1. **Prezzo opaco quasi ovunque** → solo Fusion e Vericut hanno cifre note. La **trasparenza** è di per sé una leva competitiva (riduce la frizione d'acquisto).
2. **I verificatori seri costano >70k$ e sono per l'asportazione**, non per il taglio laser. Spazio enorme per un tool **leggero, economico, self-service**.
3. **Il tubo è di fatto scoperto**: Fusion non lo fa, i CAM lamiera lo trattano come modulo, gli OEM lo fanno bene ma chiusi. **Nessun verificatore/viewer neutrale multimarca per tubo** — ed è esattamente la nostra specializzazione (dialetti Adige/AlmaCAM).
4. **Il concorrente diretto reale NON è Vericut** (altra fascia) ma **NCnetic/CAMotics** sul fronte viewer. Li battiamo su: **dialetti tubo + neutralità multimarca + prezzo trasparente**.

---

## 3. Il perno strategico: dal "guardare" al "quotare"

Il **viewing è commodity** (c'è gratis). Ciò che il terzista laser **paga** è il *numero economico*: quanto costa questo pezzo, quanto materiale spreco, in quanto tempo lo taglio. Qui abbiamo un vantaggio raro: **abbiamo già il motore di simulazione**, quindi possiamo dare tempi/costi *credibili* invece che stime a formula.

Il fuoco strategico è il **"triangolo del preventivo"** — tre feature che **riusano l'asset attuale** e colpiscono il dolore economico n.1 del terzista:

1. **DFM + preventivazione istantanea** — da CAD/NC a prezzo+lead-time in secondi.
2. **Nesting / ottimizzazione materiale** — il materiale è la voce di costo dominante.
3. **Stima tempi/costi ciclo** — trasforma la nostra simulazione in € affidabili.

---

## 4. Roadmap feature (valore × domanda × vicinanza all'asset)

Sforzo stimato **da me** conoscendo il codice; "riusa" = quanto sfrutta ciò che c'è già.

| Feature | Valore | Domanda | Sforzo | Riusa l'asset? |
|---|---|---|---|---|
| **① DFM + quoting istantaneo** | Alto | **Alta** | Medio | ✅ molto (feature-detect STEP, svolto, geometria) |
| **② Nesting + ottim. materiale** (lamiera + barra tubo, linea comune, sfridi) | Alto | **Alta** | Medio-alto | ✅ Clipper già vendorizzato; adattare SVGnest/Deepnest |
| **③ Stima tempi/costi ciclo** (pierce, gas, energia, manodopera) | Alto | **Alta** | Basso-medio | ✅✅ il simulatore c'è già; manca il modello di costo |
| ④ Collision/gouge + cinematica macchina reale | Alto (premium) | Media | **Alto** | parziale (serve modello macchina) |
| ⑤ 5-assi reale con smusso/bevel | Alto (premium) | Media | **Alto** | parziale (tri-dexel c'è, manca kinematics NC) |
| ⑥ Import Parasolid / JT / STEP AP242+PMI | Abilitante | Media | Medio | ⚠️ **gate licenza kernel** proprietari |
| ⑦ Viewer cloud collaborativo | Medio | Media | Medio | ✅ siamo già web; rischio commodity |
| ⑧ Digital twin + connettore MES/ERP | Ricorrente | Media | **Alto** | no (integrazioni pesanti) |
| ⑨ As-cut vs as-designed + FAI (AS9102) | Nicchia alto-margine | Media | Medio | parziale (serve metrologia esterna) |
| ⑩ Mobile/AR in officina · controllo mani | Esplorativo | Bassa | vario | demo/wow, non prioritario |

**Tre ondate:**
- **Ondata 1 — "il preventivo" (①②③):** massimo ROI, riusa il motore, apre il mercato di massa dei terzisti. *È qui che si comincia.*
- **Ondata 2 — "premium tubo" (④⑤⑥):** differenziazione tecnica verso la fascia alta (tubo 3D/bevel) e ingresso nelle supply chain OEM. Sforzo alto, competi con BLM/LVD/Lantek già maturi.
- **Ondata 3 — "piattaforma" (⑦⑧⑨):** ricavo ricorrente ma vendita enterprise lenta; da fare quando c'è base installata.

Evidenze di mercato: nesting fa risparmiare **15–30% materiale, ROI 1–3 mesi** (ogni +1% utilizzo ≈ 24k$/anno su 50k$/mese di acciaio); l'instant quoting *genera* domanda a monte; la stima cycle-time best-in-class è a **±1%**.

---

## 4-bis. Estensione multi-processo — il motore è agnostico al processo

Oltre a laser e fresatura, il nostro motore è **più generale di quanto sembri**. Sotto il cofano facciamo solo **due primitive**:

- **Togliere materiale con un utensile** (fresatura → tri-dexel) → vale per *qualsiasi* asportazione con utensile.
- **Tagliare attraverso lo spessore con un kerf** (laser → kerf-swath + separazione pezzi) → vale per *qualsiasi* taglio di profilo.

Più: parser NC multi-dialetto, loader CAD, **svolto tubo**, generatore NC, viewer 3D. **Ogni processo che ricade in una di queste due primitive è quasi gratis da aggiungere.**

| Processo | Cosa sblocca | Riusa del motore | Sforzo | Valore |
|---|---|---|---|---|
| **① Waterjet / plasma / ossitaglio** | da "laser" a **tutto il taglio 2D lamiera/tubo** | il motore kerf **è già questo** (cambiano kerf, pierce, lead-in) | **Molto basso** | **Alto** — moltiplica il TAM a costo ~zero |
| **② Piegatura** (press brake + tubo) | da "taglio" a **fabbricazione** (cut→bend→weld) | **lo svolto/flat-pattern c'è già** + sequenza + collisione | Medio | **Alto** — completa il flusso (come Trumpf/Bystronic) |
| **③ Tornitura / mill-turn** | l'altra metà dell'asportazione (ogni officina ha torni) | asportazione su stock rotante = variante tri-dexel | Medio | **Alto** — mercato enorme |
| ④ Router / incisione (legno, plastica, compositi) | nuovi settori (falegnameria, insegne, compositi) | **è fresatura**, altri materiali/feed | Basso | Medio |
| ⑤ Punzonatura / nibbling (torretta) | completa il portfolio lamiera (punch+laser) | dominio lamiera + libreria colpi | Medio | Medio |
| ⑥ Wire EDM (elettroerosione a filo) | nicchia stampi/aerospazio ad alto margine | kerf + conicità 4 assi | Medio | Medio (verticale) |
| ⑦ Additivo (stampa 3D / WAAM / DED) | narrativa "future-proof", mercato in crescita | G-code + simulazione = *aggiunta* invece di rimozione | Medio-alto | Esplorativo |
| ⑧ Celle robotizzate (taglio/saldatura/sbavatura) | multi-processo su robot | cinematica robot | Alto | Esplorativo |

**La mossa non è aggiungere *un* processo, è il riposizionamento.** Da "simulatore laser+fresa" a **piattaforma NEUTRA multi-processo di verifica + preventivazione NC**. È un *moat*:
- Un'officina reale ha **processi misti** (laser + piega + tornio + router). Gli incumbent sono **per-processo** (SigmaNEST = nesting) o **per-OEM** (BySoft = solo Bystronic): **nessuno copre "tutto ciò che l'officina ha" in modo neutrale**.
- Sinergia diretta col perno "quotare" (§3): il terzista **preventiva across-processi**; un tool che quota laser *e* piega *e* tornio in un colpo è unicamente prezioso.

**Priorità consigliata:**
1. **① Waterjet/plasma/ossitaglio** — già fatto al ~90%: si attiva cambiando parametri e **raddoppia il mercato indirizzabile**. Frutto più basso in assoluto.
2. **② Piegatura** — perché **la matematica dello svolto è già la nostra** (lo sviluppo è *letteralmente* il flat-pattern della piega): ci trasforma da "tagliamo" a "fabbrichiamo", che è la storia che conta.
3. **③ Tornitura** — completa l'asportazione e apre il mill-turn.

②③ si sommano al quoting: **cut + bend + turn in un unico preventivo**.

---

## 5. Come monetizzare — mix a fasi (non un modello unico)

| Fase | Modello | Perché ora | Note |
|---|---|---|---|
| **0–12 mesi** | **Consulenza + asset** (Capgemini) **+ Freemium web** | cash immediato + validazione sul campo; il viewer web è il lead-magnet perfetto | l'asset abbatte i costi di delivery e diventa differenziatore |
| **Prodotto** | **Per-seat desktop** (Electron) **a moduli** | l'app è **già pronta**; il mercato è educato a questo modello | base + **tubo (premium)** + lamiera + fresatura; benchmark **5–20k/seat** + manutenzione |
| **Crescita** | **Usage / per-part** (pay-per-quote) | monetizza buyer/vendite che quotano saltuariamente, non solo l'officina | si aggancia al quoting (①); tenere l'esecuzione NC **offline** |
| **Scala** | **OEM / embedded** verso costruttori macchine + vendor CAM | il **moltiplicatore più alto**: 1 deal → centinaia di seat | abilitato dall'architettura **zero-dipendenze**; rif. ModuleWorks (~90% quota, ~500k seat) |

**Traiettoria consigliata:** `consulenza+freemium → per-seat desktop → OEM per la scala`.
SaaS cloud e usage restano **layer** per il segmento preventivazione/collaborazione — **non** per il programmatore CNC in reparto (l'officina diffida del cloud e vuole offline).

**Sul canale marketplace CAD** (per la via Capgemini/integrazione NX/CATIA/3DEXPERIENCE):
- **Autodesk App Store / Onshape**: barriera bassa, self-service, listing gratuito (Autodesk oggi commissione **0%**, contrattualmente fino al 30%). Buoni per lead-gen/visibilità.
- **Siemens / Dassault / PTC**: "contract-first", termini **non pubblici**, monetizzi via licenza add-on + **OEM/embedded con royalty runtime** e **co-sell**. Qui **Capgemini è il moltiplicatore**: è già partner certificato Siemens e Dassault (2 award Dassault 2025) → porta l'asset dentro deployment enterprise in corso. L'SI non prende revenue-share sul software: monetizza i **servizi** e fa da canale.

---

## 6. I due GATE che bloccano i canali migliori (da risolvere PRIMA)

I modelli a più alto valore (**OEM/embedded**, **open-core**) richiedono **IP pulita**. Due blocchi noti:

1. **Gate IP — chi possiede il codice?** Se l'asset è stato prodotto in contesto Capgemini, l'IP potrebbe essere del datore. Va chiarito per iscritto *prima* di vendere licenze o fare OEM.
2. **Gate GPL — `libredwg`.** La dipendenza per il DWG è GPL: **contamina** un eventuale core open e il **distribuibile Electron**. Mitigazioni: (a) isolare il DWG come **componente opzionale/servizio esterno** (non linkato nel core distribuito); (b) sostituirlo (es. ODA File Converter commerciale) nella versione a pagamento; (c) rimuovere il DWG dal build OEM. **Decidere prima di scegliere open-core o OEM.**

---

## 7. Raccomandazione (opinionata)

1. **Sblocca i due gate** (IP + GPL). Senza, i canali migliori sono preclusi. È il primo passo, non un dettaglio legale da rimandare.
2. **Costruisci l'Ondata 1 (il preventivo)** sul motore attuale — è il minor sforzo per il maggior valore, e trasforma un "bel viewer" in uno strumento che fa **risparmiare soldi misurabili**.
3. **Vendi per-seat desktop** col **tubo come modulo premium** (nicchia, minor concorrenza, leva di prezzo), affiancato dal **freemium web** come funnel. Prezzo **trasparente** contro l'opacità di tutti.
4. **In parallelo prepara SDK/API** pensando all'**OEM**: è la scala di lungo periodo e l'architettura zero-dep è già il tuo vantaggio.
5. **Usa Capgemini come ponte** (cash + canale enterprise + credibilità), **non come destinazione**: il rischio è restare "body rental" senza mai trasformare l'asset in prodotto.

---

## 8. Prossimi 90 giorni (azionabile)

- [ ] **Legale:** mettere per iscritto la titolarità dell'IP (gate 1) e isolare/rimuovere `libredwg` dal distribuibile (gate 2).
- [ ] **Prodotto:** prototipo **③ stima tempi/costi ciclo** (è il più vicino: il simulatore c'è, serve il modello pierce/gas/energia/manodopera) → primo "numero economico" dimostrabile.
- [ ] **Prodotto:** MVP **① quoting** su un caso reale tubo (carica STEP → prezzo+lead-time).
- [ ] **Go-to-market:** confezionare il **freemium web** (viewer gratis, quoting/costi a pagamento) come demo pubblica + one-pager aggiornato.
- [ ] **Canale:** una conversazione interna Capgemini per inquadrare l'asset come **accelerator** su un progetto PLM reale (validazione + cash).
- [ ] **Discovery OEM:** identificare 3–5 costruttori di macchine laser tubo (Adige/BLM, ecc.) per testare l'appetito verso un motore embeddabile.

---

## 9. Rischi (avvocato del diavolo)

1. **I due gate possono uccidere i canali migliori.** OEM e open-core richiedono IP pulita: se il codice resta vincolato a Capgemini e/o la GPL contamina il distribuibile, i modelli più redditizi diventano impraticabili. **Risolvere prima, non dopo.**
2. **Il viewing è commodity.** La disponibilità-a-pagare è tutta nelle feature "pro": il free va tenuto volutamente limitato o cannibalizza il prodotto. Conversione freemium tipica **1–5%**. Se non costruiamo un vantaggio credibile sul quoting/costi, competiamo solo contro tool gratuiti (CAMotics, NCnetic).
3. **Vendite lente e concentrazione di potere.** Il per-seat ha ciclo lungo e serve rete rivenditori; l'OEM ha cicli 12–24 mesi e pochi clienti ad alto potere (rischio "ingredient brand" invisibile). La consulenza dà cash ma **non scala oltre le persone**.
4. **Il tubo è una nicchia reale ma piccola e silenziosa** (vedi `MARKET_RESEARCH.md`): ottima per un premium difendibile, non per volumi di massa. Il volume sta nella lamiera e nel quoting — il tubo è la testa di ponte, non l'intero mercato.

---

_Fonti: ricerca di mercato 2026 (prezzi Vericut/Fusion verificati; altri quote-only quindi ordini di grandezza), competitor CAM/nesting/OEM, programmi marketplace CAD (Autodesk/Onshape/Siemens/Dassault/PTC), pattern di monetizzazione B2B ingegneristico. Le percentuali di revenue-share Siemens/Dassault/PTC non sono pubbliche (da confermare sotto NDA)._
