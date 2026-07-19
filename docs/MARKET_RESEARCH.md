# Ricerca di mercato — esiste già? matrice CAD, esempi reali, avvocato del diavolo
*2026-07-13 · 8 filoni di ricerca (26 agenti, ~820k token), 99 finding con URL. Le fasi di verifica avversariale sono state interrotte dal limite di sessione: i claim "killer" qui sotto sono da riverificare puntualmente prima di usarli in un pitch ufficiale.*

## VERDETTO IN UNA RIGA
Il whitespace **esiste ma è più stretto** di come l'avevo dipinto: la tesi regge solo **ristretta e riposizionata**. Il "prodotto SDK" del one-pager era sovradimensionato — quello che sopravvive è un **asset-acceleratore di nicchia dentro le commesse Siemens/Dassault di Capgemini**, non un business software autonomo. Tre correzioni obbligate: (1) togliere STEP→NC e "il viewing" dal valore di testa (sono commodity); (2) puntare su **Teamcenter/Active Workspace**, non su 3DEXPERIENCE (lì DELMIA occupa già lo slot); (3) riposizionare da "layer di interop NC" a "**verifica NC leggera e pervasiva nel client web del PLM**", complementare a Vericut.

---

## 1. "Esiste già?" — la mappa onesta

**Il buco vero (confermato da più fonti):** NON esiste un viewer/backplot G-code nativo dentro Teamcenter Active Workspace; la via Siemens per vedere G-code è **NX CAM desktop**. Nessun system integrator ha un asset equivalente. → il posizionamento "verifica NC embeddata nel client web PLM" attacca un buco reale sul vendor primario target.

**Ma quattro occupanti seri stanno intorno al buco:**

