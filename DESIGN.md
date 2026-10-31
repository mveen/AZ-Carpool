# AZ Carpool design system v2

One place decides how the app looks. Every screen, now and in the future, is built from it.
Source of the design: the Claude Design project "AZ Carpool design system" (prototype 390 × 844, high fidelity).

## Where things live

| File | What it holds | Who may edit |
|---|---|---|
| `tokens.css` | Every colour, font, type size, radius, shadow, spacing value, as CSS variables. Light + dark. Self-hosted font faces. | Only when the design changes. |
| `components.css` | The shared building blocks (header, tab bar, buttons, sheet, toast, segmented control, ...). Built from tokens only. | When a new reusable block is needed. |
| `print.css` | The Weekoverzicht (PDF) paper layout. Fixed colours on purpose; nothing else belongs here. | Rarely. |
| `ui-*.js` | Screens. They compose classes from `components.css`. | Every feature. |
| `tests/design-rules.test.js` | Fails when these rules are broken. | With the rules. |

## Rules for every new feature (people and Claude)

1. **Use a component class from `components.css`.** Do not restyle it in the screen.
2. **No colour literals** (`#fff`, `rgb(...)`) and **no radius or shadow literals** in CSS or in `style="..."` of new code. Use `var(--...)`.
3. **No font sizes in px in screens.** Use a `--type-*` token (`font:var(--type-body)`). Times and counts use `--font-mono`, nothing else does.
4. **Need something that does not exist?** Add the block to `components.css`, from tokens, and list it below. Then use it. Do not make a one-off.
5. **Red (`--az-red`) is an accent only.** It is for: the app icon, the active tab (Rooster: blue, see below), "vandaag", a chosen avatar icon (`.avatar--icon`), badges, and the second tap of a destructive action. It is **never** for headers, hero cards, primary buttons, alerts, selected states, links or borders.
6. **Primary buttons are ink** (`--action-bg`). Selected = ink (`--tab`; in Rooster blue, see below). Alerts and changes = amber. Success / "you drive" = green. Matches = violet.
7. **Every tap target is at least 44 px** (`--hit-min`).
8. **Dark theme comes free** if you only use role tokens (`--surface-card`, `--text-1`, ...). Never use the raw palette (`--ink-900`, `--paper-0`, ...) in components.
9. **Texts** go in `texts-nl.js`. Icons: Phosphor ONLY, through `phIcon('name')` (regular; `name-fill` for the active state, `-bold` in the switch knob). No hand-drawn SVG (a test checks `PH_PATHS`).
9a. **Feedback:** every one-off change saves at once and confirms with a toast (3.8 s) that has **Ongedaan** (`saveWithUndo`). A destructive action needs a second tap: `twoStepConfirm` turns the button red (`.confirming`). Sheets have a handle, rows with an icon and no Annuleren button: tap outside or press Escape.
9b. **Header context line** per screen is in `contextLine()` (`ui-shell.js`); keep it in step with the design.
10. **Layout:** phone first. A centred column of `--content-max` (520 px) on wider screens.

## Tokens (see `tokens.css` for values)

- Colour roles: `--surface-page/card/soft/inset`, `--line`, `--text-1/2/muted`, `--action-bg/ink`, `--accent/-soft/-ink`, `--ok/-soft/-ink`, `--warn-soft/-edge/-icon/-ink`, `--match-soft/-ink`, `--info/-soft`, `--scrim`, `--toast-*`, `--on-accent`.
- Type: `--type-screen` (22/800), `--type-section` (17/800), `--type-card-title` (15/700), `--type-body` (14/500), `--type-small` (13), `--type-caption` (12), `--type-micro` (11/700, uppercase), `--type-time-lg/md/sm` (mono), `--type-button`, `--type-tab`.
- Radii: `--radius-sheet` 28, `-hero` 22, `-card` 20, `-car` 18, `-alert` 16, `-panel` 14, `-control` 12, `-chip` 10, `-pill` 99.
- Shadows: `--shadow-card`, `--shadow-float` (toast, sheet), `--shadow-seg`. Spacing: `--space-1..9`, `--page-gutter`.

