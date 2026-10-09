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
5. **Red (`--az-red`) is an accent only.** It is for: the app icon, the active tab, "vandaag", the own daughter's chip and initial, badges, and the second tap of a destructive action. It is **never** for headers, hero cards, primary buttons, alerts, selected states, links or borders.
6. **Primary buttons are ink** (`--action-bg`). Selected = ink. Alerts and changes = amber. Success / "you drive" = green. Matches = violet.
7. **Every tap target is at least 44 px** (`--hit-min`).
8. **Dark theme comes free** if you only use role tokens (`--surface-card`, `--text-1`, ...). Never use the raw palette (`--ink-900`, `--paper-0`, ...) in components.
9. **Texts** go in `texts-nl.js`. Icons: Phosphor, through `phIcon('name')` (regular; `name-fill` for the active state).
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
- **Ride card / ride row** `.rideCard` (+ `--today`, `--match`), `.rideRow` (+ `--off`, `--match`) with `__time`, `__route`, `__driver` (name button), `__drives`, `__pass`, `__none`, `__off`, `__extra`; **DaughterTime** `.daughterTime`.
- **Match tile** `.matchTile` (violet icon, links to the Wedstrijd tab). **Coordinator line** `.coordLine`. **Name link** `.nameLink` / `[data-contact]`: every driver or coordinator name is a contact button (see `ui-contact.js`), never a direct WhatsApp link.
- **Day pills** `.dayPills` > `.dayPill` (`.on` ink, `--today` red label, `__dot` amber = someone without a car).
- **Car card** `.carCard` (+ `--mine`, `--match`) with `__head`, `__time`, `__who`, `__driver`, `__route`, `__note`, `__edit`; **dash box** `.dashBox`; **note line** `.noteLine`.
- **Contact sheet**: `.sheet__actions` with two `.btn`.
- Forms: inputs, selects and labels have one look (end of `components.css`).

## Components added in phase 3 (Wijzigen, Ritbeurs, Wedstrijden)

- Wijzigen: a closed car is a `.carCard` (`.devRide`) with a head button (time, driver, route, Wijzig/Klaar) and chips; open it shows the form (`.devForm`: time + driver, destination tiles `.devDest`, kids with `···` actions `.devKid*`). Undo bar `.devToast`. Day message card `.conclusieCard` with one ink button.
- Ritbeurs offer card = `.card.rbOffer`: mono time, route, chips, one full-width ink button; confirm block `.rbConfirm`. Own rides, moments, notifications are plain cards with `.rbMine` / `.rbMoment` rows.
- Wedstrijden: one `.card.matchCard` per match (`.matchInfo`, `.matchTitle`, `.matchCarRow`), under an `.infoLine`.
- Contact: no direct WhatsApp buttons per driver any more; names open the contact sheet. Group sharing stays (Dagbericht, share button).

Planned (see Migration): FoldCard, Stepper, Field, full form layouts.

## Migration status

- [x] Phase 1: tokens, fonts (Onest), header, avatar + Instellingen sheet, tab bar, buttons, segmented, sheet, toast.
- [x] Phase 2: Mijn week, Rooster (Deze week, Vast rooster, tijdelijk rooster).
- [x] Phase 3: Wijzigen (+ Ritbeurs inside it), Wedstrijden.
- [x] Phase 4: Beheer, Mijn gezin, Help, banners and forms moved onto tokens; `legacy.css`, the old variable names and the Plus Jakarta fonts are deleted.
- [ ] Follow-up (nice to have): the first block of `components.css` ("Screens migrated from the old stylesheet") still holds the rules of Beheer, Mijn gezin and the period cards in their old shape. Turn them into proper components screen by screen. The ratchet test in `tests/design-rules.test.js` only lets the number of inline `style="..."` attributes go down.

## Safety net

- `git tag v1-stable` is the last version before this redesign (commit `b1fc7ad`). Roll back by redeploying that tag (or reverting the merge of `feat/redesign-v2`).
- The database is shared with the old version: changes are **additive only** (new optional fields; no rename, delete or migration of existing data).
