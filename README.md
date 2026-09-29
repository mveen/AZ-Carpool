# AZ Carpool Aalsmeer–Alkmaar

Mobile-friendly carpool scheduler for AZ youth football parents. Static site (GitHub Pages) + Firebase Firestore.

Since the modularisation, `index.html` is only a thin page: the app itself lives in the `.js` modules below. Every module has its own test file, and `npm test` runs them all.

## Files

| File | Purpose | Test file |
|---|---|---|
| `index.html` | Page shell, styles, and the start-up script that connects Firebase and starts the app | covered by the manual smoke test (see below) |
| `app.js` | Start-up, tab switching, default tab, week rollover, `renderAll` | `app.test.js` |
| `state.js` | The one shared app state object `S` | `state.test.js` |
| `constants.js` | Days, direction texts, app URL, icons | `constants.test.js` |
| `i18n.js` | `t(key, params)` and `applyStaticTexts()` | `i18n.test.js` |
| `texts-nl.js` | All Dutch texts and messages (the translation file) | `i18n.test.js` |
| `dates.js` | Week keys, planning date, day labels, expiry times | `dates.test.js` |
| `rides.js` | Ride assignment logic: who drives whom (pure functions) | `rides.test.js` |
| `coordinator.js` | Coordinator/member rules, invite codes, phone numbers, day coordinator lookup (pure functions) | `coordinator.test.js` |
| `matches.js` | Match calendar events and match carpools | `matches.test.js` |
| `data.js` | All Firestore access (through an adapter), listeners, saving | `data.test.js` (fake database only) |
| `message-texts.js` | WhatsApp and other messages, built from data, incl. the conclusie-appje (pure functions) | `message-texts.test.js` |
| `day-changes.js` | What changed on one day compared with the standard rooster (pure functions) | `day-changes.test.js` |
| `locations.js` | Pickup/drop-off places per shift, one-off override, map links (Android `geo:`, otherwise Google Maps), AFC/ATC fixed venues (pure functions) | `locations.test.js` |
| `ov.js` | "Terug met OV": take a daughter out of a terug ride and back (pure functions) | `ov.test.js` |
| `distance.js` | Projected distance of away matches: OpenRouteService calls, calculate once, store per match | `distance.test.js` |
| `impact.js` | Impact preview on a deviation (pilot, removable): analysis, on/off switch, save gate | `impact.test.js` |
| `flex.js` | Flex signup: join a car, drive yourself, sign off, departure time (pure functions) | `flex.test.js` |
| `ui-common.js` | Shared UI pieces: toast, status line, sheets, icons, install card | `ui-common.test.js` |
| `ui-schedule.js` | Rooster tab | `ui-schedule.test.js` |
| `ui-myweek.js` | Mijn week tab | `ui-myweek.test.js` |
| `ui-deviation.js` | Wijzigen tab and the WhatsApp share button | `ui-deviation.test.js` |
| `ui-beheer.js` | Beheer tab (coordinator only) | `ui-beheer.test.js` |
| `ui-profile.js` | Gate, first-run claim, Mijn gezin, test view as a parent | `ui-profile.test.js` |
| `planning.js` | Planning engine (pure functions, no DOM/Firebase) | `planning.test.js` |
| `schedule-changes.js` | Detects and merges changed arrival/pick-up times | `schedule-changes.test.js` |
| `fake-db.js`, `test-support.js`, `test-clock.js` | Test helpers: fake Firestore, fake page, frozen clock (Wed 30 Sep 2026 10:00) | not tests themselves |
| `run-tests.js`, `tests.lock.json` | Test runner and the "module change needs test change" check | |
| `__snapshots__/` | Saved page output that render tests compare against | |
| `package.json` | `npm test`, `npm run lock` | |
| `firebase-config.js` | Firebase config + Google Calendar API key (fill in once) | never overwrite |
| `firestore.rules` | Firestore security rules | paste into Firebase console → Rules |
| `manifest.json`, `service-worker.js`, `icon-192.png`, `icon-512.png` | PWA (install on home screen) | once; `service-worker.js` changes when modules are added |
| `backups/` | Older versions for rollback | not needed on the site |