## Components available now (phase 1)

- **App header** `.appHeader` (`__icon`, `__context`, `__title`), `.roundBtn` (44 px outline icon button), `.avatarBtn` (ink circle with initials). Rendered by `ui-shell.js`.
- **Tab bar** `#bottomnav` with `.navtab` (`.active`, `.navbadge`). Five tabs: Mijn week, Rooster, Wijzigen, Wedstrijd, Beheer (coordinator). Mijn gezin has no tab: it opens from the avatar.
- **Buttons** `.btn` (ink), `.btn.secondary` (outline), `.btn.danger` (red text, outline), `.btn.confirming` (red fill, second tap), `.btn.small`, `.linkbtn`.
- **Segmented control** `.segmented` > `button.active`.
- **Bottom sheet** `.sheetOverlay` > `.sheet` (`__handle`, `__sub`, `__label`, `.sheetItem`).
- **Toast** `.toast` (+ `.toast__action`), shown through `showToast()`.

## Components added in phase 2 (Mijn week, Rooster)

- **Card** `.card`, **section label** `.sectionLabel`, **section head** `.sectionHead` (title left, sub right), **info line** `.infoLine`.
- **Chip** `.chip` (+ `--mine` grey with a green dot = own daughter, `--flex` dashed) in a `.chips` row. **Tag** `.tag` (+ `--ok`, `--warn`, `--match`, `--accent`).
- **Switch** `.switch` (+ `.on`): `button role=switch`, green + car when she rides along, grey + x when not.
- **Alert card** `.alertCard` (amber, one action), `--stack` for a list of rows (`__row`).
- **Mijn week, requests (design B)**: no amber card per request. An open request of THIS week is a compact dashed amber `.reqBlock` (`__head` clock + title, `__times` with one `.reqBlock__line` for "aanwezig" and one for "klaar": the time that holds now is `<s>`, the asked time `<b>`, no arrow; `__foot` with who decides and a `.linkbtn.danger` Intrekken, two taps, that day only) at the bottom of the card of its day. The block has no padding under the foot: the 44 px tap area of Intrekken is the space; `.rideCard` is `flow-root` so the block's bottom margin stays inside the card. Next week's requests are one `.reqBlock.reqBlock--week` that is CLOSED by default: its first line (`.reqBlock__toggle`, clock + "N aanvragen wachten op antwoord" + chevron, 44 px) is the button that unfolds the columns (`S.myWeekNextOpen`; it stays open after an Intrekken and resets when no request is left). The columns (`.nwHead`, `.nwRow`: `__day`, two `__t` times or `__t--off` "niet mee", `__who`, and an `.iconBtn` Intrekken per day, two taps) under a `.sectionHead` with the dates (`__dates`) and a `.linkbtn` "Wijzigen" that opens Wijzigen on the tab Volgende week. The ride rows have no "Aanvraag" tag; the pill "Gewijzigd" (amber, `.tag--warn`) sits in the time column under "vertrek" because it is about the whole ride (time, place or driver); the matches of the week are `.matchTile`s under their own `.sectionHead` ("Wedstrijden · deze week") right after the day cards, and "Volgende week" comes last; the driver button ends in the neutral `phone` icon (it opens the contact sheet), and there is no "speelster-chauffeur" pill anywhere; the same driver for heen and terug is one `.rideRow__driver.driverOnce` line ("Ouder van Saar rijdt heen en terug"); a changed departure time is `was <s>07:00</s>` under the new time (`.rideRow__sub s`), a changed time of a car you drive is `.rideRow__extra--changed` (amber); the switch sits in `.swWrap` with a `.swCap` ("rijdt mee" / "rijdt niet mee"); `.daughterTime` reads "Eva aanwezig om" (heen) / "Eva klaar om" (terug).
- **Ride card / ride row** `.rideCard` (+ `--today`, `--match`), `.rideRow` (+ `--off`, `--match`) with `__time`, `__route`, `__driver` (name button), `__drives`, `__pass`, `__none`, `__off`, `__extra`; **DaughterTime** `.daughterTime`.
- **Match tile** `.matchTile` (violet icon, links to the Wedstrijd tab). **Coordinator line** `.coordLine`. **Name link** `.nameLink` / `[data-contact]`: every driver or coordinator name is a contact button (see `ui-contact.js`), never a direct WhatsApp link.
- **Day pills** `.dayPills` > `.dayPill` (`.on` ink, `--today` red label, `__dot` amber = someone without a car).
- **Car card** `.carCard` (+ `--mine`, `--match`) with `__head`, `__time`, `__who`, `__driver`, `__route`, `__note`, `__edit`; **dash box** `.dashBox`; **note line** `.noteLine`.
- **Form actions** `.formActions`: Opslaan (ink) and Annuleren (outline) side by side, equal width, at the bottom of an inline form (`.dayFormCard`).
- **Contact sheet**: `.sheet__actions` with two `.btn`.
- Forms: inputs, selects and labels have one look (end of `components.css`).

