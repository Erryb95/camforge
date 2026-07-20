# Incassare i primi ricavi — Lemon Squeezy (Merchant of Record)

> ⚠️ **Informazione, non consulenza fiscale.** Vendere software online in modo
> continuativo è, in Italia, attività d'impresa → verosimilmente serve **P.IVA
> (forfettario)**. I "5.000 € occasionali" NON si applicano alla vendita di licenze.
> **Sentire un commercialista PRIMA di incassare il primo euro.** Lemon Squeezy
> risolve l'**IVA** (fa da venditore ufficiale), NON l'imposta sul reddito né l'obbligo
> di P.IVA. Vedi la sintesi in chat / MEMORY.

## Perché Lemon Squeezy
È un **Merchant of Record**: diventa il venditore legale verso i clienti finali e
gestisce **IVA/tasse/fatture in tutto il mondo** al posto tuo (incluso l'OSS UE, che
un privato senza P.IVA non potrebbe gestire). Accetta persone fisiche (verifica
d'identità, non serve un tax id da venditore). Nata per il software: **license key**
native + checkout overlay agganciabile al sito. Fee 5% + $0,50. Payout via
bonifico/PayPal (min $100). Ora è parte di Stripe.

Alternative equivalenti (stesso schema MoR): **Gumroad** (10%, partenza istantanea,
zero approvazione), **Polar** (4–5%, fee più basse), **Paddle** (onboarding selettivo).

## Setup (una volta, ~15 min)
1. Crea un account su **lemonsqueezy.com** e uno **Store**.
2. Crea un **Prodotto** "CamForge Pro" con **2 varianti**:
   - Abbonamento **$6 / mese** (subscription)
   - **$49 lifetime** (one-time)
3. (Consigliato) attiva **Licensing** sul prodotto → ogni acquisto genera una
   **license key** automatica.
4. Copia i **buy URL** delle due varianti (Share → "Buy link", tipo
   `https://TUOSTORE.lemonsqueezy.com/buy/<uuid>`).
5. Incollali in **`pricing.html`** → costante `CHECKOUT` (`monthly` e `lifetime`).
   Sostituisci i placeholder `YOURSTORE`/`REPLACE_WITH_...`.
6. Commit + push → il pulsante **Get Pro** aprirà l'overlay di checkout in-pagina
   (lemon.js è già incluso). I dati carta stanno su Lemon Squeezy, mai sul sito.

## Dopo l'acquisto
Il cliente riceve la **license key** (email + pagina di successo). La incolla nell'app
in **⚡ Upgrade → Activate** per sbloccare l'export.

> Nota tecnica: oggi l'attivazione è **client-side** (chiave in `localStorage`,
> `src/license.js`) = MVP bypassabile. Per l'enforcement reale, validare la key con
> l'**API License di Lemon Squeezy** da un piccolo backend (o Netlify/Cloudflare
> Function) quando i volumi lo giustificano.

Guida overlay: https://docs.lemonsqueezy.com/help/checkout/checkout-overlay