1. **DELMIA su 3DEXPERIENCE ha GIÀ la review NC nativa** — ruoli *NC Shop Floor Reviewer* (replay G-code/APT read-only per l'officina) e *NC Machine Simulation Engineer* (validazione su ISO/G-code). → sul lato Dassault lo slot è del vendor: la roadmap "widget 3DX" è la **più debole**. [3ds.com/products/delmia](https://www.3ds.com/products/delmia/industrial-engineering/machining), [NSV](https://enterprise.trimech.com/nc-shop-floor-reviewer/)
2. **KISTERS 3DViewStation è GIÀ embeddato in Active Workspace** come viewer web di terze parti (CAD generico). → lo slot "layer di visualizzazione neutro in AWC" è occupato: la differenziazione **deve** stare sulla semantica NC (dialetti, verifica percorso), non sul "vedere". [kisters.de](https://viewer.kisters.de/en/news/press/press-detail/kisters-3dviewstation-integrated-with-siemens-teamcenter-engineering-and-activeworkspace.html)
3. **MachineWorks** ha un back-end cloud + client browser (API C e JS): il componente commerciale più vicino a "verifica NC nel web". Non è client-side/WASM (serve un server di simulazione) e non dichiara parsing multi-dialetto — ma un buyer confronterà il prezzo. [machineworks.com/technology](https://www.machineworks.com/technology)
4. **NCSIMUL 4CAM (Hexagon)** = il concorrente **concettuale** più vicino sull'interop: converte programmi tra macchine/controlli "in un click" senza riprogrammare né post esterni. Oggi è desktop; se Hexagon lo porta su web/PLM occupa esattamente la tesi. [ncptechnology.com/ncsimul-4cam](https://www.ncptechnology.com/ncsimul-4cam)

**Vericut (lo standard enterprise):** ha un'integrazione ufficiale con Teamcenter, ma il documento CGTech dice testualmente che *"VERICUT and the Teamcenter Interface run independently from Teamcenter and NX"* — cioè scarica dati e lancia l'app **desktop**, non è embeddato nel client web. Prezzi: ~$15k Verification, ~$25k Machine Sim, >$100k per configurazioni production-ready. → tra CIMCO (~$500-900) e Vericut (~$15k+) c'è un enorme vuoto di prezzo, e nessuno dei due è nel browser/PLM. [vericut.com](https://vericut.com/products/vericut-interfaces)

## 2. STEP→NC è commodity — NON venderlo come valore
Nel tubo il "STEP→NC in un click" è **baseline dichiarata** del settore: BLM ArTube (*"create your part with just one click"* + batch Automator senza GUI), TRUMPF Programming Tube (programmazione automatica al caricamento), Almacam Tube (STEP→NC per ~26 marche macchina), Lantek Flex3d, SigmaTUBE (dentro SOLIDWORKS). Il feature-based machining ha **18 anni** (Mastercam FBM, 2008). Lo standard STEP-NC ISO 14649/AP238 è **morto commercialmente** (ultima milestone 2017, nessun controller nativo) — il che però conferma che un layer neutro NC standardizzato non esiste. → STEP→NC resta una **demo "wow"**, non un moat.

## 3. Matrice CAD/PLM — dove si può integrare (e con che ROI)
Quasi tutte le piattaforme hanno una via per contenuto web; l'unico store con revenue-share **pubblico** è Autodesk. Dassault e Siemens sono partnership-gated → coerente col modello **asset-based Capgemini**, non app-store.

| Piattaforma | Estensione | Web embed? | Canale/Store | Esempio reale terzo | ROI tesi |
|---|---|---|---|---|---|
| **Teamcenter / Active Workspace** | framework View/ViewModel JSON+JS | **sì**, componente/pannello | no store pubblico → progetto/partner | **KISTERS 3DViewStation** (già in AWC) | **ALTO** (buco NC confermato) |
| Siemens **NX** | NXOpen | webview possibile | Xcelerator Marketplace (700+ partner, no rev-share pubblico) | CAM Assist (CloudNC) plug-in NX | medio |
| Siemens **Solid Edge** | partner program proprio | — | catalogo partner | — | basso |
| **3DEXPERIENCE** | widget HTML5/UWA nel 3DDashboard, host esterno | **sì** (jQuery/RequireJS) | Software Partner Program, no store rev-share pubblico | esempi widget ufficiali Dassault (GitHub) | **basso** (DELMIA occupa NC review) |
| **CATIA V5** | CAA (C++, 22.000 API, RADE) | no web moderno | partnership-gated, training a pagamento | — | **peggiore** (raggiungere V5 via PLM) |
| **SOLIDWORKS** | Solution Partner Program (3 livelli) | add-in (license key dal 2021, fee $100) | catalogo Partner Products, no rev-share | **EDGECAM** pubblicato come partner product | medio |
| **PTC Creo** | WEB.Link (JS gratis, usa il browser integrato Creo) | **sì**, nativo | PTC Partner Network (via SI), no store pubblico | Fishbowl Solutions (SI Windchill/Creo) | medio |
| PTC **Windchill** | Java/JSP + workflow | — | via system integrator | — | medio (gestisce NC come contenuto, no viewer) |
| **Onshape** | integrated cloud app (tab iframe, REST) | **sì**, nativo cloud | App Store (billing gestito, rev-share non pubblico) | **Kiri:Moto** (CAM browser embeddato!) | dimostra il pattern |
| **Autodesk Fusion / APS** | add-in Python/C++ + APS Viewer web | **sì** (ma APS Viewer NON legge G-code) | App Store (**0% commissione oggi**, riserva fino 30%) | migliaia di app | canale a costo zero per testare |
| Rhino / Grasshopper | RhinoCommon .NET, C++ | — | food4Rhino (gratis) | CAD Exchanger Import plug-in | basso (pubblico AEC/design) |
| BricsCAD | BRX (ricompila app AutoCAD) | — | Application Store (gratis) | app Mechanical terze | basso |
| FreeCAD | Addon Manager (GitHub) | — | nessun commerciale | — | solo vetrina OSS |
| Hexagon EDGECAM/DESIGNER, ZW3D | **nessun SDK/partner pubblico trovato** | — | solo accordo diretto | — | non raggiungibile via canale |

## 4. La nicchia tubo è reale ma piccola e silenziosa
- Installato: BLM dichiara **>3.000 sistemi Lasertube** nel mondo (cifra 2017, ancora citata nel 2025); nessun numero pubblico per TRUMPF/Bystronic/Mazak tube. **TAM = poche migliaia di siti**.
- Il software OEM è bundlato con la macchina e include già simulazione → il cliente **raramente compra un viewer terzo**.
- **Nessuna lamentela pubblica** su ArTube/interop trovata su Practical Machinist/CNCzone/Reddit → niente pain-pull: vendita **top-down** obbligata.
- **Nessun broker di conversione NC-to-NC tubo** esiste → il valore "interop a livello NC" non ha un mercato di riferimento osservabile.
- Lo scambio dati col cliente avviene via **STEP/X_T/IGES/IFC** (livello CAD/PLM), NON via file NC → questo **indebolisce** l'angolo "interop NC" e **rafforza** l'angolo "PLM/CAD".
- Il volume in crescita è cinese su **Bochu/Friendess FSCUT TubePro** — un dialetto che il parser **non copre ancora**.

## 5. Competizione tra system integrator
- **Nessun SI** ha un asset di viewing/verifica NC embeddato in Teamcenter/AWC → whitespace confermato tra i SI.
- **HCLTech possiede CAMWorks + Glovius** (viewer multi-CAD): il precedente più vicino di IT-services che monetizza software CAM+viewer proprio. (Glovius è viewer CAD geometrico, non NC.)
- **Accenture** ha creato l'**Accenture Siemens Business Group: 7.000 persone** (mar 2025) + acquisito **IndX** (650 specialisti Siemens DI, giu 2026) + lancia software proprio (Physical AI Orchestrator). → il rivale sta occupando **massicciamente** il terreno Siemens-PLM.
- **Capgemini**: Siemens Alliance Partner of the Year 2024, 16 aree AI-native co-sviluppate (ott 2025), alleanza Dassault dal 2019. Canale fortissimo — **ma nessun software proprietario di dominio NC/CAM**, e per il viewing dentro Reflect IoD **usa Autodesk APS**, non tecnologia propria → l'obiezione interna sarà "perché non APS/JT2Go?". Precedente utile: **Reflect IoD** è una piattaforma Capgemini brandizzata e venduta sul marketplace Microsoft → un viewer proprietario non sarebbe una prima assoluta.

## 6. Open source: commoditizza solo lo strato "viewer semplice"
Kiri:Moto (MIT, CAM completo nel browser, embeddabile), ncviewer.com + 4-5 cloni, decine di loader three.js → **il rendering di percorsi è a prezzo zero**. Ma **nessun OSS** copre: dialetti tubo industriali, tubo svolto, STEP B-rep in-browser, STEP→NC dal B-rep, integrazione PLM. → il moat difendibile è **dialetti + STEP esatto + embedding PLM**, non il rendering. Rischio: OpenCascade.js è LGPL, wrappa OCCT 7.6.2 (vecchio), manutenzione sottile, nessun prodotto enterprise noto lo usa (supply-chain + barriera per i cloni).

## 7. AVVOCATO DEL DIAVOLO (sintesi dai dati)
| # | Argomento contro | Severità | Mitigazione onesta |
|---|---|---|---|
| 1 | Il valore che credevi moat (STEP→NC, viewing) è **commodity**; resta difendibile solo il combinato stretto dialetti-tubo + embedding PLM | **serio** | Riposizionare su "verifica leggera in AWC" + moat dialetti; non vendere generazione/rendering |
| 2 | TAM minuscolo (~3.000 siti), **nessun pain-pull**, vendita solo top-down | **serio** | Non è un business software autonomo → asset-acceleratore dentro commesse esistenti |
| 3 | Sui due target citati lo slot è **parzialmente occupato**: DELMIA (NC review nativo su 3DX), KISTERS (viewer già in AWC) | serio | Lasciare 3DX, guidare con Teamcenter; differenziare su semantica NC vs KISTERS |
| 4 | I **file NC non attraversano i confini aziendali** (scambio a livello STEP): la premessa "interop NC" è in parte falsa | serio | Spostare la narrativa da "interop NC" a "verifica/governance nel PLM" |
| 5 | **IP/legale**: dialetti proprietari ottenuti per reverse engineering (Adige/BLM/Alma), codice fatto con AI + file cliente, IP del dipendente, componente GPL | serio→**fatale se ignorato** | Gate legali PRIMA (già identificati); dataset sintetici; togliere GPL |
| 6 | **Cimitero degli asset** consulenziali: chi manutiene dopo il progetto? Il riflesso Capgemini è comprare SDK partner (APS), non costruire; e competere nel dominio di Siemens/Dassault crea attrito col partner | serio | Incardinare con owner+roadmap finanziata; posizionare come complementare (non concorrente) ai vendor |
| 7 | **Accenture** è già lì con 7.650 persone dedicate a Siemens: saresti un asset minuscolo contro un esercito | gestibile | Non competere sulla scala ma sulla specificità (NC/tubo) come differenziatore di offerta, non come prodotto |

## 8. La tesi che SOPRAVVIVE
Non "SDK di prodotto per interop NC" (mercato non osservabile), ma:
> **"Widget di verifica NC nel client web del PLM"** — review leggera e pervasiva dentro Active Workspace, dove Vericut/NX non arrivano (desktop, costosi, per pochi seat) — venduto come **acceleratore dentro le commesse Siemens/Dassault già di Capgemini**, differenziato su semantica NC multi-dialetto e zero-dependency. Software revenue piccola; il ROI vero è **trainare i servizi** e **differenziare l'offerta** vs Accenture.

**Azioni che ne derivano:** lead Teamcenter/AWC (non 3DX) · differenziare vs KISTERS su NC, non su viewing · complementare (non sostitutivo) a Vericut · benchmark obbligato vs MachineWorks-cloud e NCSIMUL-4CAM nel pitch · demo come arma, ma raccontata come "verifica/governance", non "genero NC".

---
*Tutte le URL nei finding sono verificabili; i claim marcati "killer" (MachineWorks cloud, DELMIA NSV, KISTERS in AWC, NCSIMUL 4CAM, ArTube one-click) vanno riverificati alla fonte prima di citarli in un documento ufficiale — la fase di verifica avversariale del workflow è stata interrotta dal limite di sessione.*