## Components added in phase 3 (Wijzigen, Ritten ruilen, Wedstrijden)

- Wijzigen: a closed car is a `.carCard` (`.devRide`) with a head button (time, driver, route, Wijzig/Klaar) and chips; open it shows the form (`.devForm`: time + driver, destination tiles `.devDest`, kids with `···` actions `.devKid*`). Undo bar `.devToast`. Day message card `.conclusieCard` with one ink button.
- Ritten ruilen offer card = `.card.rbOffer`: mono time, route, chips, one full-width ink button; confirm block `.rbConfirm`. Own rides, moments, notifications are plain cards with `.rbMine` / `.rbMoment` rows.
- Wedstrijden: one `.card.matchCard` per match (`.matchInfo`, `.matchTitle`, `.matchCarRow`), under an `.infoLine`.
- Contact: no direct WhatsApp buttons per driver any more; names open the contact sheet. Group sharing stays (Dagbericht, share button).

Planned (see Migration): FoldCard, Stepper, Field, full form layouts.

## Components added for "Push-meldingen testen" (Beheer, coordinator only, temporary)

`.pushStatus`, `.pushDevice` (+ `__main`), `.pushHint`, `.pushSel`, `.pushTime`, `.pushScen`, `.pushPreview` (the phone-style list), `.pushNotif` (+ `__app`, `__icon`, `__time`, `__body`, `__meta`, `.is-wait` for a notification held back by quiet hours) and `.pushWho`. All from tokens; the state chips reuse `.noticeChip`.

## Avatar choice

- Default = initials (ink circle). A parent can pick one of 10 Phosphor icons (`avatars.js`, `AVATARS`); the id is stored as the optional field `avatar` on `families/<id>` ('' or missing = initials). Never rename an id: they live in Firestore.
- Picker: tap the avatar in Instellingen -> sheet with `.avatarGrid` > `.avatarTile` (`__disc`, `__label`, `aria-pressed`). Saves at once with an Ongedaan toast. An icon circle gets `.avatar--icon` (`--accent-soft` / `--accent-ink`).
- Shown in the header (`.avatarBtn`), Instellingen (`.settingsAvatar`) and the contact sheet (`.contactAvatar`).

## Migration status

- [x] Phase 1: tokens, fonts (Onest), header, avatar + Instellingen sheet, tab bar, buttons, segmented, sheet, toast.
- [x] Phase 2: Mijn week, Rooster (Deze week, Vast rooster, tijdelijk rooster).
- [x] Phase 3: Wijzigen (+ Ritten ruilen inside it), Wedstrijden.
- [x] Phase 4: Beheer, Mijn gezin, Help, banners and forms moved onto tokens; `legacy.css`, the old variable names and the Plus Jakarta fonts are deleted.
- [ ] Follow-up (nice to have): the first block of `components.css` ("Screens migrated from the old stylesheet") still holds the rules of Beheer, Mijn gezin and the period cards in their old shape. Turn them into proper components screen by screen. The ratchet test in `tests/design-rules.test.js` only lets the number of inline `style="..."` attributes go down.

