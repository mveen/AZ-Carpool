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
| `period.js` | "Periode met andere tijden" (holiday, exam week): validation of the Beheer form, the phases waiting/open/closed/over, and the times a family hands in (pure functions) | `period.test.js` |
| `period-backup.js` | Back-ups of one period (settings + handed-in times + temporary rooster): build, check, what changed since, plan the restore (pure functions) | `period-backup.test.js` |
| `family-backup.js` | Back-up / restore of the families as one CSV file: build, read, check, plan the overwrite (pure functions) | `family-backup.test.js` |
| `ride-log.js` | Gereden shifts: the log of rides that took place (one document per shift), counts per family per month / year, the list of rides behind the counts, removing a ride (`removed` on the car: it stays in the log, so it is not logged again, but does not count), CSV export (pure functions) | `ride-log.test.js` |
| `ui-ride-log.js` | The Beheer card "Gereden shifts": month / year view, the rides of one family, all rides by date, remove / restore a ride one by one (bottom sheet to confirm), export buttons | `ui-ride-log.test.js` |
| `ui-period.js` | Periode, parent side: task card, form and "doorgegeven" card in Wijzigen, badge on the Wijzigen tab | `ui-period.test.js` |
| `ui-period-rooster.js` | Periode, Rooster tab: overview for the coordinator, the temporary rooster (third view) and its edits | `ui-period-rooster.test.js` |
| `flex.js` | Flex signup: join a car, drive yourself, sign off, departure time (pure functions) | `flex.test.js` |
| `ui-common.js` | Shared UI pieces: toast, status line, sheets, icons, install card | `ui-common.test.js` |
| `ui-schedule.js` | Rooster tab | `ui-schedule.test.js` |
| `ui-overview.js` | Weekoverzicht: the week on one page in the layout of the PDF; opens from Rooster; print / save as PDF | `ui-overview.test.js` |
| `ui-myweek.js` | Mijn week tab | `ui-myweek.test.js` |
| `ui-deviation.js` | Wijzigen tab and the WhatsApp share button | `ui-deviation.test.js` |
| `ui-matches.js` | Wedstrijden tab (violet): matches of the next 29 days, carpool for the first 8 days, estimated cost | `ui-matches.test.js` |
| `help-nl.js` | Help articles (Dutch, plain language, no secrets or personal data) | `help.test.js` |
| `help.js` | Help search: pure functions, runs in the browser | `help.test.js` |
| `ui-help.js` | The help panel behind the `?` in the header | `ui-help.test.js` |
| `notice.js` | "Melding voor iedereen": validation, when it is visible, the stored document (pure functions) | `notice.test.js` |
| `ui-notice.js` | The thin yellow notice bar at the top (everyone) and the Beheer card with switch, text and optional automatic end | `ui-notice.test.js` |
| `maintenance.js` | Onderhoudsmodus: text cleaning, what a stored document means, who is blocked, the stored document (pure functions) | `maintenance.test.js` |
| `ui-maintenance.js` | Onderhoudsmodus: the full-screen page for users, the reminder bar for the coordinator, the Beheer card | `ui-maintenance.test.js` |
| `ui-beheer.js` | Beheer tab (coordinator only) | `ui-beheer.test.js` |
| `ui-profile.js` | Gate, first-run claim, Mijn gezin, test view as a parent | `ui-profile.test.js` |
| `planning.js` | Planning engine (pure functions, no DOM/Firebase) | `planning.test.js` |
| `schedule-changes.js` | Detects and merges changed arrival/pick-up times | `schedule-changes.test.js` |
| `tests/fake-db.js`, `tests/test-support.js`, `tests/test-clock.js` | Test helpers: fake Firestore, fake page, frozen clock (Wed 30 Sep 2026 10:00) | not tests themselves |
| `run-tests.js`, `tests.lock.json` | Test runner and the "module change needs test change" check | |
| `tests/__snapshots__/` | Saved page output that render tests compare against | |
| `package.json` | `npm test`, `npm run lock` | |
| `firebase-config.js` | Firebase config + Google Calendar API key (fill in once). **No secret keys**: the OpenRouteService key is in the database (Beheer → *API-sleutels*) | never overwrite |
| `firebase/firestore.rules` | Firestore security rules | paste into Firebase console → Rules |
| `manifest.json`, `service-worker.js`, `icon-*.png`, `apple-touch-icon.png`, `favicon-32.png`, `icon.svg` (AZ Carpool logo) | PWA (install on home screen) | once; `service-worker.js` changes when modules are added |
| `backups/` | Older versions for rollback | not needed on the site |

All `*.test.js` files live in `tests/`; the site does not use that folder. Every other file stays in the repo root because the live site loads it from there.

The tests never touch the real Firebase. They run against `fake-db.js`, an in-memory Firestore that the app cannot tell apart from the real one.

## Run the tests

    npm test

It prints one line per test file (PASS/FAIL with counts), then a rule check, then a total. It exits with an error if anything fails. Tests need Node 18 or newer and no other packages.

