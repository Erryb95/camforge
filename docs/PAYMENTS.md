# Incassare i primi ricavi — Polar (Merchant of Record)

> ⚠️ **Informazione, non consulenza fiscale.** Vendere software online in modo
> continuativo è, in Italia, attività d'impresa → verosimilmente serve **P.IVA
> (forfettario)**. I "5.000 € occasionali" NON si applicano alla vendita di licenze.
> **Sentire un commercialista PRIMA di incassare il primo euro.** Un MoR risolve
> l'**IVA** (fa da venditore ufficiale), NON l'imposta sul reddito né l'obbligo di P.IVA.

## Perché un Merchant of Record (e perché Polar)
Un **MoR** diventa il venditore legale verso i clienti finali e gestisce **IVA/tasse/
fatture in tutto il mondo** al posto tuo (incluso l'OSS UE, che un privato senza P.IVA
non potrebbe gestire). Accetta persone fisiche (verifica d'identità, non serve un tax id
da venditore). Il netto ti arriva come **payout**.

**Fee più basse tra i MoR = Polar** (5% + $0,50 flat, senza i sovrapprezzi
internazionale/payout di Lemon Squeezy che per un venditore IT salgono a ~6,5-7%).
Payout PayPal/deposito, soglia $10, ottima DX per sviluppatori.

| MoR | Fee reale (venditore IT) | Note |
|---|---|---|
| **Polar** ⭐ (scelto) | **5% flat** | Fee più basse · payout $10 · checkout embed |
| Lemon Squeezy | ~6,5-7% | Nativo software, di Stripe, ma sovrapprezzi |
| Paddle | 5% | Onboarding selettivo (richiede sito+T&C) |
| Gumroad | 10% | Il più caro ma parte in 5 minuti |
| ~~Stripe / Ko-fi~~ | — | NON MoR → l'IVA resta a te → serve P.IVA |

## Setup (una volta, ~15 min)
1. Crea un account su **polar.sh** e un'organizzazione.
2. Crea un **Prodotto** "CamForge Pro" con **2 prezzi**:
   - Abbonamento **$6 / mese**
   - **$49 lifetime** (one-time)
3. (Consigliato) attiva **License Keys** sul prodotto → ogni acquisto genera una key.
4. Genera i **Checkout Link** delle due varianti (tipo `https://buy.polar.sh/<id>`).
5. Incollali in **`pricing.html`** → costante `CHECKOUT` (`monthly` e `lifetime`),
   sostituendo i placeholder `REPLACE_WITH_...`.
6. Commit + push → il pulsante **Get Pro** aprirà l'overlay di checkout in-pagina
   (l'embed Polar `data-polar-checkout` è già incluso). Carta su Polar, mai sul sito.

## Dopo l'acquisto
Il cliente riceve la **license key** → la incolla in **⚡ Upgrade → Activate** nell'app
per sbloccare l'export.

> Nota tecnica: oggi l'attivazione è **client-side** (chiave in `localStorage`,
> `src/license.js`) = MVP bypassabile. Per l'enforcement reale, validare la key con
> l'**API di Polar** da una piccola function (Netlify/Cloudflare) quando i volumi lo
> giustificano.

Guida embed: https://docs.polar.sh/features/checkout/embed