## Safety net

- `git tag v1-stable` is the last version before this redesign (commit `b1fc7ad`). Roll back by redeploying that tag (or reverting the merge of `feat/redesign-v2`).
- The database is shared with the old version: changes are **additive only** (new optional fields; no rename, delete or migration of existing data).

## Components added for the Afwijkend weekrooster (phase 2)

- **Past day** `.periodDay--past`: a day of the week form that is over; grey, its fields disabled, label "Voorbij".
- **Column heads** `.periodColHead`: the two captions ("Heen: aankomsttijd", "Terug: klaar om op te halen") above the day rows of a time form.
- **Request card** `.periodDone--stack` with `.reqRow` (`.reqRow__day`, `.reqRow__times`): the "Doorgegeven" card as one column: title with clock, per day the name and the times (time font) next to the status tag, one note line for what other families notice, a full-width secondary button and a quiet danger link.
- **Waiting card** `.periodDone--wait`: the "Doorgegeven" card in amber while at least one day waits for the day coordinator (green when everything was applied at once).
- Reused as they are: `.periodDay` (+ `.changed`), `.periodDone`, `.segmented`, `.alertCard`, `.tag--warn` / `.tag--ok`, `.coordLine`, `.noteLine`, `.linkbtn`, `.formActions`, `.periodSummary`.

## Components added for the Afwijkend weekrooster (phase 3)

- **Day editor in Rooster** (no new classes): the car editor of Wijzigen (`devDir`, `devRide`) inside Rooster "Deze week", the link `.linkbtn` ("Zelf indelen" / "Toch zelf wijzigen") under the day, the warning as a standard `.sheet` with `.sheet__actions` (Terug secondary, Doorgaan ink), and the log line with a neutral `.tag` ("Zelf gewijzigd").
- **Stack** `.wrStack` (`.wrStack--tight`): a column with the standard gap between a full-width button, alert cards and cards (Mijn week button + request, the Advies view). Buttons in it span the width and carry an icon.
- **Advice** `.carCard--gone` (dashed: this car does not drive), `.chip--add` (green "+ Noor": joins this car), `.chip--gone` (struck through: leaves this car), `.diffLabel` ("Eerder: …" under a changed car) and `.actionBar` (two equal buttons on the canvas under the last block, in the normal flow: nothing floats or sticks; Zelf indelen secondary, Overnemen ink) in the Advies view for the day coordinator. The "Reden:" line is a `.noteLine` built from the planning, never typed.
- **Log line** `.logItem` with `.logItem__dot`, `.logItem__dot--ok`, `.logItem__main`, `.logItem__side`, `.logItem__when`: one line of "Recente wijzigingen" in Rooster: who, what, the tag (Aanvraag amber, Direct or Akkoord green) and when ("wo 07:12"). A status log of what is in force now, not a notification.
- Reused as they are: `.devAlert` ("Actie nodig"), `.alertCard--stack` with `.alertCard__row` (the action card in Mijn week), `.dayPill__dot` (a day that needs an action), `.coordLine`, `.noteLine`, `.tag--warn` / `.tag--ok`, `.navbadge` (the Rooster tab number).

## Changed for Advies and Zelf indelen (one task per day)

- **Focus view:** while Advies or Zelf indelen is open in Rooster it is the whole screen (`ui-schedule.js`: no coordinator line, tabs, Weekoverzicht or day pills). It starts with `.linkbtn` Terug and the title, then the request card, then heen and terug, then `.actionBar`.
- **Request card:** `actionCardHtml(day, { buttons, advice })` in `ui-weekrooster-rooster.js` is THE amber card of Mijn week (`.alertCard--stack` + `.alertCard__row`). Mijn week uses it with buttons; Advies (with the advice line) and Zelf indelen (rows only) show it without buttons, so the requests stay in view.
- **Whole day at once:** Advies shows heen and terug under each other with one Overnemen (Zuinigst; no variant switch, no reason line). Zelf indelen ends with one ink Klaar button (every change already saves at once).
- **Quick assign:** `.quickAssign` (`__who`, `__time`, `__room`) in the dashed "Niet ingedeeld" box: one tap puts the child in a car that still has room (`data-devquick`, same save and Ongedaan toast as "+ Passagier toevoegen"). Also in Wijzigen.

