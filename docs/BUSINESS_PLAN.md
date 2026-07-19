# Piano industriale — "NC Interop & Viewer Engine"
### Da PoC interno a asset Capgemini per l'ecosistema PLM (NX · CATIA · 3DEXPERIENCE · Teamcenter)

*Bozza 2026-07-13 — riservato, per discussione interna.*

---

## 0. Executive summary

Abbiamo un PoC funzionante e insolitamente ben posizionato: un **motore web zero-dipendenze** che legge i formati officina reali (G-code multi-dialetto, i dialetti tubo italiani Adige/BLM e Cutlite, AlmaCAM/LXD, DXF, DWG, STEP/IGES con B-rep esatto via OpenCascade WASM), li visualizza (2D, 3D solido, tubo svolto, simulazione con code-follow) e fa il percorso inverso: **da STEP a programma NC** con post-processor (GRBL/LinuxCNC/dialetto tubo) in un click, nel browser.

La tesi di business NON è "vendere un altro CAM": quel mercato è presidiato dai vendor macchina (BLM ArTube, TRUMPF, Lantek). La tesi è vendere **il layer neutro di visualizzazione/verifica/interoperabilità NC dentro il PLM** — il pezzo che manca quando un cliente enterprise ha NX o 3DEXPERIENCE da una parte e trenta macchine di taglio dall'altra. Capgemini è il veicolo ideale: non vendiamo licenze a officine da 10 dipendenti (il territorio dell'amico di NCnetic), vendiamo **asset-based services** a clienti manufacturing che già paghiamo per integrare.

**Due gate non negoziabili prima di qualunque pitch:** (1) chiarire la **titolarità IP** del codice rispetto al contratto Capgemini; (2) **bonifica licenze OSS** — un componente è GPL-3 e va rimosso/sostituito prima di qualsiasi distribuzione commerciale.

---

## 1. L'asset oggi (onesto)

**Cosa c'è e funziona (validato con test automatici, 85/85):**
- Parser NC multi-dialetto robusto: ISO/RS-274, LinuxCNC (parametri `#<var>` ed espressioni), dialetti tubo **Adige/BLM** (.nc con rotazione C/P) e **Cutlite/Soitaab** (.pgm/.cn), **AlmaCAM LXD** (.cn/.ctd XML) — con routing per contenuto.
- Viste: 2D per piani, **3D solido** orbitale, **tubo svolto** (sviluppo perimetrale con cuciture corrette), simulazione con evidenziazione riga codice.
- **B-rep esatto** via opencascade.js (WASM, 66MB) — non solo mesh: facce, wire, cilindri, asole come contorni veri.
- **Generatore STEP→NC**: features dal B-rep (sezione, fori, asole), sequenza corretta (testa anteriore → feature → testa posteriore), toolpath 2D (interni-prima, nearest-neighbor, lead-in lato sfrido), post GRBL/LinuxCNC adattati dai post FreeCAD + post dialetto tubo. Validato contro coppie STEP↔NC reali di produzione.
- **Zero dipendenze di build**: gira da `node server.mjs`, tutto vendorizzato. Questo è il punto tecnico che rende credibile l'embedding ovunque (portali, MES, PLM web, Electron, plugin).

