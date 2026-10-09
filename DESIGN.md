# AZ Carpool design system v2

One place decides how the app looks. Every screen, now and in the future, is built from it.
Source of the design: the Claude Design project "AZ Carpool design system" (prototype 390 × 844, high fidelity).

## Where things live

| File | What it holds | Who may edit |
|---|---|---|
| `tokens.css` | Every colour, font, type size, radius, shadow, spacing value, as CSS variables. Light + dark. Self-hosted font faces. | Only when the design changes. |
| `components.css` | The shared building blocks (header, tab bar, buttons, sheet, toast, segmented control, ...). Built from tokens only. | When a new reusable block is needed. |
| `legacy.css` | The old CSS of screens that are not rebuilt yet. Shrinks every phase. **Never add rules here.** | Only to delete rules. |
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

Planned per phase (see Migration): Chip, Tag, Card, AlertCard, FoldCard, Switch, Stepper, Field, DayPills, CarCard, RideRow, DaughterTime.

## Migration (old screens -> v2). Delete a line when done.

- [x] Phase 1: tokens, fonts (Onest), header, avatar + Instellingen sheet, tab bar, buttons, segmented, sheet, toast.
- [ ] Phase 2: Mijn week, Rooster.
- [ ] Phase 3: Wijzigen (+ Ritbeurs inside it), Wedstrijden.
- [ ] Phase 4: Beheer, Help panel, Mijn gezin, all remaining sheets and banners.
- [ ] End: delete `legacy.css`, the DEPRECATED alias block in `tokens.css`, and the unused `fonts/plus-jakarta-sans-*`.

While a screen still uses `legacy.css`, the old variable names (`--bg`, `--card`, `--accent2`, ...) are aliases of the roles above. New code never uses them.

## Safety net

- `git tag v1-stable` is the last version before this redesign (commit `b1fc7ad`). Roll back by redeploying that tag (or reverting the merge of `feat/redesign-v2`).
- The database is shared with the old version: changes are **additive only** (new optional fields; no rename, delete or migration of existing data).
