# AZ Carpool — project notes

## Deploy (belangrijk)
- **Verhoog `CACHE_NAME` in `service-worker.js` bij ELKE deploy** (nu `az-carpool-v14` → `v15`, `v16`, …), ook als de assetlijst niet verandert.
- Reden: open apps (telefoon, startscherm) zoeken bij terugkeer naar de voorgrond naar een gewijzigde `service-worker.js` en herladen dan zelf één keer (zie `bootstrap()` in `app.js`). Zonder wijziging in dat bestand ziet niemand de update.
- Werk het versienummer ook bij in README → Deploy, stap 4.
- Nieuw bestand toevoegen? Zet het ook in de `ASSETS`-lijst van `service-worker.js`.

## Tests
- `npm test` moet groen zijn vóór een push. Elke modulewijziging vraagt een testwijziging in het bijbehorende testbestand (regelcontrole). Daarna `npm run lock`.