**Cosa NON c'è (gap verso i prodotti enterprise):**
- Niente simulazione cinematica macchina 4/5 assi con collisioni (il territorio di Vericut/NCnetic).
- Niente tabelle tecnologiche (materiale×spessore → potenza/feed/kerf reali) né kerf-compensation applicata (la primitiva Clipper c'è, non è esposta).
- Niente nesting produzione, gestione commessa, DNC.
- Copertura dialetti = quelli visti; un motore di dizionari/configurazione macchina è da costruire.
- UI dimostrativa, non hardened enterprise (i18n, accessibilità, telemetria, installer).

**Perché è comunque un asset**: il costo per replicare la parte parser+dialetti+RE (fatta su file di produzione veri) è alto e la conoscenza è rara; la scelta web-native/zero-dep è architetturalmente giusta per il 2026 e nessun incumbent ce l'ha.

---

## 2. Mercato

- CAM software: ~**3–3,4 Mld USD (2024)**, CAGR ~8–9% ([Verified Market Research](https://www.verifiedmarketresearch.com/product/cam-software-market/), [Research & Markets](https://www.researchandmarkets.com/report/cam-software)).
- Sottosegmento cutting CAD/CAM: ~**1,8 Mld USD (2024)**, CAGR ~8,5% ([Verified Market Reports](https://www.verifiedmarketreports.com/product/cutting-cad-or-cam-software-market-size-and-forecast/)).
- Macchine taglio tubo laser in forte crescita, APAC CAGR ~13,8% ([Data Bridge](https://www.databridgemarketresearch.com/reports/global-automatic-laser-tube-cutting-machine-market)) — ogni macchina venduta = domanda di software di programmazione/verifica/integrazione.
- Il nostro mercato **primario però non è "il mercato CAM"**: è il budget di **integrazione PLM/manufacturing** dei clienti Capgemini (Intelligent Industry). Lì non compriamo quota a competitor: aggiungiamo un accelerator dove oggi c'è sviluppo custom.

---

## 3. Concorrenza e posizionamento

**Mappa A — Editor/viewer/verifica NC (dove NON vogliamo scontrarci frontalmente):**
| Prodotto | Posizione | Note |
|---|---|---|
| NCnetic / NCneticNpp | Plugin Notepad++, sim 4/5 assi, clienti piccoli | Relazione diretta con l'autore = opzione partnership |
| CIMCO Edit | Standard de-facto editing NC officina | Desktop, per-seat |
| Vericut (CGTech) | Verifica/collisioni enterprise | Costoso, complesso — non è viewing leggero |
| NCviewer & simili | Web gratuiti | Giocattoli: niente dialetti tubo, niente B-rep |

**Mappa B — CAM tubo (dove NON entriamo come CAM):** BLM **ArTube**, TRUMPF **TruTops Tube**, **Lantek** Flex3d Tubes, **SigmaTUBE**, **Almacam Tube**. Proprietari, legati alla macchina. Il nostro RE dimostra che sappiamo *leggere e riprodurre* i loro output — è interoperabilità, non sostituzione.

**Il posizionamento nostro (spazio vuoto):**
> **"NC everywhere"** — il componente neutro, web-native ed embeddabile che porta visualizzazione, verifica leggera e generazione NC dentro gli strumenti che il cliente ha già: NX, CATIA/3DEXPERIENCE, Teamcenter, portali MES/QMS, perfino l'intranet.

Differenziatori difendibili: (1) dialetti tubo italiani + metodologia RE su coppie reali; (2) zero-dep/WASM = embed in qualunque cosa con un `<script>`; (3) STEP→NC one-click come demo "wow" per i decision maker; (4) prezzo/footprint di 1-2 ordini di grandezza sotto Vericut per il caso d'uso "capire cosa fa questo programma".

---

## 4. Offerta (modularizzazione)

**P1 — Viewer SDK (core)**
Componente JS/WASM embeddabile (`<nc-viewer>`): parser multi-dialetto, viste 2D/3D/svolto, simulazione, API eventi (riga↔segmento). Licenza per prodotto/server, white-label.
*Target: PLM web, MES, portali fornitori, documentazione interattiva.*

**P2 — Plugin nativi piattaforme**
- **Teamcenter**: dataset NC visualizzati in Active Workspace (stack web = ci nasce). Wedge naturale: Capgemini fa TC ogni giorno, e il team ha già competenza ITK/AWC.
- **NX**: pannello NXOpen (C#/WebView) — viewing + confronto programma↔modello.
- **CATIA / 3DEXPERIENCE**: widget 3DDashboard (web) prima, CAA solo se un cliente lo paga.
- Programmi partner: [Siemens technology partner](https://www.siemens.com/en-us/partners/software/join-partner-program/build/technology-partners/), [Dassault Complementary Software / CAA ISV](https://www.3ds.com/partners/programs/complementary-software), marketplace listing quando il prodotto è hardened.

**P3 — "STEP→NC Accelerator" (servizi)**
La pipeline generatore+post come acceleratore di progetti: automazione della programmazione per famiglie di pezzi ricorrenti (tubi, piastre), post-processor custom per dialetto cliente (NRE), integrazione col PLM (il pezzo parte dal modello rilasciato, non da un dxf via mail).

---

## 5. Modello di business (dentro Capgemini)

1. **Asset-based consulting** (subito): l'asset abbatte il costo/rischio dei progetti di integrazione manufacturing → si vende il progetto, l'asset fa margine. Nessun canale nuovo da costruire.
2. **Licenza SDK** (6-12 mesi): per-server/per-prodotto ai clienti dei progetti; ordine di grandezza CIMCO-like (centinaia €/seat) per i plugin, migliaia €/server per l'SDK — ben sotto la soglia di "compriamo Vericut?".
3. **NRE post-processor & dialetti** (subito): ogni macchina nuova del cliente = un dizionario/post da fare. Ricorrente di fatto.
4. **Marketplace** (12-24 mesi): listing Siemens Xcelerator / 3DEXPERIENCE — più canale di credibilità che di revenue all'inizio.

**Perché non "vendere licenze e basta"**: senza canale enterprise il destino è quello di NCnetic — ottimo prodotto, clienti piccoli. Il valore di Capgemini È il canale.

---

## 6. IP, licenze, rapporti — I DUE GATE

**Gate 1 — Titolarità IP.** Il codice è stato sviluppato in un contesto da chiarire (dipendente Capgemini, cliente LGE nel perimetro). Prima di qualunque pitch: (a) rileggere il contratto (invenzioni/opere del dipendente); (b) parlare con il proprio manager/IP office per **incardinare l'asset formalmente** (asset interno BU vs iniziativa personale — la seconda è probabilmente incompatibile col ruolo). Portarlo dentro come proposta d'asset è anche la mossa di carriera più forte.

**Gate 2 — Bonifica OSS (audit fatto, azioni chiare):**
| Componente | Licenza | Azione |
|---|---|---|
| opencascade.js / OCCT | LGPL-2.1 | OK con modulo WASM separato + notice; verificare compliance packaging |
| occt-import-js | BSD/MIT-like | OK, notice |
| clipper-lib | BSL | OK |
| Post FreeCAD (riferimento) | LGPL-2.1 | Il nostro codice è riscritto; mantenere attribution nei sorgenti |
| **libredwg** | **GPL-3** | **BLOCCANTE per distribuzione: rimuovere il supporto DWG o sostituire (ODA SDK a pagamento / conversione server-side isolata)** |
| File cliente (CAD-CAM/, COPPIE/) | proprietà cliente | Mai nel deliverable; servono dataset sintetici demo |

**Amico NCnetic.** Tre opzioni, in ordine di pulizia: (a) niente — prodotti complementari, lui officine, noi enterprise; (b) **licensing del suo kernel di simulazione 4/5 assi** dentro l'offerta enterprise (colma il nostro gap più grosso, lui accede a un canale che non avrà mai); (c) advisory. Qualunque strada: prima NDA e chiarezza con Capgemini sul conflitto d'interessi. Da non sottovalutare il valore di due prodotti che si validano a vicenda sui dialetti.

---

## 7. Roadmap prodotto

| Fase | Contenuto | Effort stimato |
|---|---|---|
| **0 — Bonifica** (4-6 sett.) | Rimozione GPL, notice LGPL, dataset demo sintetici, repo pulito, hardening minimo | 1 persona |
| **1 — SDK** (2-3 mesi) | Estrazione `<nc-viewer>` componente, API documentata, packaging npm privato, demo embedding (AWC mock, dashboard) | 1-2 persone |
| **2 — Primo plugin** (2-3 mesi, in parallelo su progetto cliente) | Teamcenter/AWC (scelta consigliata) o NX secondo il pilota | 1-2 persone |
| **3 — Piattaforme & marketplace** (6-12 mesi) | 3DDashboard widget, NXOpen panel, application partner Siemens/3DS, tabelle tecnologiche base, kerf | team piccolo dedicato |

Il kernel 5 assi NON si costruisce: si licenzia (NCnetic) o si rimanda — non è il nostro differenziatore.

---

## 8. Piano d'azione

**Primi 30 giorni**
1. Verifica contrattuale IP + conversazione col manager: incardinare come **asset proposal** della BU (Intelligent Industry / DEMS).
2. Bonifica GPL (togliere DWG) e notice file — 2 giorni di lavoro, sblocca tutto.
3. **Demo pack**: video 3' (carico STEP → ⚙→NC → simulazione con code-follow → svolto tubo) + one-pager. La demo piastra/tubo esiste già.
4. Mappare 3 clienti candidati pilota nel portafoglio (manufacturing con taglio laser/tubo — LGE è il prototipo del profilo).

**60 giorni**
5. Pitch interno BU con demo pack + questo piano; obiettivo: sponsor + budget fase 0-1.
6. NDA e conversazione esplorativa con l'autore di NCnetic (opzione kernel 5 assi).
7. PoC pilota su cliente reale (2-4 settimane, obiettivo: viewer NC dentro il loro PLM/portale).

**90 giorni**
8. Chiusura fase 1 (SDK v0.1) + risultati pilota → decisione go/no-go investimento fase 2-3.
9. Application ai partner program ([Siemens](https://www.sw.siemens.com/en-US/partners/), [3DS](https://www.3ds.com/partners/programs/complementary-software)) se go.

**12 mesi (se go)**
10. 2-3 clienti con SDK in produzione, 1 plugin piattaforma rilasciato, listing marketplace avviato, pipeline NRE post-processor attiva.

---

## 9. Numeri di massima (scenario prudente, da validare)

- **Anno 1**: 1-2 piloti pagati come progetti (50-150k€ ciascuno, margine servizi standard) + fase 0-1 finanziata dalla BU (~1,5-2 FTE). Revenue software ~0: si costruisce il canale.
- **Anno 2**: 3-5 deployment SDK (10-30k€/anno per server/prodotto) + 4-8 NRE post (10-25k€ cad.) + progetti trainati. Software ~100-250k€, servizi trainati ×3-5.
- **Anno 3**: marketplace + plugin → software 0,5-1M€ se la fase 2 conferma la trazione.
- Benchmark prezzo (ordini di grandezza, da verificare sul campo): CIMCO ~centinaia €/seat; Vericut ~decine di k€/seat; il nostro SDK si posiziona nel vuoto di mezzo.

---

## 10. Rischi principali

| Rischio | Probabilità | Mitigazione |
|---|---|---|
| IP non incardinabile (contratto) | media | Gate 1 subito, prima di ogni esposizione |
| GPL dimenticato in un deliverable | bassa (audit fatto) | Fase 0 + check licenze in CI |
| I vendor macchina chiudono i formati | media | Posizionarsi come interop (leggiamo output macchina, non rompiamo DRM); rapporto NCnetic aiuta |
| "Not invented here" dei platform vendor | media | Entrare dai clienti (pull), non dai vendor (push); i partner program dopo il pilota |
| Sponsor interno non trovato | media | Il demo pack è l'arma: 3 minuti di STEP→NC valgono più del documento |
| Concorrenza web-native emergente | media | Velocità: la finestra zero-dep/WASM è ora; i dialetti tubo sono la trincea |

---

*Fonti mercato: [Verified Market Research — CAM](https://www.verifiedmarketresearch.com/product/cam-software-market/) · [Research & Markets — CAM](https://www.researchandmarkets.com/report/cam-software) · [Verified Market Reports — Cutting CAD/CAM](https://www.verifiedmarketreports.com/product/cutting-cad-or-cam-software-market-size-and-forecast/) · [Data Bridge — Laser tube cutting machines](https://www.databridgemarketresearch.com/reports/global-automatic-laser-tube-cutting-machine-market) · [Siemens partner ecosystem](https://www.sw.siemens.com/en-US/partners/) · [3DS Complementary Software](https://www.3ds.com/partners/programs/complementary-software) · [NCnetic](https://ncnetic.com/) / [NCneticNpp GitHub](https://github.com/NCalu/NCneticNpp)*