The tests never touch the real Firebase. They run against `fake-db.js`, an in-memory Firestore that the app cannot tell apart from the real one.

## Run the tests

    npm test

It prints one line per test file (PASS/FAIL with counts), then a rule check, then a total. It exits with an error if anything fails. Tests need Node 18 or newer and no other packages.

### The rule: a module change needs a test change
`tests.lock.json` remembers the version of every module and its test file at the last green run. When a module changed but its test file did not, `npm test` fails and names the module. So every module change comes with a new or updated test in the module's own test file. After a green run, record the new baseline:

    npm run lock

Commit `tests.lock.json` together with the change.

### Render tests (snapshots)
Some tests compare the generated page with a saved copy in `__snapshots__/`. If you change the look on purpose, refresh the copies with `UPDATE_SNAPSHOTS=1 npm test`, read the diff, and keep it only if it is what you intended.

## Day coordinator, conclusie-appje, 1-op-1, Flex
- **Dagcoördinator (Beheer).** Beheer → *Dagcoördinatoren*: pick one family per weekday. It is stored as family ids in `settings/dayCoordinators`, so name and phone number always come from the family, never from the code. Rooster and Mijn week show the coordinator of the NEXT day, because changes are purged at midnight: Mon–Thu "Dagcoördinator morgen: <naam>", Fri nothing, Sat/Sun "Dagcoördinator maandag: <naam>" (plus a WhatsApp button; nothing when no one is set).
- **Conclusie-appje (Wijzigen).** Bottom of every day: a drafted text ("<Dag>: volgens schema" + Mijn week link, or the changes first — Rijdt niet mee heen/terug, Gewijzigde chauffeur/tijd, Rijdt ook mee heen/terug, empty kinds left out — followed by the full schedule of the day). The button opens WhatsApp with the text filled in; nobody is messaged automatically. The card is highlighted for that day's coordinator; every parent can use it.
- **1-op-1 afstemmen (Wijzigen).** Each driver in a direction gets a WhatsApp button with a prefilled question, plus the hint "Stem 1-op-1 af, de dagcoördinator deelt het besluit."
- **Flex.** Beheer → Wijzig gezin → *Type gezin*: Vast or Flex. Flex families are never in the auto-planned rooster (not as passenger, not as driver, no "niet ingedeeld" alerts). A Flex parent (or the coordinator) signs up per day and direction in Wijzigen: with a time, as passenger in a car with a free seat, or driving herself. This is stored as a normal deviation, so it expires with the week. A Flex driver is shown as "speelster-chauffeur". No change to `firestore.rules` was needed.

