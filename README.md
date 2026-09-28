# AZ Carpool Aalsmeer–Alkmaar

Mobile-friendly carpool scheduler for AZ youth football parents. Static site (GitHub Pages) + Firebase Firestore.

## Files
| File | Purpose | Deploy to GitHub? |
|---|---|---|
| `index.html` | The whole app (UI + Firestore wiring) | yes, always |
| `planning.js` | Planning engine (pure functions, no DOM/Firebase) | yes, when the algorithm changes |
| `planning.test.js` | 23 tests for the planning engine | optional (not used by the site) |
| `schedule-changes.js` | Detects/merges changed arrival & pick-up times for coordinator notifications (pure functions) | yes, when it changes |
| `schedule-changes.test.js` | 15 tests for `schedule-changes.js` | optional (not used by the site) |
| `package.json` | Lets you run `npm test` | optional |
| `firebase-config.js` | Firebase config + Google Calendar API key (fill in once) | once, never overwrite |
| `firestore.rules` | Firestore security rules | paste into Firebase console → Rules |
| `manifest.json`, `service-worker.js`, `icon-192.png`, `icon-512.png` | PWA (install on home screen) | once |

## Run the tests
Run after every change to `planning.js` or `schedule-changes.js`, before copying it back:

    npm test      # runs planning.test.js and schedule-changes.test.js

Expected: `23 passed, 0 failed` and `15 passed, 0 failed`.

## Update workflow
1. Change files in the chat, get updated files back.
2. Upload changed files to the GitHub repo (`main`); GitHub Pages redeploys in ~60 seconds.
3. If `firestore.rules` changed, paste it into the Firebase console (Firestore → Rules → Publish).
