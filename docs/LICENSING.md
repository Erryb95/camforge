# CamForge — Licenze e anti-crack

Come funziona lo sblocco **Pro** (export G-code + material file) e cosa devi fare tu.

## In breve

- **FREE**: viewer, simulazione, anteprima G-code — tutto gratis, senza account.
- **PRO**: **export** (download G-code QtPlasmaC + material file).
- La licenza è un **token firmato** (`CF1-…`) che il cliente incolla in **⚡ Upgrade → Activate**.
- L'app lo **verifica offline** con una chiave pubblica inclusa nel codice. Nessuna
  connessione richiesta: funziona anche nell'app desktop offline.

## Perché è robusto (e cosa NON può fare)

La firma è **ECDSA P-256**. La chiave **privata** che firma le licenze **ce l'hai solo tu**;
l'app ha solo la chiave **pubblica**, che serve a *verificare*, non a *creare*. Conseguenze:

- ✅ **Nessun keygen è possibile.** Falsificare una firma valida senza la privata è
  computazionalmente impossibile. Chi manomette il payload (es. si auto-promuove a
  "lifetime") rompe la firma → rifiutato.
- ✅ Ogni chiave è **legata a email + piano + scadenza**: una chiave trapelata è
  tracciabile e, se abbonamento, **scade da sola**.
- ✅ Lo stato "sbloccato" **non è un flag su disco** da ribaltare: vive in memoria dopo
  una verifica crypto e viene **ri-controllato ad ogni export**.
- ⚠️ **Non è invulnerabile.** CamForge è un'app **client-side**: chi sa usare i DevTools
  può patchare la propria copia in locale. Questo vale per QUALSIASI software client
  (SheetCam inclusa). L'obiettivo realistico — **azzerare i keygen e alzare l'asticella** —
  è raggiunto. Per un tool di nicchia a basso prezzo, il target (officine) paga.

## Emettere una licenza (dopo una vendita)

Una volta sola, genera la coppia di chiavi:

```bash
node tools/license-keygen.mjs
```

Salva `tools/license-private.jwk` (è **gitignorata**: non finisce mai su GitHub) e incolla
la `PUBLIC_JWK` stampata dentro `src/license.js`. **⚠️ Fai un backup offline della chiave
privata** (es. password manager / chiavetta): se la perdi non puoi più emettere licenze;
se la rigeneri, **tutte le licenze esistenti smettono di funzionare**.

Per ogni cliente:

```bash
# licenza a vita
node tools/license-gen.mjs --email cliente@dominio.com --plan lifetime

# abbonamento mensile (scade tra ~1 mese; riemetti al rinnovo)
node tools/license-gen.mjs --email cliente@dominio.com --plan monthly
```

Copia il token `CF1-…` stampato e invialo al cliente.

## Collegare a Polar (automazione futura)

Oggi il flusso è manuale (1 comando per vendita). Per automatizzarlo:

1. Su **Polar** attiva il webhook **`order.paid`** verso una piccola funzione serverless.
2. La funzione richiama la stessa logica di `tools/license-gen.mjs` (firma con la privata,
   tenuta come *secret* del provider serverless — **mai nel repo**) e invia la key al cliente.
3. In alternativa, Polar ha anche **License Keys** native (validazione via API online): utile
   per **revoca** e **limite di attivazioni**, ma richiede connessione. Il nostro schema
   firmato resta il migliore per l'**uso offline** dell'app desktop.

## Contro il key-sharing (una chiave usata da molti)

La firma non impedisce da sola che un cliente passi la sua key ad altri. Mitigazioni, in
ordine di convenienza:

- **Abbonamento mensile** → le key scadono, il rinnovo va fatto dall'acquirente.
- **Email in chiaro nella licenza** → una key condivisa è tracciabile fino all'acquirente.
- **Limite attivazioni** → gestibile con le License Keys di Polar (online) quando/se serve.

Non vale la pena rincorrere il 100%: per questa fascia di prezzo il costo di difesa supera
il ricavo perso. Meglio investire in valore continuo (aggiornamenti, cut chart, supporto)
che una vecchia copia craccata perde.

## Limiti noti (da un attacco avversariale, in ordine di pericolosità)

Un review avversariale (3 "attaccanti" + sintesi) ha trovato questi limiti. Quelli
economici sono **già chiusi**; gli altri sono *scelte* consapevoli.

1. **Copia dall'anteprima FREE** *(irreducibile in un'app client-side)*. Il free mostra e
   simula l'intero G-code: un utente può selezionarlo e copiarlo dal pannello codice senza
   "craccare" nulla. È il rovescio del punto di forza ("vedi tutto funzionare gratis").
   *Mitigato in parte*: rimosso l'hook di debug `window.__getModel` che lo rendeva un
   one-liner. *Chiusura vera solo con una scelta di prodotto*: degradare l'anteprima free
   (troncarla, azzerare feed/coordinate, banner TRIAL) e produrre il file pulito **solo**
   nel percorso Pro. È una **decisione tua** (tocca la UX gratuita che porta i clienti).
2. **Condivisione della chiave** *(parziale, offline)*. Una key legittima passata a molti
   funziona su più PC. *Mitigato*: email dell'acquirente **stampata nell'header** di ogni
   file esportato (tracciabile) + scadenza mensile. *Chiusura vera*: **attivazione online
   una-tantum con limite di dispositivi** (via Polar License Keys) — da fare **solo se** la
   pirateria diventa reale sui forum. Resta offline dopo l'attivazione.
3. **Patch a runtime** (console) *— chiuso il caso banale*: le primitive WebCrypto vengono
   catturate al load, quindi `crypto.subtle.verify = () => true` non sblocca più.
4. **Edit del file / repack dell'exe** *(irreducibile per un client offline)*. Chi possiede
   i byte può modificare il gate. *Alza l'asticella* (non chiude): minificare/bundlare la
   build di produzione + **firmare l'exe** con code-signing. Rimandati: il bundling
   contraddice la scelta "zero build/zero dipendenze"; la firma richiede un certificato a
   pagamento — da valutare con le prime vendite.
5. **Rollback dell'orologio** su piano mensile *(minore)*: sposta la data indietro e
   l'abbonamento scaduto rivive. Impatto basso; si chiude solo con l'ora dal server.

**Sintesi onesta:** per un tool di nicchia a basso prezzo lo schema attuale (token firmati +
verifica offline + primitive catturate + filigrana email) è **adeguato**: azzera i keygen e
ferma la maggioranza. I due veri buchi (copia-anteprima e condivisione) si chiudono solo con
scelte di prodotto/architettura — da fare *se e quando* servono, non prima.