## Components added for the week form on one line per ride

- **Small switch** `.switch--sm`: the `.switch` of Mijn week at 40 x 24 (the tap area stays 44 px), for places where a switch sits next to a field.
- **Ride cell** `.wrCell` (+ `.wrCell__off`): in "Tijden deze week" per ride (heen, terug) the small switch and the time field on one line; while the ride is off the dashed `.wrCell__off` ("Rijdt niet mee") takes the place of the field. **Past day** `.wrPastDay`: day name and "Voorbij" on one line.

## Redesign of Mijn week and Rooster (v159)

- **Borders, not grey fills.** White cards sit on the page with a 1 px border in `--edge` (`.rideRow`, `.carCard`, `.matchTile`, `.dayPill`); no shadow. `--edge` is the border colour, `--line` stays for dividers inside a card.
- **Where am I:** `--tab` / `--tab-ink` are the colour of the selected day pill and the selected switch of the current tab. Ink by default (Mijn week); `#tab-schedule` sets them to `--info` (blue) and the active Rooster tab is blue too (`.navtab.active[data-tab="schedule"]`). Mijn week says "Week 44 · mijn gezin", Rooster "Week 44 · iedereen" (`contextLine()`).
- **Day pills on top of both tabs:** `.dayPills` > `.dayPill` (Mijn week: `data-mwday`, one day open under the pills, amber `.dayPill__dot` = something to arrange that day, `.dayPills--6/--7` when a weekend match day is added; Rooster: `.dayPill--cars` with `.dayPill__cars`: wheel icon + number of rides that day). Heading of the open day: `.dayHead`.
- **One ride, one card** (`ui-myweek.js` `rideRow`, `ui-schedule.js` `weekCarHtml`): head = time + direction (`.rideRow__time`) | "Chauffeur" label (`.rideRow__lab`) + who (`.rideRow__who`) | one round button (`.roundBtn`: your own car = pencil, Tijd en plek, `aria-label` only; another car = phone, opens the contact sheet); then the route as a bordered line (`.rideRow__route`, `.carCard__route--inset`), passengers (`.rideRow__pass` with label, or chips in Rooster), and in Mijn week her own time + the switch (`.rideRow__kid`). Seats in Rooster: `.seats` (two-people icon + 3/4).
- **The card you drive:** green top edge (`.rideRow--mine`, `.carCard--mine`) and the filled green badge `.tag--drive` "Jij rijdt".
- **Heen / Terug titles** always say what the time means: `.sectionHead__note` "Aankomst bij AFC '34" / "Vertrek bij AFC '34". Cars with another arrival place (ATC Wijdewormer) form their own block with their own title (no pill); `arrivalPlaces()` / `arrivalLabel()` in `locations.js`.
- **Own daughter** `.chip--mine`: a grey chip with a green dot, not red (red reads as an alarm). **"was 07:00"** under a changed time (`.rideRow__sub`) is plain text, no strikethrough, the same as `.wasTime` in Rooster.
- Matches of the week are one folded `.matchTile` under the day they are played on (no separate block); a weekend day with a match gets its own pill.

