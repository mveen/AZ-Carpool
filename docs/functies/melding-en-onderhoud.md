# Melding voor iedereen en onderhoudsmodus

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
