# NC Interop & Viewer Engine — one-pager pitch interno
*Bozza 2026-07-13 — riservato. Fonte estesa: docs/BUSINESS_PLAN.md*

**In una frase:** portiamo visualizzazione, verifica e generazione dei programmi NC (taglio laser/tubo) *dentro* gli strumenti che i nostri clienti manufacturing hanno già — Teamcenter, NX, 3DEXPERIENCE, MES — con un motore web zero-dipendenze che esiste già ed è validato su file di produzione reali.

## Il problema del cliente
I programmi macchina (G-code, dialetti proprietari tubo) sono l'ultimo miglio NON governato del digital thread: vivono su share di rete e USB, si verificano "a occhio" in officina, non sono legati alla revisione CAD che li ha generati. Ogni verifica richiede o la macchina ferma o licenze CAM/verifica costose per pochi seat.

## L'asset (esiste, funziona)
- Parser NC multi-dialetto (ISO, LinuxCNC con espressioni, **Adige/BLM**, **Cutlite**, **AlmaCAM/LXD**) validato su file di produzione; viste 2D/3D solido/**tubo svolto**; simulazione con code-follow.
- **B-rep STEP esatto** (OpenCascade WASM) e **STEP→NC in un click** (feature → sequenza → post-processor GRBL/LinuxCNC/tubo).
- **Zero dipendenze**: si embedda in qualunque web app con uno script — PLM, MES, portali.
- 85/85 test automatici; demo live: STEP → programma → simulazione in 3 minuti.

## Confronto con NCnetic/NCneticNpp (riferimento di mercato nel viewing NC)
| | NCneticNpp | Il nostro motore |
|---|---|---|
| Piattaforma | Plugin Notepad++, Windows, per-seat | **Web/WASM embeddabile ovunque**, multi-utente |
| Simulazione | **4/5 assi, cinematica configurabile** (punto di forza) | 2D/3D/svolto tubo; niente cinematica collisioni (gap) |
| CAD / STEP | assente | **B-rep esatto, feature, confronto modello↔programma** |
| Generazione NC | assente (solo viewing/sim) | **STEP→NC con post-processor** |
| Dialetti tubo ITA (Adige/Cutlite/LXD) | non documentati | **nativi, validati con RE su coppie reali** |
| Integrazione PLM/MES | assente | progettato per questo (TC/AWC per primo) |
| Modello di business | mono-sviluppatore, clienti piccoli | canale enterprise Capgemini, asset-based |

**Complementarietà, non guerra:** la lacuna nostra (cinematica 4/5 assi) è il punto di forza loro → opzione di **licensing del kernel di simulazione** dentro l'offerta enterprise. Relazione diretta con l'autore già esistente (NDA prima).

## Sviluppi che generano plusvalore (in ordine di ROI)
1. **Preventivazione istantanea da STEP** — tempi ciclo + sfrido dal modello 3D: il commerciale del cliente carica il pezzo, ottiene il preventivo. Vendibile da sola.
2. **Part-to-program governato dal PLM** — STEP rilasciato in Teamcenter → NC bozza tracciata (revisione↔programma): qualità, audit, digital thread completo.
3. **Verifica leggera in AWC** — il capofficina apre il dataset NC nel browser e vede cosa farà la macchina: meno scarti, meno fermi. (Con kernel NCnetic: anche collisioni 4/5 assi.)
4. **Tecnologia & kerf** — tabelle materiale×spessore + compensazione (primitiva già integrata): da viewer ad advisor.
5. **Confronto as-designed ↔ as-programmed** — overlay geometrico automatico: controllo qualità del programma prima del truciolo.
6. **Dizionari dialetto self-service** — onboarding di una macchina nuova in giorni: NRE ricorrente per noi, indipendenza per il cliente.

## L'ask
- **Sponsor BU** + budget fase 0-1: **1,5-2 FTE × 3 mesi** (bonifica licenze → SDK v0.1 embeddabile).
- **1 cliente pilota** dal portafoglio manufacturing (profilo: taglio laser/tubo + Teamcenter o 3DX).
- Decisione go/no-go a 90 giorni su risultati pilota; poi partner program Siemens/3DS e marketplace.

**Prerequisiti già identificati e gestibili:** titolarità IP da formalizzare con la BU (questo pitch è il primo passo); bonifica OSS nota e stimata (2 gg — un componente GPL da rimuovere).