## Ritplekken, Terug met OV, afstand, impact-preview, route (US-15, 06, 21, 07, 22)
- **Plekken (US-15).** Beheer → *Ophaal- en afzetplekken*: three places (Busstation, A4-De Hoek, De Parel) with exact address, the destination in Alkmaar (default AFC '34), the default place for heen and for terug. Stored in `settings/locations`. Every ride shows "07:05 Busstation → AFC '34" in Rooster and Mijn week (text only, no map button). Wijzigen has a per-car *Plek (eenmalig)* choice; it is stored on the car of that week's deviation (`locationId`) and expires with the week.
- **Terug met OV (US-06).** Mijn week, terug ride of an upcoming day: button *Terug met OV* (no reason). The girl leaves her terug car (departure time recalculated), is not counted as "niet ingepland", and the conclusie-appje says "<naam> terug met OV". Stored on that day's `_terug` deviation as `ovGirlIds` (+ `ovFrom`, the driver whose car she left, used to put her back with *Toch met de auto*). Expires with the week.
- **Afstand uitwedstrijden (US-21).** Start: address of *Busstation* (Beheer; without address "Busstation Aalsmeer, Aalsmeer, Nederland"), destination: the calendar location of the match. OpenRouteService (free) geocodes both and gives the fastest car route; the result is stored once per match in `settings/matchDistances` (recalculated only when the calendar location changes). No location or not found: "locatie onbekend". Locations containing AFC or ATC use the fixed km set in Beheer (*Vaste afstand*) and are never calculated. **Setup:** get a free key at openrouteservice.org and put it in `firebase-config.js` as `openRouteServiceApiKey` (see the file). Without the key the feature stays silent. **Publish `firestore.rules`** (new rule for `settings/matchDistances`).
- **Impact-preview (US-07, pilot).** Beheer → *Impact-preview (pilot)*, off by default. On: before a change in Wijzigen is saved a sheet shows one of "Scheelt een auto", "Geen effect", "Extra plek nodig → voorstel: <chauffeur>", "Geen oplossing → back-up <naam>" (or "Geen oplossing en geen back-up beschikbaar"), with *Opslaan* / *Annuleren*. Nothing about the preview is stored; the switch itself is `settings/features` and is deleted when switched off. **Remove after the pilot:** delete `impact.js` and `impact.test.js`, the line in `data.js` `saveDeviationCars` that calls `impactGate`, and in `ui-beheer.js` the `impactCardHtml()` line and the `wireImpactCard(renderBeheer)` line (plus the two imports), then `npm run lock`.
- **Route naar wedstrijd (US-22).** In Mijn week the match location is a link: on Android a generic `geo:0,0?q=<location>` (opens the user's maps app), on iPhone and laptop a Google Maps search URL (`google.com/maps/search/?api=1&query=`). The route starts from the current GPS position, not from the busstation.

## Texts and languages
Every on-screen text and message is in `texts-nl.js`, as `key: 'text with {placeholders}'`. Code calls `t('key', { name: 'x' })`. Static texts in `index.html` use `data-i18n="key"` attributes. To add a language, copy `texts-nl.js` to `texts-<lang>.js`, translate the values (keep keys and `{placeholders}`), and switch the dictionary in `i18n.js`. Many texts use generic placeholders such as `{p1}`. Look at the Dutch sentence to see what each one is.

## Deploy
1. Upload all changed files to the GitHub repo (`main`). Upload `index.html`, `service-worker.js`, and every new or changed `.js` file (new in this release: `locations.js`, `ov.js`, `distance.js`, `impact.js`; also add the `openRouteServiceApiKey` line to your live `firebase-config.js`, and publish `firestore.rules`). Test files are optional (the site does not use them).
2. GitHub Pages redeploys in about 60 seconds.
3. If `firestore.rules` changed, paste it into the Firebase console (Firestore → Rules → Publish).
4. Open the app once online. The service worker (cache `az-carpool-v5`) then replaces the old cache.

### Manual smoke test on a phone (before every go-live)
Automated tests cover logic and page output, but not a real phone, real Firebase, or the real WhatsApp app. Check these on a mobile browser:
1. Open the app and log in (parent through the gate, or coordinator).
2. Open Rooster: rides for the week show, no error banner.
3. Open Wijzigen and report a deviation. Save it and see it in Rooster.
4. Press "Deel update via WhatsApp". WhatsApp opens with the message ready. Do not send it if this is only a test.

## Rollback
1. Upload `backups/index.before-modularisation.html` to GitHub as `index.html`.
2. Upload `backups/service-worker.before-modularisation.js` as `service-worker.js`.
3. Wait about 60 seconds. The old single-file app is back. The new module files can stay in the repo; the old page does not load them.

## Access model (since the Sept 2026 security fix)
- Only **members** can read or write data: the coordinator, or a browser linked to a family through the gate.
- The gate (phone number + invite code) is enforced by `firestore.rules`, not just in the browser.
- Invite codes live in the `invites` collection (doc id = the code). They are not on the family doc, and only the coordinator can list them.
- Families store `phoneKeys` (normalised phone numbers) for the gate check.
