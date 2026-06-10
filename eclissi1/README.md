# ECLISSI — Atlante cosmico interattivo

PWA didattica per esplorare le eclissi dei prossimi dieci anni partendo da tre scale:

1. **Vista cosmica** — sistema solare completo in scala compressa, orbite planetarie, posizione Terra-Luna e geometria dell’allineamento.
2. **Ombra sulla Terra** — globo interattivo con fascia centrale per eclissi totali/anulari/ibride e area di visibilità didattica.
3. **Vista al suolo** — simulazione prospettica dell’eclissi dal punto di vista dell’osservatore, modellata sul paesaggio allegato dall’utente: mare, montagne, luce radente, corona e oscuramento progressivo.

## Cosa è preciso e cosa è didattico

- Le date, i tipi, la magnitudine, la durata centrale e le regioni di visibilità globale derivano dalle tabelle NASA/GSFC di Fred Espenak.
- La vista del sistema solare usa orbite e periodi compressi per permettere una lettura in un colpo d’occhio. Non è una simulazione astrometrica da navigazione.
- La stima locale dell’osservatore è intenzionalmente didattica: serve a capire se ci si trova nella fascia centrale, in parzialità forte, in parzialità marginale o fuori dall’area principale. Per contatti al secondo, mappe certificate e circostanze locali definitive bisogna usare le tabelle ufficiali NASA/GSFC o software astronomico specialistico.

## Interazioni principali

- Seleziona una eclisse nell’elenco a sinistra.
- Filtra tra eclissi solari, lunari o tutte.
- Usa la timeline della fase per vedere inizio, massimo e fine.
- Cambia località o inserisci coordinate.
- Usa **Vai alla fascia centrale** per spostarti sul corridoio dell’eclissi e vedere la scena al suolo nella forma più spettacolare.
- Cambia vista: completa, cosmo, Terra, al suolo.
- Premi spazio per avviare/fermare l’animazione; frecce sinistra/destra per passare da una eclissi all’altra.

## Installazione come PWA

Carica tutti i file su GitHub Pages o su un server HTTPS. Aprendo `index.html`, il browser proporrà l’installazione della PWA quando supportata.

Per prova locale rapida:

```bash
python3 -m http.server 8080
```

Poi apri:

```text
http://localhost:8080
```

## Fonti dati

- NASA/GSFC, Fred Espenak — Solar Eclipse Decade Tables 2021-2030 e 2031-2040.
- NASA/GSFC, Fred Espenak — Lunar Eclipse Decade Tables 2021-2030 e 2031-2040.
- Spiegazioni NASA su eclissi solari/lunari e inclinazione dell’orbita lunare.

## Nota di sicurezza

Non osservare mai il Sole senza filtri certificati per eclissi. La PWA mostra un fenomeno; non protegge gli occhi.
