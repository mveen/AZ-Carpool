# AZ Carpool: rules for Claude (and people) working in this repo

- **Design:** read `DESIGN.md` first. All look-and-feel lives in `tokens.css` + `components.css`. New UI uses those classes and `var(--...)` tokens only (no hex colours, no px font sizes, no one-off styles). `tests/design-rules.test.js` enforces it. Never add rules to `legacy.css`.
- **Texts:** all on-screen Dutch text is in `texts-nl.js` (`t('key')`). Icons via `phIcon()`.
- **Tests:** `npm test` must be green. A changed module needs a changed test file; after a green run do `npm run lock`.
- **Deploy:** bump `CACHE_NAME` in `service-worker.js` on every change to app files (CI checks it). New app files go in `ASSETS` there.
- **Database:** shared live Firestore. Changes are additive only (new optional fields). Never rename, delete or migrate existing data without asking.
- **Rollback:** tag `v1-stable` = the app before the v2 redesign. Redesign work happens on `feat/redesign-v2`, one PR per phase; nothing reaches `main` without the owner's approval.
- **Try a branch locally:** `npm run preview` (opens nothing; go to http://localhost:8777/). Uses the real database.
