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
5. **Red (`--az-red`) is an accent only.** It is for: the app icon, the active tab, "vandaag", the own daughter's chip, a chosen avatar icon (`.avatar--icon`), badges, and the second tap of a destructive action. It is **never** for headers, hero cards, primary buttons, alerts, selected states, links or borders.
6. **Primary buttons are ink** (`--action-bg`). Selected = ink. Alerts and changes = amber. Success / "you drive" = green. Matches = violet.
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
- **Chip** `.chip` (+ `--mine` red = own daughter, `--flex` dashed) in a `.chips` row. **Tag** `.tag` (+ `--ok`, `--warn`, `--match`, `--accent`).
- **Switch** `.switch` (+ `.on`): `button role=switch`, green + car when she rides along, grey + x when not.
- **Alert card** `.alertCard` (amber, one action), `--stack` for a list of rows (`__row`).
- **Mijn week, requests (design B)**: no amber card per request. An open request of THIS week is a dashed amber `.reqBlock` (`__head` clock + title, `__times`, `__foot` with who decides and a `.linkbtn.danger` Intrekken, two taps, that day only) at the bottom of the card of its day. Next week's requests are one `.card.nextWeek` of `.nwRow`s (`__day`, `__times` in the time font, `__who`) under a `.sectionHead`. The ride rows have no "Aanvraag" tag; the same driver for heen and terug is one `.rideRow__driver.driverOnce` line ("Ouder van Saar rijdt heen en terug"); a changed departure time is `was <s>07:00</s>` under the new time (`.rideRow__sub s`), a changed time of a car you drive is `.rideRow__extra--changed` (amber); the switch sits in `.swWrap` with a `.swCap` ("rijdt mee" / "rijdt niet mee"); `.daughterTime` reads "Eva aanwezig om" (heen) / "Eva klaar om" (terug).
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