### The rule: a module change needs a test change
`tests.lock.json` remembers the version of every module and its test file at the last green run. When a module changed but its test file did not, `npm test` fails and names the module. So every module change comes with a new or updated test in the module's own test file. After a green run, record the new baseline:

    npm run lock

Commit `tests.lock.json` together with the change.

### Render tests (snapshots)
Some tests compare the generated page with a saved copy in `tests/__snapshots__/`. If you change the look on purpose, refresh the copies with `UPDATE_SNAPSHOTS=1 npm test`, read the diff, and keep it only if it is what you intended.

## Day coordinator, conclusie-appje, 1-op-1, Flex
- **Back-up gezinnen (Beheer).** Card *Back-up gezinnen* below *Gezinnen beheren*. *Back-up maken* downloads `az-carpool-gezinnen-<datum>.csv` (semicolon, UTF-8 with BOM, opens in Excel): per family `id`, Ouder, Dochter, Type gezin (vast/flex), Coördinator (j/n), Autocapaciteit, Telefoon 1 and 2, and per weekday the times (`Ma heen`, `Ma terug`) and availability (`Ma rijden heen`, `Ma rijden terug`: *beschikbaar*, *back-up* or empty). *Terugzetten uit bestand…* reads such a file (comma or tab also fine), checks ALL of it first (times hh:mm, capacity 1–9, type, j/n, one coordinator at most, no double ids) and shows either the problems with their line number (nothing is written) or a summary with *Overschrijven* (two taps). Restore **overwrites** the fields above of the families in the file, matched on `id` (if the id no longer exists the family is created again under that id), else on a unique daughter+parent name, else it becomes a new family; families NOT in the file stay untouched, and invite codes, links and pending time changes are never in the file nor touched. It is one batch: all or nothing. The coordinator changes only when the file marks another family with *j* than the current one (the preview warns). Excel dropping the leading 0 of a phone number is repaired. Service worker cache `az-carpool-v15`. No change to `firestore.rules` (only the coordinator writes families and `config/coordinator`).
- **Dagcoördinator (Beheer).** Beheer → *Dagcoördinatoren*: pick one family per weekday. It is stored as family ids in `settings/dayCoordinators`, so name and phone number always come from the family, never from the code. Rooster and Mijn week show the coordinator of the NEXT day, because changes are purged at midnight: Mon–Thu "Dagcoördinator morgen: <naam>", Fri nothing, Sat/Sun "Dagcoördinator maandag: <naam>" (plus a WhatsApp button; nothing when no one is set).
- **Conclusie-appje (Wijzigen).** Bottom of every day: a drafted text ("<Dag>: volgens schema" + Mijn week link, or the changes first — Rijdt niet mee heen/terug, Gewijzigde chauffeur/tijd, Rijdt ook mee heen/terug, empty kinds left out — followed by the full schedule of the day). The button opens WhatsApp with the text filled in; nobody is messaged automatically. The card is highlighted for that day's coordinator; every parent can use it.
- **1-op-1 afstemmen (Wijzigen).** Each driver in a direction gets a WhatsApp button with a prefilled question, plus the hint "Stem 1-op-1 af, de dagcoördinator deelt het besluit."
- **Ritkaart (Wijzigen).** Each car is a compact card (design *Ritkaart – compact*, variant 1a): closed it is one line — time, driver and route ("Busstation → AFC '34") — with the passengers below; **Wijzig** unfolds a form with Vertrek, Chauffeur, Ophalen (place or *Ander adres…*), **Aankomst** (AFC '34 Alkmaar / ATC Wijdewormer) and Kinderen (the *···* button moves a child to another car or removes her; the card then shows *Ongedaan*). Changes are saved at once. The arrival is stored as `destination: 'ATC'` on that car of the deviation (absent = AFC '34, the destination from Beheer), so it expires with the week; the header pill (*Heen · Aalsmeer → Wijdewormer*) and every "07:05 Busstation → ATC" label follow it (`destinationFor`, `routeLabel` in `locations.js`). Which cards are open is kept in `S.devOpen` so a live update does not fold them.
- **Back-up (Wijzigen).** Under the cars of every direction: "Back-up: <names>", the reserve drivers in the order of the Selectievolgorde (`tripReserveIds` in `rides.js`, the same list as Rooster → Deze week). Everybody who drives a car of that shift is left out, also after a one-off change. Each name is a WhatsApp link with the question to take over the ride; your own name is plain text. The button of the 1-op-1 line reads *Stem af met chauffeur <naam>*.
- **Weekoverzicht (Rooster).** The button *Weekoverzicht* sits at the right of the grey info line under the Deze week / Vast rooster switch (floated inside that line, so it costs no height; small text, 44 px touch area; not shown in the temporary-rooster view) and opens the whole week on one page, laid out like the old PDF (`ui-overview.js`): title, week, departure places and the standard ride cost (fixed distance AFC from Beheer × 20 ct), version (time of the last change), a table per day with the day coordinator, then Rit, Tijdstip, Auto, Chauffeur, Passagiers, Bezetting (passengers/seats) and Reserve (volgorde van vragen); next to it *Rijfrequentie* (rides per driver this week) and below the times of every girl (arrival Alkmaar / ready to be picked up) per day. It shows what actually runs this week (one-off changes count and are marked with *). *Afdrukken / PDF* calls the print dialog of the phone or browser (A4 landscape, one page; "Save as PDF" is in that dialog); `@media print` in `index.html` hides everything except the overview. Not in the old PDF and therefore not here: the Team column and the Thursday rotation table. Service worker cache `az-carpool-v12`.
- **No daughter picker.** A browser is linked to its family only through the gate (phone number + invite code); the old *Mijn gezin → Mijn dochter → Dit is mijn dochter* picker is removed. A coordinator without a family of their own sees a pointer to Beheer instead. Texts and the help article *Hoe koppel ik mijn telefoon aan mijn gezin?* follow. No change to `firestore.rules`. Service worker cache `az-carpool-v20` (also: the gate status line now says to enter phone number and code).
- **Laatste sessie (Beheer).** Every linked browser writes `sessions/<uid>` = `{familyId, at}` when the app opens or returns to the foreground (at most once per 15 minutes; not while the coordinator views as another family). Beheer → Wijzig gezin shows *Laatste sessie: <datum>* under the phone numbers (newest of the family's browsers); without data it shows *Gekoppeld op*. **`firestore.rules` changed: paste the new rules into the Firebase console → Rules**, otherwise the writes are refused (silently) and only *Gekoppeld op* is shown. Service worker cache `az-carpool-v18`.
- **Flex.** Beheer → Wijzig gezin → *Type gezin*: Vast or Flex. Flex families are never in the auto-planned rooster (not as passenger, not as driver, no "niet ingedeeld" alerts). A Flex parent (or the coordinator) signs up per day and direction in Wijzigen: with a time, as passenger in a car with a free seat, or driving herself. This is stored as a normal deviation, so it expires with the week. A Flex driver is shown as "speelster-chauffeur". No change to `firestore.rules` was needed.

## Periode met andere tijden (holiday, exam week)
**Several periods at the same time.** The coordinator keeps a LIST of periods (Beheer → *Perioden met andere tijden*), because the next collection usually starts while the current period is still running (for example the toetsweek while the herfstvakantie is on). Every period has its own document `periods/<firstDay>` (the first day is the id), its own deadline, its own handed-in times and its own temporary rooster; they only may not share a day (`validatePeriod(raw, others)`: an overlapping period is refused with the name of the one in the way). The filling-in windows may overlap freely. Everything below describes one period; with two periods every card, badge count, overview and rooster view exists per period. The rules for that are in *Several periods* at the end of this section.

Design: "Ontwerp: andere tijden doorgeven voor vakantie en proefwerkweek". It is built in four steps, each with its own tests and a phone check before the next one starts. **Step 1 (done): the coordinator sets the period up.** Nothing changes yet for parents, Rooster or Mijn week.
- **Where.** Beheer → *Perioden met andere tijden*, below *Dagcoördinatoren*: the list of periods and *+ Periode toevoegen*. Fields: name, first day, last day, *Invullen open vanaf*, deadline (date + time). *Opslaan* stores it, *Annuleren* drops unsaved edits, the pencil edits a period, the trash button (tap twice) removes it.
- **Rules** (`period.js`, `validatePeriod`): name required (max 40 characters); first and last day are workdays (Mon–Fri), last not before first, at most 10 workdays (`PERIOD_MAX_WORKDAYS`); filling in opens on or before the deadline day; the deadline is before the first day of the period. Nothing invalid is stored: the first problem is shown in a toast and what was typed stays in the form.
- **Storage.** One document per period, `periods/<firstDay>` (steps 1-3 used a single `settings/period`; see *Several periods at once*): `name`, `firstDay`, `lastDay`, `opensOn`, `deadlineDate` (`YYYY-MM-DD`) and `deadlineTime` (`HH:MM`, local time). Dates are plain strings, so no time zone can shift a day. Separate from `deviations`, so it does not expire on Saturday. `firestore.rules` covers it (`settings/{docId}`: members read, only the coordinator writes). A broken document counts as "no period".
- **Status line** under the intro: no period / *Invullen opent op …* / open until the deadline / deadline passed (only the coordinator can still change times) / period over (`periodPhase`). The "9 van 14 gezinnen doorgegeven" line from the design comes with step 2, when parents can hand in their times.
- **Deadline moment.** *Opslaan* also stores `deadlineAt` (the deadline as a moment in ms). `firestore.rules` compare it with the server clock. A period saved before step 2 has no `deadlineAt`: **open it in Beheer and press *Opslaan* once**, otherwise parents cannot hand in.

### Step 2 (done): parents hand in their times (Wijzigen)
- **Task.** From the day *Invullen open vanaf* every family with a daughter sees a card *Actie nodig: geef tijden door* at the top of Wijzigen, with the deadline, and a red **1** on the Wijzigen tab. Handed in: a green card *Tijden doorgegeven* with every day (*vast rooster*, *rijdt niet mee*, or only the times that differ) and *Tijden aanpassen* until the deadline. A Flex family has no task (it signs up per day). Before the opening day and after the last day nothing shows. The badge and card appear and disappear on their own with the clock (checked every minute, `refreshPeriodTask` in `app.js`).
- **Form** (*Tijden doorgeven*). One block per workday, starting as the standard rooster (`families.schedule`); a day without standard times starts as *Rijdt niet mee*. Switch *Rijdt mee / Rijdt niet mee*; two times, Heen (arrival Alkmaar) and Terug (ready for pick-up); a time filled in means she rides. Changed days and times are amber. Rules (`validateEntry`): a riding day needs at least one valid time; Terug must be later than Heen. Nothing invalid is stored: the first problem is named with its day.
- **Once per period.** One document per family and period: `periodEntries/<firstDay>_<familyId>` with `familyId`, `periodFirstDay`, `days` (`{ out:true }` or `{ heen, terug }`, a missing time = not riding that way), `submittedAt`, `by`. Handing in again replaces it. Not handed in: the standard rooster applies.
- **After the deadline** a parent can change nothing (the card stays, read only). The coordinator can still fill in and change for the own family (card without badge). Filling in for other families comes in step 3.
- **Firestore rules (new: publish `firebase/firestore.rules`).** `periodEntries`: members read; the coordinator writes anything; a parent writes only the own family's document of the period that is set now, only before `deadlineAt` (server time), only the known fields. These rules were tested against the Firebase emulator: own entry before the deadline works; after the deadline, for another family, with a wrong id or period, with an extra field, without `deadlineAt` or without a period is refused; a parent cannot delete.
- **Deploy.** New file `ui-period.js` (upload it), `service-worker.js` (cache `az-carpool-v10`), `index.html` (badge), `firestore.rules` (paste into the console → Publish).
- **Wijzigen (`deviations`) is untouched.** A one-off change in Wijzigen still applies to the week and, in step 4, will go before the temporary rooster.
### Step 3 (done): the coordinator fills in on behalf of a parent
- **Overview (A4).** From the day filling in opens until the last day of the period the coordinator sees a card *Namens een ouder invullen* in Wijzigen: "9 van 14 doorgegeven. Nog 5 te gaan." (or "Alle 14 gezinnen hebben doorgegeven."), then one row per family: daughter, parent, *Nog niet* / *Doorgegeven* and a button. Families that still have to hand in come first, then the others, each in name order. The own family is the coordinator's own task above it (with the text "Als coördinator kun je ook invullen namens een ouder"); a coordinator without a family of their own gets the overview with its own introduction and the deadline. Flex families are not listed or counted. Not shown in the "test as parent" view. This card is the only notification for the coordinator (no WhatsApp button, as agreed); the red 1 stays for the coordinator's own task only.
- **Invullen** opens the same form as for a parent, with the standard rooster of THAT family and the line "Je vult in namens <ouder> (<dochter>)". **Bekijk** unfolds what the family handed in (compared with that family's rooster) with *Tijden aanpassen*.
- **Also after the deadline**, until the period is over. The entry is stored as `periodEntries/<firstDay>_<familyId>` like a parent's, with the coordinator's name in `by`. No rules change: the coordinator could already write every entry.
- **Beheer** shows "Doorgegeven: 9 van 14 gezinnen" on the period card, from the day filling in opens (Flex not counted).

### Step 4 (done): Rooster: progress and the temporary rooster
- **Overview (A5, coordinator).** Above the switch in Rooster, from the day filling in opens until the period is over: name and dates, *Doorgegeven 9 van 14*, the deadline with the girls that have not handed in yet (five names and "+n"), one chip per workday with the number of changes compared with the standard rooster, and *Tijdelijk rooster maken*. Once made it becomes *Alles opnieuw indelen* (tap twice) plus a trash button (back to the standard rooster; the handed-in times stay).
- **Making it.** One tap plans every shift of the period (heen and terug of every workday) with the SAME planning as the standard rooster (`planning.js`, the availability, the *Selectievolgorde* and the preferences of that weekday), but with the handed-in times (a family that handed in nothing keeps its standard time; a Flex family is never planned). A rider no driver can take is not lost: the best fitting part is planned within the same rules and the rest is shown as *niet ingedeeld* (`planShift` returns it as `unplaced`).
- **Storage.** One document per shift: `periodCars/<firstDay>_<date>_<direction>` = `{ periodFirstDay, date, direction, cars:[{ driverFamilyId, girlIds, departureTime }], madeAt, by }`. A shift without a document runs on the standard rooster. Only the coordinator writes.
- **Third view.** Next to *Deze week* and *Vast rooster* a button with the period name (cut at 10 characters: "Herfstvak."). The coordinator has it from the day filling in opens; parents once the rooster has been made. Pills for every workday of the period (two weeks: two rows) with the number of cars and an alert for riders without a car. Per direction: the handed-in times next to the standard ones (struck through where they differ, or "rijdt niet mee"), the cars, and for the coordinator: *Opnieuw indelen* for that direction, a driver select per car (only drivers available that weekday, one car per driver), a move select per rider (another car, *Niet ingedeeld*) and for riders without a car a select to put them in a car or in a new car with a free driver. A full car is refused, nothing is stored on an error. Parents see it read only.
- **Where it counts.** `rides.js` (`effectiveCars`): a one-off change from Wijzigen (`deviations`) goes first, then the temporary rooster, then the standard rooster. This is only for a date inside the period where that shift was made; every other week and date runs exactly as before (the whole old test suite passes unchanged). Mijn week, Rooster *Deze week*, Wijzigen (its cars and the departure time it computes) and the WhatsApp texts read the temporary rooster on those dates: the handed-in times (`rideTime`), the cars, and "changed" is compared with the temporary rooster (`baseCars`). The impact preview plans with the handed-in times too.
- **Agreed rule.** The check "Terug later dan Heen" is for ONE daughter (step 2). The planning never requires an order between cars: the first terug car may leave before the heen ride of the second car arrives.
- **Firestore rules (new: publish `firebase/firestore.rules`).** `periodCars`: members read; only the coordinator writes, only the known fields, `direction` heen or terug, `cars` a list. Tested against the Firebase emulator (batch of shifts, parent and stranger refused, extra field, wrong direction, cars not a list).
- **Deploy.** New file `ui-period-rooster.js`; changed `rides.js`, `planning.js`, `period.js`, `dates.js`, `data.js`, `ui-schedule.js`, `ui-myweek.js`, `ui-deviation.js`, `message-texts.js`, `impact.js`, `state.js`, `index.html`, `service-worker.js` (cache `az-carpool-v11`), `texts-nl.js`, `help-nl.js`, `firestore.rules`.
- **Not in this step.** Moving girls between shifts or dates, and per-car locations for the period (the standard places apply). Left out on purpose; ask if needed.

### Several periods at once (done)
- **Beheer.** *Perioden met andere tijden* is a list: per period name, dates, where it stands, *Doorgegeven x van y gezinnen*, a pencil (edit) and a trash button; *+ Periode toevoegen* opens the form (one form at a time, unsaved edits survive a redraw). The first day of a period cannot be moved once anything is stored for it (handed-in times or a temporary rooster), because it is the key of both.
- **Deleting** a period removes the period AND what families handed in for it (nothing invisible stays behind); the button asks twice and says how many families lose their times. A period with a temporary rooster cannot be deleted: remove the rooster first (Rooster). The temporary rooster of one period never touches another.
- **Which period does a date belong to?** `periodForDate(periods, iso)`: the period whose first..last day contains it (periods never share a day). `rides.js` uses it for `periodShift`, `periodTimeFor`, `periodCarsFor`; `planPeriodRooster(st, period)` plans one period.
- **Wijzigen.** A task or "doorgegeven" card per period (oldest first), and for the coordinator an overview per period (heading names the period once there are two). The red number counts the open tasks ("2"). The form and its buttons know their period; each period has its own deadline (a parent can hand in for the toetsweek while the herfstvakantie is closed).
- **Rooster.** The coordinator gets an overview card per period. The third button carries the name of the *selected* period; with two periods a field *Periode* at the top of that view chooses which one (default: the one running today, else the next one). A parent has the view for the periods whose rooster was made.
- **Old data moves over by itself.** Steps 1-3 stored ONE period in `settings/period`. It is still read; the coordinator's app copies it into `periods/<firstDay>` (with `deadlineAt`) and removes the old document, once. Saving or deleting such a period also moves/removes it. Handed-in times and temporary rooster were already keyed by first day, so nothing else moves.
- **Firestore rules (publish `firebase/firestore.rules` again).** New `periods/{firstDay}`: members read, only the coordinator writes (id = first day, known fields, `deadlineAt` a number). `periodEntries` now checks the deadline of THE period named in the entry (`periods/<firstDay>`, falling back to `settings/period` until moved), so each period has its own deadline. Tested against the Firebase emulator (39 cases in total for the three period collections).
- **Also fixed:** in step 2 the "Annuleren" button of the Beheer form and the one of the Wijzigen form shared an id (`periodCancel`), which could make one tap the other's button. The Beheer buttons are now `periodDraftSave` / `periodDraftCancel`.

### Back-ups of a period (done)
- **Why.** The coordinator can try things in a period (make or re-plan the temporary rooster, fill in for a parent, change dates) and put everything back, without losing what parents handed in.
- **Where.** Beheer → *Perioden met andere tijden* → under each period (one block per period: name, dates, phase pill, progress bar, folded *Wie heeft ingevuld?* list, folded *Back-ups (n)*; editing opens the form in that period's spot) a folded line *Back-ups (n)*: *Back-up maken*, and per back-up the moment, how many families and shifts it holds, what is different since, a restore button (refresh icon, tap twice) and a trash button. Up to `PERIOD_BACKUP_MAX` (10) hand-made back-ups per period.
- **Content.** Everything of ONE period: the period document, its `periodEntries` and its `periodCars`. Stored as `periodBackups/<firstDay>_<ms>`: `{ periodFirstDay, createdAt, by, auto, period, entries, cars }` (`entries` and `cars` are copies of the documents by id). Pure logic in `period-backup.js`.
- **Restore = everything back.** One batch (all or nothing): the period and every entry and shift of the back-up are written, entries and shifts that exist now but not in the back-up are deleted. What families handed in after the back-up is lost; the second tap says how many families (`changesSince`). A back-up whose dates now share a day with another period is refused (periods never share a day). A broken back-up is never restored.
- **Safety net.** Just before a restore the app stores the current state as `periodBackups/<firstDay>_auto` (one per period; a new one replaces the old one). Restoring that one undoes the restore (and swaps again).
- **Deleting a period** also deletes its back-ups (the second tap says so).
- **Firestore rules (publish `firebase/firestore.rules` again).** New `periodBackups/{backupId}`: coordinator only, also for reading (a back-up holds what families handed in); known fields only. Tested against the Firebase emulator (19 cases: coordinator reads, writes, deletes and restores in one batch; parent and stranger refused for everything; extra, missing and wrongly typed fields refused). Without publishing, *Back-up maken* fails with a permission error.
- **Deploy.** New file `period-backup.js`; changed `data.js`, `state.js`, `ui-beheer.js`, `texts-nl.js`, `help-nl.js`, `service-worker.js` (cache `az-carpool-v31`), `firebase/firestore.rules`.

## Melding voor iedereen (notice bar)

- **Where.** Beheer → *Melding voor iedereen* (above *Perioden met andere tijden*). Switch *Melding tonen*, text (max 100 characters, plain text, one line), optional *Automatisch uit op* (date AND time, phone's local time), *Opslaan*.
- **What users see.** A thin yellow bar (`#noticeBar`, `.noticeBar`, no button, 25 px for one line, 41 px for two) above the red header on every tab, for all users including the coordinator. Users cannot close it. With the test view on, the test bar stays on top and the notice sits below it.
- **Stored.** `settings/notice` = `{ on, text, offDate, offTime, offAt, updatedAt }`. Members read, only the coordinator writes (the general `settings/{docId}` rule; no rules change needed). Switching off keeps the text.
- **Ending by itself.** The bar is hidden when `offAt` has passed. It is re-checked on every data change, every minute and when the app comes back to the front, so it can be up to a minute late on a phone that was asleep, never longer than that after opening the app.
- **Files.** `notice.js` (logic), `ui-notice.js` (bar + card), the card is placed in `ui-beheer.js`, the listener is in `data.js`.

## Onderhoudsmodus (app temporarily closed)

- **Where.** Beheer → *Onderhoudsmodus* (above *Melding voor iedereen*). Switch *Onderhoudsmodus aan* and optional own text (max 150 characters, plain text). No save button: the switch saves at once, the text when the field is left (`change`). A failed save puts the switch back to what is stored.
- **What users see.** A full-screen page (`#maintenanceOverlay`, z-index 80, above Help and sheets): "De app is even niet beschikbaar", the own text or a default line, and "Dit scherm verdwijnt vanzelf". The header, tabs and navigation behind it get `inert`, so keyboard and screen reader cannot reach them. It appears and disappears live (Firestore listener), without a reload.
- **What the coordinator sees.** The normal app, plus a thin yellow bar (`#maintenanceBanner`) as a reminder. Only the *real* coordinator (`isRealCoordinator`) is never blocked, also in the test view as a parent (so the page itself is not visible there).
- **Stored.** `settings/maintenance` = `{ on, text, updatedAt }`. Members read, only the coordinator writes (the general `settings/{docId}` rule; no rules change needed). Switching off keeps the text. Only `on === true` counts as on; a missing or broken document means off.
- **Limits.** This is a screen in the app, not a lock on the database: a parent who knows how can still read or write data. Browsers that are not linked to a family cannot read the document and see the normal gate. A phone that is offline shows the last known state. If the document cannot be read, the app stays open (fails open), so a database problem never locks the coordinator out.
- **Files.** `maintenance.js` (logic), `ui-maintenance.js` (page, bar, card), the card is placed in `ui-beheer.js`, the listener is in `data.js`, the markup and styles are in `index.html`.

## Wedstrijden tab
- **Where.** Own tab *Wedstrijden* (between Mijn gezin and Beheer, violet like every match ride). The match carpools used to sit at the bottom of Wijzigen; Wijzigen is now only for one-off ride changes. Mijn week keeps its read-only "Wedstrijden deze week" card; its *Carpool regelen* button opens this tab.
- **Scope.** Every match of the next 29 days (today through 28 days out; `MATCH_HORIZON_DAYS` in `matches.js`) is listed, and the calendar request asks Google for exactly that range (`timeMax`, up to 50 events per team).
- **Only the first 8 days can get a carpool** (today through 7 days out; `MATCH_PLAN_DAYS`, `isMatchPlannable`). Later matches show a small note "Carpool nog niet te plannen. Dit kan vanaf <dag>" (match day minus 7 days). The save handler checks the same rule, so a carpool can never be stored for a match that is too far away.
- **Refresh: once a day, by the first member.** The team calendars are fetched from Google at most once per calendar day (local time). The first member who is in the app that day fetches them and stores the result in `settings/matchCache` (`fetchedAt`, `feedsSig` = the calendar IDs, `partial`); everyone else reads that cache and does not call Google. Trigger (`refreshMatchesIfStale` in `matches.js`, called from `data.js` when the calendars and the cache have arrived, and from `app.js` `checkMatchRefresh` when the app comes to the foreground and once a minute, like `checkWeekRollover`): the cache is not from today, or was fetched for other calendars (Beheer changed; renaming a team does not count), or was partial (one team failed). After an automatic attempt the same calendars are not tried again for 15 minutes (`MATCH_RETRY_MS`), so a failing Google never means a request every minute. Beheer → *Nu verversen* still fetches at once. Two members opening the app at the same moment may both fetch; that is harmless.
- **Nothing to show.** Without any match in the 29 days the tab is empty (no message). The "set up a carpool" sentence only appears when at least one match can get a carpool.
- **Estimated cost.** Under the distance of a match: "± 25,4 km enkele reis · ± € 5,08 carpoolkosten" = km x `KM_COST_EUR` (EUR 0,20, `constants.js`). One way, like the km. It also shows in Mijn week wherever the distance shows, for home and away matches. Fixed distances (AFC, ATC) are not estimated, so they show without the "±": "36 km enkele reis · € 7,20 carpoolkosten".
- **References.** Mijn week → *Carpool regelen* (`goToMatchCarpool`) opens the tab; Beheer's calendar hint names the tab; `data.js` and `matches.js` refresh the tab when matches, carpools or distances change. `service-worker.js` lists `ui-matches.js` (cache name bumped to v6).

## Ritplekken, Terug met OV, afstand, impact-preview, route (US-15, 06, 21, 07, 22)
- **Plekken (US-15).** Beheer → *Ophaal- en afzetplekken*: up to 6 places (start: Busstation, A4-De Hoek, De Parel; *Plek toevoegen* / *Verwijder*, Busstation stays) with a name and an address. An address is a logical address, GPS in decimal degrees (`52.2589, 4.7673`) or degrees-minutes-seconds (`52°15'32.3"N 4°46'02.3"E`); GPS is used as it is for the distance calculation and map links. Also the destination in Alkmaar (default AFC '34), the default place for heen and terug and the fixed distances (labels *AFC '34, Alkmaar* and *AZ Trainingscomplex, Wijdewormer*). Stored in `settings/locations` (`places`, `defaults`, `shifts`). **Standaardrooster:** every shift takes the heen/terug default, but the coordinator clicks the place in Rooster → Vast rooster to give that shift (day + direction) another standard place (`shifts`). **Wijzigen:** per car a one-off choice from the places, or free input (address or point of interest, stored as `locationText` on that car of the deviation only, never as a standard address); it expires with the week. Every ride shows "07:05 Busstation → AFC '34" in Rooster and Mijn week (text only).
- **Terug met OV (US-06).** Mijn week, terug ride of an upcoming day: button *Terug met OV* (no reason). The girl leaves her terug car (departure time recalculated), is not counted as "niet ingepland", and the conclusie-appje says "<naam> terug met OV". Stored on that day's `_terug` deviation as `ovGirlIds` (+ `ovFrom`, the driver whose car she left, used to put her back with *Toch met de auto*). Expires with the week.
- **Afstand uitwedstrijden (US-21).** Start: address of *Busstation* (Beheer; without address "Busstation Aalsmeer, Aalsmeer, Nederland"), destination: the calendar location of the match. OpenRouteService (free) geocodes both and gives the fastest car route; the result is stored once per match in `settings/matchDistances` (recalculated only when the calendar location changes). No location or not found: "locatie onbekend". Locations that are AFC '34 ("AFC", Jan Ory Voetbalcomplex, Robonsbosweg, 1816MK) or AZ Trainingscomplex ("ATC", AFAS Trainingscomplex, Zuiderweg 72, 1456NH) use the fixed km set in Beheer (*Vaste afstand*) and are never calculated. Home matches at other places are calculated like away matches. **Setup:** get a free key at openrouteservice.org (Dashboard → Request a token, type *Standard*) and enter it in the app: Beheer → *API-sleutels*. The key is stored in `settings/apiKeys` (field `ors`): only members can read it (the browser needs it to call OpenRouteService), only the coordinator can change it, and it is **not** in the public GitHub folder. Beheer shows only the last 4 characters. Without a key the feature stays silent. **Publish `firestore.rules`** (new rule for `settings/matchDistances`).
- **Impact-preview (US-07, pilot).** Beheer → *Impact-preview (pilot)*, off by default. On: before a change in Wijzigen is saved a sheet shows one of "Scheelt een auto", "Geen effect", "Extra plek nodig → voorstel: <chauffeur>", "Geen oplossing → back-up <naam>" (or "Geen oplossing en geen back-up beschikbaar"), with *Opslaan* / *Annuleren*. Nothing about the preview is stored; the switch itself is `settings/features` and is deleted when switched off. **Remove after the pilot:** delete `impact.js` and `impact.test.js`, the line in `data.js` `saveDeviationCars` that calls `impactGate`, and in `ui-beheer.js` the `impactCardHtml()` line and the `wireImpactCard(renderBeheer)` line (plus the two imports), then `npm run lock`.
- **Route naar wedstrijd (US-22).** In Mijn week the match location is a link: on Android a generic `geo:0,0?q=<location>` (opens the user's maps app), on iPhone and laptop a Google Maps search URL (`google.com/maps/search/?api=1&query=`). The route starts from the current GPS position, not from the busstation.

## Help ("?" in the header)
- **What.** The `?` button next to the theme button opens a panel with a search box and a list of topics. A parent types a question ("mijn dochter is ziek") and gets the best articles, opens one, and can jump to the right tab with *Ga naar ...*. Coordinator-only articles (Beheer) show only to the coordinator (`S.canEdit`).
- **How it works.** Plain search over `help-nl.js` in the browser (`help.js`: lower-case, accents removed, filler words dropped, prefix matching, title > keywords > body). No AI, no server, no API key, nothing a user types leaves the phone.
- **Adding or changing an article.** Edit `help-nl.js` (fields are explained at the top of the file), run `npm test`, then `npm run lock`. The test fails if an article contains a link, e-mail address, phone number, long key-like code or password, so a secret can never end up in the help by accident. Write button and tab names exactly as they appear in the app, and update the article whenever a screen changes.
- **Over deze app.** Four articles with `group: 'over'` (achtergrond, privacy, diensten, beheer) are listed under their own heading below the topics. Their text comes from the coordinator's own document; keep it true when the app changes (for example when a service is added or removed). The number of tests in *achtergrond* is exact: `npm run lock` runs all tests and writes the total to `test-count.js` (generated, never edit by hand; upload it with the other files). `npm test` fails with "The help shows N tests, but there are M" until `npm run lock` has been run again, so the number can never be out of date.
- **Panel texts** are in `texts-nl.js` under `help.*`; the `?` icon is `question` in `constants.js`.
- **Later option.** An AI chat on top of the same articles would need a key that must not sit in the app, so it needs a small server. Not built on purpose.

## Texts and languages
Every on-screen text and message is in `texts-nl.js`, as `key: 'text with {placeholders}'`. Code calls `t('key', { name: 'x' })`. Static texts in `index.html` use `data-i18n="key"` attributes. To add a language, copy `texts-nl.js` to `texts-<lang>.js`, translate the values (keep keys and `{placeholders}`), and switch the dictionary in `i18n.js`. Many texts use generic placeholders such as `{p1}`. Look at the Dutch sentence to see what each one is.

## Deploy
1. Upload all changed files to the GitHub repo (`main`). Upload `index.html`, `service-worker.js`, and every new or changed `.js` file (new in this release: `family-backup.js`; earlier: `period.js`; earlier: `locations.js`, `ov.js`, `distance.js`, `impact.js`; and publish `firestore.rules`; then enter the OpenRouteService key in Beheer → *API-sleutels* and remove the `openRouteServiceApiKey` line from your live `firebase-config.js`, and revoke the old key at openrouteservice.org: it was in the public folder). Test files are optional (the site does not use them).
2. GitHub Pages redeploys in about 60 seconds.
3. If `firestore.rules` changed, paste it into the Firebase console (Firestore → Rules → Publish).
4. Open the app once online. The service worker (cache `az-carpool-v16`) then replaces the old cache.
5. **Always bump `CACHE_NAME` in `service-worker.js` on every deploy.** Open apps (phone, home screen) check for a changed `service-worker.js` each time they come to the foreground (tab switch, back from another app) and reload themselves once when a new one takes over. No change to that file means no automatic update.

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


## Planningslogica (standard rooster and period rooster)

One engine plans a shift (weekday + heen/terug): `planShift` in `planning.js`. `checkPlan` re-checks every result independently; a plan that fails the check is not offered as *Aanbevolen* (and logged with `console.error`).

**Who.** Riders are the non-Flex families with a time in that shift. Drivers are families whose availability for that shift is *beschikbaar* (standard) or *back-up*, in the *Selectievolgorde* (Flex families included when their availability says so; a Flex family is never a passenger). A driver has capacity − 1 passenger seats.

**Wait.** Heen: rider time minus the earliest time in the car. Terug: latest time in the car minus rider time. The spread inside one car may never exceed the gap limit (default 3 hours, inclusive).

**Hard rules.** Every rider in exactly one car; a driver has at most one car; seats are enough; spread within the limit; together-rules are kept when possible.

**Order of importance among valid plans.**
1. As few back-up drivers as possible (only when the standard drivers cannot cover the shift: seats or the time limit).
2. As few cars as possible.
3. Lowest sum of *Selectievolgorde* ranks of the used drivers.
4. Least total waiting time.
5. Wishes, in this order: samen reizen, the own parent drives the own child, voorkeur. A wish may cost extra waiting only within its window (`prefWindowMinutes` for samen reizen and voorkeur, `parentPrefWindowMinutes` for the own parent), measured per girl as her own waiting time.
6. Tie: the highest ranked driver takes the earliest-leaving car.

The size of a car or a group never decides who gets which group; time decides, seats only decide whether it fits. The search tries all divisions (with a node cap) and is verified against a brute-force reference on 300 random shifts (`tests/planning.test.js`); real roster cases are in `tests/planning-scenarios.test.js`.
