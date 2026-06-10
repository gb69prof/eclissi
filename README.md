# Atlante delle eclissi — PWA didattica

Questa PWA mostra un sistema solare leggibile in scala compressa e una banca dati delle eclissi solari e lunari dal 10 giugno 2026 al 10 giugno 2036.

## Cosa contiene

- Vista **Sistema**: pianeti calcolati con elementi orbitali kepleriani JPL, in scala visuale compressa.
- Vista **Eclisse**: geometria Sole–Terra–Luna e cono d’ombra/penombra.
- Vista **Terra**: globo semplificato con aree regionali di visibilità tratte dai cataloghi NASA/GSFC.
- Vista **Osservatore**: simulazione del fenomeno visto da una località terrestre. Di default: Foggia.
- Calcolo locale, quando la libreria è disponibile online, tramite Astronomy Engine in browser.
- Modalità offline PWA dopo il primo caricamento per l’interfaccia e i dati incorporati; il calcolo astronomico avanzato dipende dal caricamento della libreria esterna.

## Limiti dichiarati

Non è un planetario scientifico professionale con mappe Besseliane al metro. È uno strumento didattico avanzato: usa fonti autorevoli per le date globali e calcolo locale approssimato/astronomico quando possibile, ma la resa spaziale è volutamente leggibile e non in scala fisica assoluta.

## Avvio

Apri `index.html` in un browser moderno. Per usare bene il service worker/PWA conviene servirla da un piccolo server locale o pubblicarla su GitHub Pages.

Esempio:

```bash
python3 -m http.server 8080
```

poi apri `http://localhost:8080`.

## Fonti

- NASA/GSFC Eclipse Web Site, Fred Espenak: cataloghi decennali delle eclissi solari e lunari.
- NASA/GSFC Solar Eclipse Paths 2021–2040.
- JPL Solar System Dynamics: Approximate Positions of the Planets.
- Astronomy Engine JavaScript: calcoli astronomici lato browser.
