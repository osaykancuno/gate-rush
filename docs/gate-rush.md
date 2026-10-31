# GATE RUSH

Un gioco di THE WALL ARCADE. Le persone del muro corrono verso il gate di NFC Summit 2027 su tre corsie, ognuna chiusa
da un tornello. I tornelli sono aperti: **tocca una corsia** (o premi 1 2 3, ← ↓ →) per **sbattere il suo tornello
chiuso per 1 secondo**. Non serve conoscere i nomi: chi è chi si vede dal segno sopra la testa.

| Chi arriva | Segno | Cosa fare |
| --- | --- | --- |
| Ospite | braccialetto **blu** | lascialo entrare (tornello aperto) |
| VIP | **corona d'oro** | lascialo entrare, non fermarlo mai |
| Imbucato | **occhiali da sole** | chiudi il tornello: viene preso |
| Imbucato che corre (dalla 3ª ondata) | occhiali + scie | chiudi prima |
| Imbucato che cambia corsia (dalla 4ª) | occhiali + freccia | chiudi la corsia dove arriva |
| Braccialetto falso (dalla 5ª) | braccialetto **rosso** | chiudi il tornello |

- 3 s di countdown, poi 90 s. **La corsa accelera in modo continuo dal primo all'ultimo secondo**: la velocità sale
  di un passo (meno dell'1%) ogni pochi tick, da 120 a 280 unità per tick (×2,3, l'indicatore SPEED sotto il timer), e
  gli arrivi si infittiscono allo stesso modo (da uno ogni 22 tick a uno ogni 9). Le 6 ondate da 15 s introducono solo i
  nuovi tipi.
- Chi arriva a un tornello chiuso si ferma lì: l'imbucato è preso (+100), l'ospite aspetta (serie azzerata, entra dopo
  per +10) e se aspetta più di 2 s se ne va arrabbiato, il VIP si offende.
- Punti: ospite entrato +50, VIP +150, imbucato preso +100, × moltiplicatore (sale di 1 ogni 10 di fila, fino a ×5).
- **Cuori** (3): li perdi se entra un imbucato, se fermi un VIP, se un ospite se ne va arrabbiato. Zero cuori: fine.
- Gate tenuto per 90 s: **+1000 e +500 per ogni cuore rimasto**.
- La fine mostra la card con il **titolo da buttafuori** (IRON GATE, LEGEND OF THE GATE, CRASHER MAGNET, THE PUSHOVER,
  VIP NIGHTMARE, TRAFFIC JAM…), le persone del muro entrate con i loro sprite e POST ON X, che le tagga: "You're on the
  list".
- Solo grafica: la pista da ballo con chi è entrato, le reazioni ("BUSTED!", "LOL THANKS", "DO YOU KNOW WHO I AM?"), gli
  annunci di ogni ondata e di ogni moltiplicatore, i coriandoli per i VIP.

Pratica gratuita con le stesse regole nel browser, niente registrato.

## Pubblicare da Windows

Doppio clic su `PUBBLICA.cmd` (la prima volta e ogni volta che il gioco cambia). Fa tutto `PUBBLICA.ps1`: controlla
Node.js, installa la riga di comando di SuperRare e le dipendenze, aggiorna i nomi del muro, lancia i test, fa il login
se serve, crea l'app una volta sola (la risposta resta in `deploy/gate-rush.app.json`, la config in
`deploy/gate-rush.config.json`), costruisce lo ZIP e aggiorna la stessa app; alla fine stampa i dati per il modulo di
invio e apre il gioco e la pagina di invio.

## Dove sta

| Parte | File |
| --- | --- |
| Regole deterministiche (motore, lo stesso modulo nel browser e nel verificatore) | `src/games/gate-rush/core.ts` |
| Schemi della pagina (sono i controlli di `core.ts`) | `src/games/gate-rush/engine.ts` |
| Client: corsie, tornelli, pista, card finale | `src/games/gate-rush/client.ts` |
| Verificatore (`POST /v1`, senza zod) | `src/verifiers/gate-rush.ts` |
| Ingresso della pagina | `src/entries/gate-rush.ts` |
| Config pubblica, scritta dallo script | `deploy/gate-rush.config.json`, `scripts/gate-rush-config.ts` |
| Test (regole, latenza, input falsificati, stati manomessi, verificatore compilato) | `tests/gate-rush.test.ts` |

L'unico input di gioco è `{ "action": "slam", "lane": 0 | 1 | 2 }` (più `{ "action": "start" }`): mai un punteggio, un
tempo o uno stato. Il tornello si chiude dal tick in cui il server riceve il tocco, e chi arriva a un tornello chiuso si
ferma lì: chiudere un attimo prima funziona sempre, anche con 100-150 ms di rete. Un tocco prima dell'apertura, dopo la
fine o malformato non cambia nulla. I nomi vengono dallo snapshot del muro incluso nella build
(`src/generated/wall.json`, aggiornabile con `node --import tsx scripts/snapshot-wall.ts`); gli sprite da people.json,
solo grafica.

Input automatici perfettamente legali sono accettati da queste regole: il gioco non è a prova di bot.
