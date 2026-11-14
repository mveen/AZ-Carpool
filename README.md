# AZ Carpool Aalsmeer–Alkmaar

Mobile-friendly carpool scheduler for AZ youth football parents. A static site (plain HTML, CSS and JavaScript modules, no framework and no build step for the code itself) with Firebase Firestore as its database. Live at `https://azcarpool.nl/`, hosted on mijn.host; GitHub Actions tests every change and puts it there (see *Deploy*). It is **not** served from GitHub Pages any more: that old address only forwards.

Since the modularisation, `index.html` is only a thin page: the app itself lives in the `.js` modules below. Every module has its own test file, and `npm test` runs them all.

## Files

| File | Purpose | Test file |
|---|---|---|
| `index.html` | Page shell (header, tab bar, empty screens) and the start-up script that connects Firebase and starts the app. No styles of its own | covered by the robot smoke test (see *Test environment*) |
| `tokens.css`, `components.css`, `print.css`, `fonts/` | The whole look: design tokens (colours, sizes), the shared building blocks, the paper Weekoverzicht, and the self-hosted fonts. Rules in `DESIGN.md` | `design-rules.test.js` |
| `app.js` | Start-up, tab switching, default tab, week rollover, `renderAll` | `app.test.js` |
| `state.js` | The one shared app state object `S` | `state.test.js` |
| `error-log.js` | The app's own error log (`errorLog/<uid>_<0-9>`): privacy-safe entries, queue when offline, catch-all for uncaught errors, 30-day clean-up | `error-log.test.js` |
| `session-reset.js` | "Opnieuw beginnen": sign out, empty the offline copy, remove the service worker, reload (also done once by itself at the gate) | `session-reset.test.js` |
| `constants.js` | Days, direction texts, app URL, icons, `APP_VERSION`, the end of the week (`WEEK_END_HOUR`) | `constants.test.js` |
| `escape.js` | HTML escaping on its own (no imports), so the server jobs can use `rides.js` without the screen code | `escape.test.js` |
| `i18n.js` | `t(key, params)` and `applyStaticTexts()` | `i18n.test.js` |
| `texts-nl.js` | All Dutch texts and messages (the translation file) | `i18n.test.js` |
| `dates.js` | Week keys, planning date, day labels, expiry times | `dates.test.js` |
| `rides.js` | Ride assignment logic: who drives whom (pure functions) | `rides.test.js` |
| `coordinator.js` | Coordinator/member rules, invite codes, phone numbers, day coordinator lookup (pure functions) | `coordinator.test.js` |
| `matches.js` | Match calendar events and match carpools | `matches.test.js` |
| `match-cars.js` | The cars of a match carpool: every change (add / edit / remove a car) as a Firestore transaction, plus the change log | `match-cars.test.js` |
| `match-legs.js` | Which leg of a match a car drives: heen, terug or both (pure functions) | `match-legs.test.js` |
| `data.js` | All Firestore access (through an adapter), listeners, saving | `data.test.js` (fake database only) |
| `message-texts.js` | WhatsApp and other messages, built from data, incl. the conclusie-appje (pure functions) | `message-texts.test.js` |
| `day-changes.js` | What changed on one day compared with the standard rooster (pure functions) | `day-changes.test.js` |
| `day-change-notice.js`, `ui-day-change-notice.js` | "Melding dagwijzigingen": the hint not to process a day's changes too early, and its Beheer card | `day-change-notice.test.js`, `ui-day-change-notice.test.js` |
| `weekrooster.js` | Afwijkend weekrooster (aanvragen, advies, akkoord): the rules of a request (pure functions) | `weekrooster.test.js` |
| `weekrooster-impact.js` | "Wie merkt dit": what a request would change for the other families, and the advice (`buildKeepAdvice`) (pure functions) | `weekrooster-impact.test.js` |
| `weekrooster-plan.js` | The day coordinator's changes to the proposal, on a list of cars (pure functions) | `weekrooster-plan.test.js` |
| `weekrooster-data.js` | Afwijkend weekrooster, the database side: requests, listeners, `acceptDay` | `weekrooster-data.test.js` |
| `ui-weekrooster-form.js` | Afwijkend weekrooster, parent side: the week form and "Doorgegeven" card in Wijzigen, "Tijden wijzigen" in Mijn week | `ui-weekrooster-form.test.js` |
| `ui-weekrooster-rooster.js` | Afwijkend weekrooster in Rooster "Deze week": "Actie nodig", "Recente wijzigingen", the day coordinator's card in Mijn week | `ui-weekrooster-rooster.test.js` |
| `ui-weekrooster-advice.js` | The day coordinator's flow in three steps: Aanvragen, Indeling, Controleren | `ui-weekrooster-advice.test.js` |
| `ui-weekrooster-edit.js` | Planning a day by hand: "Zelf indelen" and "Toch zelf wijzigen" | `ui-weekrooster-edit.test.js` |
| `ui-weekrooster-essence.js`, `ui-weekrooster-earlier.js` | A proposal in a few words; what a day already deviates ("Al aangepast voor ...") | `ui-weekrooster-essence.test.js`, `ui-weekrooster-earlier.test.js` |
| `driver-car.js`, `driver-car-data.js`, `ui-driver-car.js` | The driver changes the time and place of the own car ("Tijd en plek"): rules, saving, the sheet | `driver-car.test.js`, `driver-car-data.test.js`, `ui-driver-car.test.js` |
| `ritbeurs.js`, `ritbeurs-data.js`, `ui-ritbeurs.js` | Ruilen (the Ritbeurs): offering a ride, taking it over, "Ik kan inspringen", notifications: rules, database side, the Ruilen tab | `ritbeurs.test.js`, `ritbeurs-data.test.js`, `ui-ritbeurs.test.js` |
| `locations.js` | Pickup/drop-off places per shift, one-off override, map links (Android `geo:`, otherwise Google Maps), AFC/ATC fixed venues (pure functions) | `locations.test.js` |
| `ov.js` | "Terug met OV": take a daughter out of a terug ride and back (pure functions) | `ov.test.js` |
| `distance.js` | Projected distance of away matches: OpenRouteService calls, calculate once, store per match | `distance.test.js` |
| `impact.js` | Impact preview on a deviation (pilot, removable): analysis, on/off switch, save gate | `impact.test.js` |
| `period.js` | "Periode met andere tijden" (holiday, exam week): validation of the Beheer form, the phases waiting/open/closed/over, and the times a family hands in (pure functions) | `period.test.js` |
| `period-backup.js` | Back-ups of one period (settings + handed-in times + temporary rooster): build, check, what changed since, plan the restore (pure functions) | `period-backup.test.js` |
| `family-backup.js` | Back-up / restore of the families as one CSV file: build, read, check, plan the overwrite (pure functions) | `family-backup.test.js` |
| `ride-log.js` | Gereden shifts: the log of rides that took place (one document per shift), counts per family per month / year, the list of rides behind the counts, removing a ride (`removed` on the car: it stays in the log, so it is not logged again, but does not count), CSV export (pure functions) | `ride-log.test.js` |
| `ui-ride-log.js` | The Beheer card "Gereden shifts": month / year view, the rides of one family, all rides by date, remove / restore a ride one by one (bottom sheet to confirm), export buttons | `ui-ride-log.test.js` |
| `ui-period.js` | Periode, parent side: task card, form and "doorgegeven" card in Wijzigen, badge on the Wijzigen tab | `ui-period.test.js` |
| `ui-period-rooster.js` | Periode, Rooster tab: overview for the coordinator, the temporary rooster (third view) and its edits | `ui-period-rooster.test.js` |
| `flex.js` | Flex signup: join a car, drive yourself, sign off, departure time (pure functions) | `flex.test.js` |
| `ui-common.js` | Shared UI pieces: toast, status line, sheets, icons, install card | `ui-common.test.js` |
| `ui-shell.js` | The frame around every screen: header, week line, share button, avatar and the Instellingen sheet behind it | `ui-shell.test.js` |
| `ui-contact.js` | Tap a name, contact that person: the sheet with WhatsApp and Bellen | `ui-contact.test.js` |
| `avatars.js` | The avatar library: a parent picks an icon instead of the initials | `avatars.test.js` |
| `swipe-tabs.js` | Swipe left / right on a phone to go to the next / previous tab | `swipe-tabs.test.js` |
| `ui-schedule.js` | Rooster tab | `ui-schedule.test.js` |
| `ui-overview.js` | Weekoverzicht: the week on one page in the layout of the PDF; opens from Rooster; print / save as PDF | `ui-overview.test.js` |
| `ui-myweek.js` | Mijn week tab | `ui-myweek.test.js` |
| `ui-deviation.js` | Wijzigen tab and the WhatsApp share button | `ui-deviation.test.js` |
| `ui-matches.js` | Wedstrijden tab (violet): matches of the next 29 days, carpool for the first 8 days, estimated cost | `ui-matches.test.js` |
| `match-bus.js` | Away matches by team bus: default per team, bus state of a match, suggested car time, bus times | `match-bus.test.js` |
| `help-nl.js` | Help articles (Dutch, plain language, no secrets or personal data) | `help.test.js` |
| `help.js` | Help search: pure functions, runs in the browser | `help.test.js` |
| `ui-help.js` | The help panel behind the `?` in the header | `ui-help.test.js` |
| `notice.js` | "Melding voor iedereen": validation, when it is visible, the stored document (pure functions) | `notice.test.js` |
| `ui-notice.js` | The thin yellow notice bar at the top (everyone) and the Beheer card with switch, text and optional automatic end | `ui-notice.test.js` |
| `maintenance.js` | Onderhoudsmodus: text cleaning, what a stored document means, who is blocked, the stored document (pure functions) | `maintenance.test.js` |
| `ui-maintenance.js` | Onderhoudsmodus: the full-screen page for users, the reminder bar for the coordinator, the Beheer card | `ui-maintenance.test.js` |
| `ui-beheer.js` | Beheer tab (coordinator only) | `ui-beheer.test.js` |
| `ui-profile.js` | Gate, first-run claim, Mijn gezin, test view as a parent | `ui-profile.test.js` |
| `ui-agenda.js` | Instellingen → Agenda: the family's two calendar links, parents' (rides the family drives) and daughter's (make once, copy, share, add to calendar) | `ui-agenda.test.js` |
| `ui-install-prompt.js` | One-time "put the app on your home screen" sheet, behind a feature toggle that is off at deployment (remove the toggle after the rollout, see the top of the file) | `ui-install-prompt.test.js` |
| `calendar-feed.js` | The rides of one family for the next 3 weeks as calendar events and as an `.ics` file: `feedEvents` (the rides the daughter sits in) and `driverFeedEvents` (the rides the family drives; also used by `cron/agenda.mjs`) | `calendar-feed.test.js` |
| `push-access.js` | **Push-meldingen testen:** who sees the push test screens (`COORDINATOR_ONLY`, one flag). Not the parents' own switch | `push-access.test.js` |
| `push.js` | Push-meldingen, pure rules: the two switches (test `uit` / `test`, live `false` / `true`), which devices are accepted, the queue, who an entry goes to (`routeEntry`, `devicesFor`), what is still to send, what a message says | `push.test.js` |
| `notif-text.js` | The words of a Ritten-ruilen notification (inbox, preview and push server share them) | `notif-text.test.js` |
| `push-scenarios.js` | Push-meldingen testen: the five made-up situations, built with the same functions as the real notifications | `push-scenarios.test.js` |
| `push-data.js` | Push-meldingen: the test switch, this browser's push subscription (as a test device, or as a parent's own phone), the scenarios, the listeners | `push-data.test.js` |
| `ui-push.js` | The Beheer card "Push-meldingen testen" and opening the app from a tapped push (as the right family for a test push, on Ruilen for a real one) | `ui-push.test.js` |
| `ui-push-device.js` | Instellingen → Push-meldingen: a parent switches the real pushes on for this phone | `ui-push-device.test.js` |
| `planning.js` | Planning engine (pure functions, no DOM/Firebase) | `planning.test.js` |
| `schedule-changes.js` | Detects and merges changed arrival/pick-up times | `schedule-changes.test.js` |
| `tests/fake-db.js`, `tests/test-support.js`, `tests/test-clock.js` | Test helpers: fake Firestore, fake page, frozen clock (Wed 30 Sep 2026 10:00) | not tests themselves |
| `run-tests.js`, `tests.lock.json`, `test-count.js` | Test runner, the "module change needs test change" check, and the number of tests (written by `npm run lock`, shown in the help; never edit by hand) | |
| `tests/__snapshots__/` | Saved page output that render tests compare against | |
| `package.json` | The commands: `npm test`, `npm run lock`, `npm run preview`, `npm run build:deploy`, `npm run build:deploy:test`, `npm run build:cron`, `npm run seed:test`. No dependencies | |
| `scripts/` | What those commands run: local preview, building the upload folders (`dist/`, `dist-test/`, `dist-cron/`, never in git), the upload itself (`deploy-rsync.sh`), test data, the robot smoke test, the Firebase SDK copy | `build-deploy.test.js`, `build-cron.test.js`, `deploy-rsync.test.js`, `deploy-test-env.test.js`, `seed-test-data.test.js`, `smoke-test.test.js` |
| `cron/` | The five server jobs on the host (see *Cron jobs on the host*) | `cron-*.test.js` |
| `deploy/` | Extra files for the host: `robots.txt`, the test database config (`deploy/test/firebase-config.js`), the page `uitleg-weekrooster/` | |
| `.github/` | The three workflows (tests, deploy, deploy test), the `CACHE_NAME` check, the pinned identity of the host, Dependabot | |
| `DESIGN.md`, `CLAUDE.md`, `docs/` | The design system, the working rules for this repo, and the notes per feature (`docs/functies/`, see below) plus older audits | `docs.test.js` |
| `firebase-config.js` | Firebase config + Google Calendar API key (fill in once). **No secret keys**: the OpenRouteService key is in the database (Beheer → *API-sleutels*) | never overwrite |
| `firebase-sdk/` | The Firebase SDK (app, auth, firestore), served by the site itself instead of Google's server. Made by `node scripts/vendor-firebase.mjs` (version in that file); never edit by hand. Upgrade: run it with the new version, set `FIREBASE_VERSION`, bump `CACHE_NAME`, put the branch on the test site (the robot checks Chromium and WebKit) | `vendor-firebase.test.js` |
| `firebase/firestore.rules` | Firestore security rules | published by the pipeline (`scripts/publish-rules.mjs`, see *Database rules*). Tested with the Firestore emulator: `firebase/rules-test/*.test.mjs` (not part of `npm test`; run in CI by `rules-tests.yml`, by hand as described at the top of each file; `firebase/firebase.json` is the emulator's config) |
| `manifest.json`, `service-worker.js`, `icon-*.png`, `apple-touch-icon.png`, `favicon-32.png`, `icon.svg` (AZ Carpool logo) | PWA (install on home screen) | once; `service-worker.js` changes when modules are added |
| `backups/` | Only on the owner's computer, never in git (`.gitignore`): database back-ups and the test key for `npm run seed:test` | never on the site |

All `*.test.js` files live in `tests/`; the site does not use that folder. Every other file stays in the repo root because the live site loads it from there.

The tests never touch the real Firebase. They run against `fake-db.js`, an in-memory Firestore that the app cannot tell apart from the real one.

## Feature notes (how each part works and why)

The detailed notes per feature live in `docs/functies/`, moved there unchanged from this file (2026-11-14). Code comments that say "see README, *section*" mean the section named in the last column.

| Feature | File | Section name(s) as they were in this README |
|---|---|---|
| Ruilen (ritten overnemen) | [`docs/functies/ruilen.md`](docs/functies/ruilen.md) | *Ruilen (ritten overnemen; vroeger "Vervanger" / "Ritten ruilen" / "Ritbeurs")* |
| Afwijkend weekrooster | [`docs/functies/afwijkend-weekrooster.md`](docs/functies/afwijkend-weekrooster.md) | *Afwijkend weekrooster (aanvragen, advies, akkoord)* |
| Dagcoördinator, conclusie-appje, 1-op-1, Flex | [`docs/functies/dagcoordinator-en-flex.md`](docs/functies/dagcoordinator-en-flex.md) | *Day coordinator, conclusie-appje, 1-op-1, Flex* |
| Periode met andere tijden | [`docs/functies/periode-andere-tijden.md`](docs/functies/periode-andere-tijden.md) | *Periode met andere tijden (holiday, exam week)* |
| Melding voor iedereen en onderhoudsmodus | [`docs/functies/melding-en-onderhoud.md`](docs/functies/melding-en-onderhoud.md) | *Melding voor iedereen (notice bar)* · *Onderhoudsmodus (app temporarily closed)* |
| Wedstrijden-tab | [`docs/functies/wedstrijden.md`](docs/functies/wedstrijden.md) | *Wedstrijden tab* |
| Ritplekken, Terug met OV, afstand, impact, route | [`docs/functies/ritplekken-afstand-route.md`](docs/functies/ritplekken-afstand-route.md) | *Ritplekken, Terug met OV, afstand, impact-preview, route (US-15, 06, 21, 07, 22)* |
| Help | [`docs/functies/help.md`](docs/functies/help.md) | *Help ("?" in the header)* |
| Push-meldingen (test en live) | [`docs/functies/push-meldingen.md`](docs/functies/push-meldingen.md) | *Push-meldingen (test en live)* |
| Inloggen (gate) en het foutlogboek | [`docs/functies/inloggen-en-foutlogboek.md`](docs/functies/inloggen-en-foutlogboek.md) | *Inloggen (gate) and the error log (v88)* |
| Planningslogica, reads en quota | [`docs/functies/planningslogica.md`](docs/functies/planningslogica.md) | *Planningslogica (standard rooster and period rooster)* |

## Run the tests

    npm test

It prints one line per test file (PASS/FAIL with counts), then a rule check, then a total. It exits with an error if anything fails. Tests need Node 20 or newer (GitHub runs them on Node 22) and no other packages.

**`rsync` must be installed**, otherwise 9 upload tests are skipped (`deploy-rsync.test.js`, `deploy-test-env.test.js`) and the count in `test-count.js` comes out 9 lower than on GitHub, which then fails. A Mac has it; in a fresh cloud session run `apt-get update && apt-get install -y rsync` first.

Besides the test file per module there are tests for the whole: `planning-scenarios.test.js`, `design-rules.test.js` (the design rules), `docs.test.js` (this README stays a map), `service-worker.test.js`, and the tests of the scripts and cron jobs.

### The rule: a module change needs a test change
`tests.lock.json` remembers the version of every module and its test file at the last green run. When a module changed but its test file did not, `npm test` fails and names the module. So every module change comes with a new or updated test in the module's own test file. After a green run, record the new baseline:

    npm run lock

Commit `tests.lock.json` together with the change.

### Render tests (snapshots)
Some tests compare the generated page with a saved copy in `tests/__snapshots__/`. If you change the look on purpose, refresh the copies with `UPDATE_SNAPSHOTS=1 npm test`, read the diff, and keep it only if it is what you intended.

## Try it on your own computer

    npm run preview

Then open `http://localhost:8777/` (it opens nothing by itself). It runs this checkout, whatever branch, with the TEST database (`az-carpool-test`), never the live one, and shows the TESTOMGEVING bar.

## Texts and languages
Every on-screen text and message is in `texts-nl.js`, as `key: 'text with {placeholders}'`. Code calls `t('key', { name: 'x' })`. Static texts in `index.html` use `data-i18n="key"` attributes. To add a language, copy `texts-nl.js` to `texts-<lang>.js`, translate the values (keep keys and `{placeholders}`), and switch the dictionary in `i18n.js`. Many texts use generic placeholders such as `{p1}`. Look at the Dutch sentence to see what each one is.

## Deploy
Live is `https://azcarpool.nl/` on mijn.host. Nobody uploads files by hand any more.

**Why the code still says `mveen.github.io`:** `index.html` and `app.js` load their modules from the fixed address `https://mveen.github.io/AZ-Carpool/`. That is only a placeholder now: the build (`scripts/build-deploy.mjs`) writes a copy in `dist/` in which every such address is replaced by `https://azcarpool.nl/` (or the test site), and only that copy is uploaded. So never open the repo's own `index.html` directly; use `npm run preview`.

1. Work on a branch and open a pull request. `.github/workflows/tests.yml` runs `npm test` and checks that `CACHE_NAME` in `service-worker.js` was raised (`.github/scripts/check-cache-bump.sh`).
2. The owner merges the pull request into `main`. Nothing reaches `main` without the owner.
3. `.github/workflows/deploy.yml` then runs by itself: *tests -> upload to `test.azcarpool.nl` -> robot smoke test there -> upload to live -> upload the cron jobs and their self-test*. If a step fails, everything after it is skipped and live stays as it was. The workflow checks that the site serves the new `CACHE_NAME`.
4. **Database rules go live by themselves** once the two rules keys are set (see *Database rules* below): the pipeline publishes `firebase/firestore.rules` to the test database before the test upload and to the live database before the live upload, only when they differ. Until a key is set, that step is skipped with a notice and the rules must still be pasted into the Firebase console (Firestore -> Rules -> Publish).
5. **Always bump `CACHE_NAME` in `service-worker.js` (and `APP_VERSION` in `constants.js`) on every change to app files.** Open apps (phone, home screen) check for a changed `service-worker.js` each time they come to the foreground (tab switch, back from another app) and reload themselves once when a new one takes over. No change to that file means no automatic update.
6. Secrets (API keys, service account keys, the deploy key) are never in the repo: the OpenRouteService key is in the database (Beheer -> *API-sleutels*), the cron keys are on the host, the deploy key and smoke-test codes are GitHub secrets.

The old address `https://mveen.github.io/AZ-Carpool/` (GitHub Pages) is still switched on in the repo settings and published from `main` by GitHub itself, outside the deploy workflow. Since v253 it only forwards to `https://azcarpool.nl/` (first script in `index.html`); nobody uses the app there. Switching it off (GitHub -> Settings -> Pages) is safe for the live site: the build does not need it.

### Test environment (`test.azcarpool.nl`)
A second copy of the app with its own database, so trying things never touches live data.
- **Own database:** a separate Firebase project (not `az-carpool`). Its public config goes in `deploy/test/firebase-config.js`; the build refuses the placeholder (`VUL-IN`) and refuses the live project. Same `firebase/firestore.rules` as live (paste them in the test project), anonymous sign-in on.
- **Build:** `npm run build:deploy:test` writes `dist-test/`: test config instead of `firebase-config.js`, every link points to `https://test.azcarpool.nl/`, a dark "TESTOMGEVING" bar on top of every screen, tab title `TEST – …`, installed name "AZ Carpool TEST". A live build is byte-for-byte what it was (plus a `.deploy-target` marker that is never uploaded).
- **Deploy:** GitHub -> Actions -> *Deploy test.azcarpool.nl* -> Run workflow -> pick the branch. It runs `npm test` first, uploads only to `domains/test.azcarpool.nl/public_html/` (`deploy-rsync.sh` refuses any other folder for a test build, and the test folder for a live build), and fails when the test site would use the live database. Same two secrets as the live deploy. Only by hand: merging to `main` never touches the test site.
- **Test data:** `npm run seed:test -- --backup backups/firestore-DATE.jsonl.gz` shows what would be copied (dry run, no key needed). Add `--key backups/test-key.json --write` to empty the test database and fill it with a copy of the live data from that nightly back-up: same families, rooster, selection order, day coordinators and settings; every phone number replaced by one test number; every family gets a NEW invite code (list in `backups/test-toegangscodes.csv`); left out: history (ride log), links, sessions, calendar links, push data, the API key, the live notice and maintenance switch. It checks that no old code, token, key or other phone number is left, and refuses any key that is not of the project `az-carpool-test`. Get a fresh back-up first: `ssh ... "bash azcarpool-cron/run.sh backup"`, then `scp` the file into `backups/` (the folder is in `.gitignore`; the key file never goes to GitHub).
- **No cron jobs on test** (push, agenda links, back-up, purge and match calendar cache do not run there; the app fetches match calendars itself). Add a test copy of them only when a test needs it.
- Add `https://test.azcarpool.nl/*` to the allowed referrers of the Google Calendar API key.
- **Automatic pipeline (every merge to `main`):** `.github/workflows/deploy.yml` runs *tests -> deploy to test -> smoke test -> deploy to live*. The smoke test (`scripts/smoke-test.mjs`, headless Chromium and WebKit, the engine of Safari on the iPhone; it also runs after every *Deploy test.azcarpool.nl* by hand) opens `https://test.azcarpool.nl`, logs in as the coordinator and as a parent, opens every tab and fails on any console error, failed request, empty tab or missing service worker. Red = the live job is skipped, live stays as it was; fix it with a new PR. Emergency only: Actions -> *Deploy azcarpool.nl* -> Run workflow -> tick `skip_smoke`. The smoke test refuses any address except the test site.
  - **GitHub secrets for the smoke test** (Settings -> Secrets and variables -> Actions): `SMOKE_PHONE` (the test phone number), `SMOKE_CODE_COORD` (access code of the coordinator's family in the test database) and `SMOKE_CODE_PARENT` (code of an ordinary family). Test-database codes only, no live data.
- **Refresh only the planning (`--planning`):** `npm run seed:test -- --planning --backup backups/firestore-DATE.jsonl.gz` (dry run) and add `--key backups/test-key.json --write` to apply. Test users stay as they are (phone numbers, invite codes, links, sessions, `config/coordinator`: nobody logs in again). The old inbox notifications of the test families are removed (live notifications are never copied, so what is there belongs to the old test planning). Replaced: shifts (`groups`), `deviations`, `weekRequests` (requests with their status), `periods`, `periodEntries`, `periodCars`, `periodBackups`, `offers`, `matchCarpools`, `practiceMatches`, `backupMoments` and every `settings/` document that the full copy also takes (not the API key, push, notice or maintenance). Per family only `availability`, `schedule` (the daughter's times) and `timeChanges` are updated. A family that exists in live but not in test is reported and skipped. Same checks and the same fixed test project as the full copy.
  - **Re-seeding keeps these codes** with `--fixed-code`: `npm run seed:test -- --backup ... --key ... --write --fixed-code eline=CODE --fixed-code evi=CODE`. Each smoke run creates a `links/` document in the test database (harmless).
  - By hand: `SMOKE_PHONE=... SMOKE_CODE_COORD=... SMOKE_CODE_PARENT=... node scripts/smoke-test.mjs` (needs `npm i --no-save playwright` and `npx playwright install chromium webkit`; `SMOKE_BROWSERS=chromium` runs one browser only).

### Database rules (`firebase/firestore.rules`)
`scripts/publish-rules.mjs` compares the file with what is live and publishes it through Google's Firebase Rules API (no libraries). The repo is the truth: what is in `main` is what goes live.
- **In the pipeline:** `deploy.yml` publishes to `az-carpool-test` in the *deploy-test* job (so the robot tries the app and the rules together) and to `az-carpool` in the *deploy-live* job (only after a green robot). Google must accept the rules first; rules that do not compile are never published. The previous rules stay in the Firebase console (Rules -> history) to put back by hand.
- **By hand:** Actions -> *Databaseregels* -> Run workflow: *vergelijken* (changes nothing, shows the lines that differ) or *publiceren*, for *test* or *live*.
- **Keys (once per project, GitHub secrets `RULES_KEY_TEST` and `RULES_KEY_LIVE`):** in the Google Cloud console of that project: IAM & Admin -> Service accounts -> Create service account (name `rules-publisher`) -> role **Firebase Rules Admin** (nothing else) -> open the account -> Keys -> Add key -> JSON. Put the whole content of the downloaded file in the GitHub secret (repo Settings -> Secrets and variables -> Actions) and delete the file. A key only works for its own project: the script refuses a test key for live and the other way round.
- **Rules tests:** `firebase/rules-test/*.test.mjs` run against Google's Firestore emulator in `.github/workflows/rules-tests.yml`, on every pull request that touches `firebase/` (and by hand). They are not part of `npm test` (they need Java and the emulator).

### Cron jobs on the host (`cron/`)
Five jobs run on the mijn.host account (the code is outside the web folder; only the calendar files of the agenda job are written inside it). The fifth is the push job (`run.sh push`): see [`docs/functies/push-meldingen.md`](docs/functies/push-meldingen.md). The deploy workflow uploads `cron/` (plus a generated `config.json` with the public project id and Calendar key) to `~/azcarpool-cron/` and runs `run.sh selftest` there; it fails when the host has no Node.js 20+ or an uploaded key does not log in.
- **Back-up** (`bash ~/azcarpool-cron/run.sh backup`, nightly): reads the whole database and writes `~/azcarpool-data/backups/firestore-YYYY-MM-DD.jsonl.gz` (Firestore's own format, one document per line, mode 600). Keeps the last 30 and the 1st of each month for a year. Needs the key `~/azcarpool-secrets/backup-key.json` of a service account with the role *Cloud Datastore Viewer* (read only).
- **Match calendars** (`bash ~/azcarpool-cron/run.sh matches`, daily early morning): does what the first member of the day does in the app (`loadAllMatches` in `matches.js`) and writes `settings/matchCache`. The app then finds a cache from today and fetches nothing itself; if the job is down, the app still fetches by itself. A calendar that fails keeps its earlier matches and the cache is marked partial. Needs `~/azcarpool-secrets/calendar-key.json` (role *Cloud Datastore User*). A test compares its output with the app's.
- **Purge** (`bash ~/azcarpool-cron/run.sh purge`, Friday 19:05): the weekly clean-up that the app used to do by itself when the first member opened it after the week had ended. **The week ends on Friday at 19:00** (`WEEK_END_HOUR` in `constants.js`): from then on the whole app (Rooster, Wijzigen, Mijn week, the calendar feed) shows the coming week, and a new one-off change expires at 19:00 on the Friday of its week (`deviationExpiryMs` in `dates.js`). (1) It logs the rides that were driven (`rideLog/`) with the same app code as the Beheer overview (`rides.js` + `ride-log.js`, copied by the build to `~/azcarpool-cron/app/`; it only holds what those need, no screens), so a ride that ran on a one-off change is counted even if the coordinator never opened the app. (0, first and on its own) It deletes error-log entries (`errorLog/`) older than 30 days. (2) It deletes the changes (`deviations/`) of an older week whose own `expiresAt` has passed, each one only in the version it read (a change that was edited in the meantime stays). If logging fails nothing is deleted. It always counts in Amsterdam time, whatever time zone the host is in, and it is safe to run again at any time. The app keeps its own purge as a safety net, so nothing breaks when this job is down. Uses the same key as the match calendars (`calendar-key.json`, role *Cloud Datastore User*). In DirectAdmin: `5 19 * * 5  bash ~/azcarpool-cron/run.sh purge > /dev/null`. **Keep the old line `5 0 * * 6` as well** (Saturday 00:05, a catch-up): changes made before v90 still carry the old expiry (Saturday 00:00), and the job is safe to run twice. The cron time is the time zone of the host; the job itself always counts in Amsterdam time, so check with `date` over SSH that the host is on Amsterdam time, or the job runs at the wrong hour (it then still works, just later or earlier).
- **Agenda** (`bash ~/azcarpool-cron/run.sh agenda`, cron line every 30 minutes, but the job itself runs at most once an hour and not between 00:00 and 06:00 Amsterdam time: `cron/lib/run-window.mjs`, last run in `~/azcarpool-data/agenda.lastrun`; it first reads about 11 small documents (the two last-update stamps and the two link collections) and only does the full read of 9 collections when they changed, the day or the planning week changed, or the last full run is 3 hours ago: `agendaSignature` / `needsFullRun`, state in `~/azcarpool-data/agenda.state.json`; reads count against the free-plan quota): the calendar subscriptions of each family. A family has two links, so for every link it writes `~/domains/azcarpool.nl/public_html/agenda/<secret>.ics` with the next 3 weeks (planning week plus two; from Friday 19:00 on the coming week is the first) of either the rides of the daughter (*Agenda van {dochter}*) or the rides the family drives (*Mijn agenda*, named *Carpool rijden {ouder}*): heen/terug with departure time, route with pickup place and arrival (AFC '34 or ATC) from the rooster, driver, and the time she has to be there / is done. The parents' file names the girls in the car (the family's own daughter too, so her own ride is in both files; a girl with *Rijdt niet mee* is left out, and a car with nobody left is no ride) and the time the first girl has to be there. Matches only when she is in a car of that match (parents' file: when the family drives a car with girls in it). It asks the SAME code as Mijn week (`calendar-feed.js` + `rides.js`, copied by the build to `app/`), so one-off changes, "Rijdt niet mee", the temporary rooster of a period and the standard rooster are all handled as in the app. Times are Amsterdam time, written as UTC. A file whose rides did not change is not rewritten (the time stamp alone is no change); the file of a link that was removed is deleted; a half-written file is never served (temporary file, then rename). It also keeps an `.htaccess` in that folder (calendar content type, no directory listing, no search engines, every rule guarded by `IfModule`). Uses the same key as the match calendars and the purge (`calendar-key.json`, *Cloud Datastore User*). In DirectAdmin: `*/30 * * * *  bash ~/azcarpool-cron/run.sh agenda > /dev/null`. **The web deploy (`deploy-rsync.sh`) excludes `/agenda/`**, otherwise its clean-up would delete the calendar files.
  - **The links** are `https://azcarpool.nl/agenda/<secret>.ics`, two per family: the daughter's calendar (secret in `calendarTokens/<familyId>`, the link that existed before) and the parents' calendar (secret in the new collection `driverCalendarTokens/<familyId>`). Each secret (32 URL-safe characters, 192 bits) is made by the app the first time a family opens Instellingen → Agenda (`ui-agenda.js`, `calendar-feed.js newCalendarToken`); a family that already had the daughter's link keeps it unchanged and only gets the new one. Both documents are `{ token, createdAt }`. The Agenda sheet shows *Mijn agenda* (add to calendar, copy) above *Agenda van {dochter}* (share with her where the phone can share, copy). The job treats both kinds of secret as file names: a secret used twice (over both kinds) is ignored with a warning. Only that family and the coordinator can read it. **There is no "new link"**: `firestore.rules` allows creating it once and no update; only the coordinator can delete a document (in the Firebase console), after which the app makes a new secret the next time that family opens the card. The job accepts only 32 characters from `A-Za-z0-9_-` as a file name (the same rule is in `firestore.rules`), ignores two families with the same secret and ignores a family that no longer exists.
  - **Privacy:** the daughter's file holds her first name, times, places and the driver's name; the parents' file holds the first names of the girls in the cars the family drives, times and places; whoever has a link can read it. Help ("Hoe zie ik de ritten van mijn dochter in mijn eigen agenda?" and the privacy / services articles) says so. Calendar apps fetch the file themselves: Apple about every hour (the file asks for it), Google about once a day.
  - **The rules for `calendarTokens` and `driverCalendarTokens` must be in the Firebase console** (Rules), otherwise the card shows "De agenda-link kon niet geladen worden". Tests: `calendar-feed.test.js`, `cron-agenda.test.js`, `ui-agenda.test.js`; the rules are tested with the Firestore emulator (`firebase/rules-test/agenda-rules.test.mjs`).
- The keys are never in git or GitHub: they are put on the host by hand (folder 700, files 600). Output: one line on success, errors on stderr with exit code 1 (cron mails them). In DirectAdmin use `bash ~/azcarpool-cron/run.sh backup > /dev/null` so only errors are mailed.
- Changes to `cron/` do not need a `CACHE_NAME` bump (the app is not changed).

## Rollback
1. On GitHub open the pull request that caused the problem and press *Revert*; merge the revert pull request. The deploy workflow puts the previous version live (tests, test site and smoke test included). Raise `CACHE_NAME` in the revert, otherwise phones keep the broken version.
2. In an emergency: Actions -> *Deploy azcarpool.nl* -> *Run workflow* with *skip_smoke* ticked goes live without the robot test.
3. The tag `v1-stable` is the app before the v2 redesign (last resort).

## Access model (since the Sept 2026 security fix)
- Only **members** can read or write data: the coordinator, or a browser linked to a family through the gate.
- The gate (phone number + invite code) is enforced by `firestore.rules`, not just in the browser.
- Invite codes live in the `invites` collection (doc id = the code). They are not on the family doc, and only the coordinator can list them.
- Families store `phoneKeys` (normalised phone numbers) for the gate check.

