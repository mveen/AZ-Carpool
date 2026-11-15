# De pipeline: snelheid, bewaking en terugdraaien

Wat de CI/CD-pipeline (`.github/`, `run-tests.js`, `scripts/`) doet om snel, veilig en gecontroleerd te blijven. Stand 2026-11-15, na de pipeline-review. De deploy zelf (volgorde, rsync, smoke test) staat in README *Deploy* en in [`wachtpagina-host.md`](wachtpagina-host.md).

## Wat er snel aan is

- **Tests naast elkaar.** `run-tests.js` draait de testbestanden parallel (aantal kernen, hoogstens 4; `TEST_JOBS=1` voor één voor één als je een verdachte onderlinge storing zoekt). De uitvoer staat altijd in bestandsvolgorde. Op een computer met 2 kernen: 47 s -> 25 s.
- **De controle na de upload** (`.github/scripts/check-site.sh`) vraagt de site bij de wachtpagina van de host maar twee keer per bestand (`CHECK_WAIT_TRIES`) en leest het daarna via SSH op de host zelf. Daarna gaan de andere bestanden na één vraag direct naar de host. Voorheen kostte die stap bij een geblokkeerde deploy zo'n 160 s.
- **Robotbrowsers uit de cache.** De actie `.github/actions/playwright` cachet de gedownloade browsers per Playwright-versie. De versie staat alleen in die actie.
- **De testsite-keten loopt naast de tests.** In `deploy.yml` heeft `deploy-test` geen `needs` meer: upload naar test en robottest starten meteen, terwijl tests en lint lopen. **Live wacht op alle vier** (`tests`, `lint`, `deploy-test`, `smoke`). Gevolg: de testsite kan een versie krijgen die de tests nog niet gehaald heeft (dat is waar je iets probeert); live nooit. De databaseregels voor de *test*-database worden dus ook eerder gepubliceerd. Een aparte job om de robotbrowsers alvast te installeren helpt niet: elke job is een eigen computer, dus de installatie (vooral `apt`) is voor de smoke-job niet beschikbaar.
- **Geen dubbele testrun na een merge.** `tests.yml` draait alleen op pull requests; na de merge draait `deploy.yml` dezelfde tests (en lint) voordat er iets wordt geüpload.

## Wat er extra gecontroleerd wordt

- **Lint is deel van de deploy-poort.** `deploy.yml` heeft een job `lint` naast `tests`; de testsite wacht op beide.
- **De pipeline zelf.** `lint.yml` draait `scripts/run-workflow-lint.sh`: actionlint (vastgezet op versie én checksum) over de workflows en shellcheck (waarschuwingen en fouten) over elk `.sh`-bestand. Lokaal: `ACTIONLINT=/pad/naar/actionlint bash scripts/run-workflow-lint.sh` of zonder variabele op Linux.
- **Alle actions staan vast op een commit-hash** (`tests/pipeline.test.js` controleert dat, ook voor de eigen acties).
- **`npm run lock` weigert zonder rsync.** Zonder rsync slaan 9 uploadtests over en komt de telling 9 te laag uit (CI faalt dan). `npm test` zonder rsync meldt dat en slaat alleen de telcontrole over.

## Bewaking: `uptime.yml`

Elk uur haalt `scripts/uptime-check.mjs` (alleen lezen, geen login, geen secrets) de live site op: `service-worker.js`, de startpagina en elk bestand uit de `ASSETS`-lijst; JavaScript moet als JavaScript komen. Rood = er mist iets of de site is weg; GitHub mailt de eigenaar bij een mislukte geplande run. **De wachtpagina van de host telt niet als storing**: dan is de uitkomst "inconclusive" (groen, met een melding). Let op: omdat de bot-controle GitHub-computers vaak blokkeert, kan een groot deel van de uurlijkse runs inconclusive zijn; kijk in het log. Dit is een vangnet voor "bestand weg of site weg", geen vervanger van een externe monitor.

## Terugdraaien: `rollback.yml`

Actions -> *Rollback azcarpool.nl* -> *Run workflow* met een tag of commit (SHA) die eerder live was. Handmatig, zelfde slot als de deploy (nooit tegelijk). De tools (upload- en controlescripts, SSH-setup) komen uit de versie waarvan de workflow draait (`tools/`), alleen de app uit de gevraagde versie (`src/`). Wél: bouwen, uploaden, controleren dat de site die versie serveert. Niet: tests, testsite, databaseregels, cron-jobs. Een versie zonder `scripts/build-deploy.mjs` (van vóór de buildstap) kan niet; de melding zegt dat. Telefoons wisselen zelf terug doordat `service-worker.js` een andere `CACHE_NAME` heeft. Bij de volgende gewone deploy: houd `CACHE_NAME` hoger dan die van de nu geplaatste versie.

## Bewust niet gedaan

- **Smoke test in een matrix (Chromium en WebKit tegelijk).** Zou ~30 s schelen, maar twee robots loggen dan tegelijk in met dezelfde testaccounts. Dat is niet te proberen voordat het op main staat; eerst één keer de gewone run bekijken.
- **Verplichte status checks op `main`** (branch protection): dat is een GitHub-instelling, geen bestand.