## The Advies flow as its own full screen (v165)
- The day coordinator's flow is a layer of its own: `#flowScreen.flowScreen` (fixed, above Rooster and the tab bar, below sheets and the toast), drawn by `renderFlowScreen()` in `ui-weekrooster-advice.js`. The Rooster only holds a small entry card.
- Three steps with a steps bar (`.flowSteps`): 1 Aanvragen, 2 Indeling, 3 Controleren; then the done screen. Every step has a head (`.flowHead`: round back/close button, context line, title), a scrolling body (`.flowScreen__body`) and a foot with the one primary action (`.flowScreen__foot`).
- New blocks: `.entryCard` (Rooster, "Regel dit"), `.reqPanel`/`.reqItem` (requests), `.adviceHero` + `.tag--ink`, `.statTiles` + `.statTile` (the three numbers), `.infoNote`, `.tog` + `.tog__opt` (Advies / Alternatief, the subtitle is the computed waiting time), `.scene` with cars first: `.carCard` (departure once and big, `.carCard__cap`, `__why`, `__out`, `__rest`) and `.rider` rows (name, `.chip--ok/--warn/--bad` for the wait, her time), `.statTiles__sum`, `.sheetItem__more`, `.lnkRow`, `.btn.flowApply`.
- Rules: no fixed claims about what a variant is; every number comes from `planStats`/`evaluateCars`. Tapping Doorvoeren is the only step that writes (`acceptDay`); steps 1 and 2 never change data.
- Time vocabulary of step 2 (never mix): **haar tijd** = her own time (grey), **auto vertrekt** = the car's departure (big, mono), **wacht** = the difference (chip). One number has one meaning; a time appears once per car.

## Heen and terug scenes (v171)
- Each scene in step 2 has its own glow: **heen = morning mist** (slate blue, sun badge), **terug = evening red** (plum, moon badge). Tokens `--heen-*` / `--terug-*` (glow, edge, ink, badge) in `tokens.css`, both themes; classes `.scene--heen` / `.scene--terug`. Never use these colours for status.
- Status stays explicit in every scene: green "Past in de bestaande auto’s: hier verandert niets." or an amber chip "N auto’s wijzigen". Amber/green mean status; slate/plum only mean direction.
- Step 3 (Controleren) uses the same tint and badge on its summary groups (`.planSum__group.scene--heen/terug`, v172).
- The wait tile is a button (`.statTile--btn`) that opens a sheet with the sum: per direction per person now against proposal (`.waitCalc__*`, v175); it is the last of the three tiles; any tap closes the sheet.
- Car card in three blocks (v177): `.carBlock` with `.carBlock__h` (title + mono count). **Wijzigingen** lists who is new as `.chgLine` (name, time, wait chip; equal outcomes on one line; `.chgGroup__cap` "Komen uit X" once per origin car). **Bezetting** shows every passenger as a tappable `button.chip` (tap = choose another car) plus a dashed `chip--flex` "+ Passagier" while there is a seat free. **Niet meer in deze auto** has `chip--gone` chips only. No "auto vertrekt", no "Aanvraag" captions.
- "Aanpassen" (`btn secondary small`, in the heen/terug header) turns into "Klaar" and puts the fields inside that direction's car cards (`.carCard--editing`, `.carEdit`): time and driver side by side in `.devFormTop` (as in Rooster), then Ophalen and Aankomst; "Auto toevoegen" follows the cars. There is no separate adjust sheet any more.
- Passengers (v178): the sheet of a tapped passenger ends with "Uit deze auto halen" (`.sheetItem--remove`, accent colour) which always asks to confirm. "+ Passagier" lists girls of other cars; "Ook speelsters zonder rit tonen" (`.sheet__more`) adds the ones with no ride this way (flex players), asking her time first. Both are kept in `edits.off` / `edits.add` and stored as one-off times on the shift.
- Entry card (v179): Rooster and Mijn week show the same `.entryCard` (warning icon, "N aanvragen voor {dag}", one line of advice, "Regel dit"); the old amber list card with its fold is gone from Mijn week. A follow-up screen in a sheet (`.sheetPane--fromRight` / `--fromLeft`, inside `.sheetOverlay--still`) slides in from the right and has an arrow back (`.sheetHead` + `.roundBtn`); the menu item to it is a `.sheetItem--menu` card with a caret.
