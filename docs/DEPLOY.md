# Deploy CamForge → camforge.app

L'app è **interamente statica** (three.js/WASM lato client; `server.mjs` è solo un
file-server). Quindi il modo più semplice e gratuito per andare online è un **host
statico**. Sotto: la via consigliata (GitHub Pages, DNS deterministico) e l'alternativa
Node (Render), più la config DNS su Namecheap.

Struttura servita: `camforge.app/` = **app** · `camforge.app/site/` = landing+pricing ·
`camforge.app/site/pricing.html` = checkout. (Homepage = app: funnel product-led, l'upsell
Pro rimanda al pricing.)

---

## A) GitHub Pages — statico, gratis (consigliato)
Il repo è già pronto: `CNAME` (= `camforge.app`) e `.nojekyll` in root.

1. Crea un **repo GitHub** (es. `camforge`) — serve il TUO account (non posso crearlo io).
2. Push del progetto:
   ```
   git remote add origin https://github.com/<tuo-utente>/camforge.git
   git push -u origin master   # (o main)
   ```
3. Repo → **Settings → Pages** → Source: `Deploy from a branch`, Branch: `master` / root.
   Custom domain: `camforge.app` (rileva il file CNAME) → **Enforce HTTPS** dopo la verifica.
4. Il DNS (sotto) è già puntato agli IP di GitHub Pages → il sito si accende in pochi minuti.

> Nota: `vendor/` pesa ~111 MB (occt-full 64 MB, sotto il limite 100 MB/file di GitHub).
> Il WASM STEP si scarica solo aprendo un file STEP/IGES.

## B) Render — se vuoi il server Node attivo (alternativa)
`server.mjs` rispetta `process.env.PORT` e bind `0.0.0.0` in hosting. Su Render: New →
**Web Service** dal repo, Build: `-`, Start: `npm start`. Poi Custom Domain `camforge.app`
→ Render fornisce l'IP/CNAME da mettere nel DNS (diverso da GitHub Pages).

---

## DNS su Namecheap (per GitHub Pages)
Domain List → **camforge.app** → **Advanced DNS** → Host Records:

| Type  | Host | Value                | TTL       |
|-------|------|----------------------|-----------|
| A     | @    | 185.199.108.153      | Automatic |
| A     | @    | 185.199.109.153      | Automatic |
| A     | @    | 185.199.110.153      | Automatic |
| A     | @    | 185.199.111.153      | Automatic |
| CNAME | www  | `<tuo-utente>.github.io.` | Automatic |

(Rimuovi eventuali record parcheggio/CNAME `@` di default di Namecheap.)
Per **Render** invece: A `@` → IP fornito da Render, CNAME `www` → `<app>.onrender.com`.

## Stripe (checkout)
Il bottone *Get Pro* in `site/pricing.html` usa link **placeholder**. Crea 2 Payment Link
su Stripe (mensile $6, one-time $49) e sostituiscili nella costante `CHECKOUT` della pagina.

## Enforcement licenze (roadmap)
Il gating Pro è client-side (MVP). Per l'enforcement vero: piccolo backend che valida la
chiave e genera l'export server-side (allora conviene l'host Node/Render, non Pages).
