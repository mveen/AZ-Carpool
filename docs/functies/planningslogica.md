# Planningslogica (standard rooster and period rooster)

One engine plans a shift (weekday + heen/terug): `planShift` in `planning.js`. `checkPlan` re-checks every result independently; a plan that fails the check is not offered as *Aanbevolen* (and logged with `console.error`).

**Who.** Riders are the non-Flex families with a time in that shift. Drivers are families whose availability for that shift is *beschikbaar* (standard) or *back-up*, in the *Selectievolgorde* (Flex families included when their availability says so; a Flex family is never a passenger). A driver has capacity − 1 passenger seats.

**Wait.** Heen: rider time minus the earliest time in the car. Terug: latest time in the car minus rider time. The spread inside one car may never exceed the gap limit (default 3 hours, inclusive).

**Hard rules.** Every rider in exactly one car; a driver has at most one car; seats are enough; spread within the limit; together-rules are kept when possible. Also hard: *Eigen ouder rijdt mee* (Beheer, Reisvoorkeuren; rule `{type:'ownCar', girlId, direction:'terug'}` in `settings/prefs`, family id = driver id = rider id): on a *terug* shift, when that family's parent drives, her daughter sits in her own parent's car, never in another. The parent is not forced to drive; if she does not drive, the rule does nothing. Where no complete plan exists under the rule, the daughter is reported as unplaced, never put in another car. `checkPlan` rejects a plan that breaks it, `planOptions` drops driver swaps that break it. Manual choices (Rooster, Wijzigen, temporary rooster) are never blocked: after saving, `ownCarWarning` (`rides.js`) shows a soft warning toast (in Wijzigen it replaces the confirmation text and keeps "Ongedaan").

**Order of importance among valid plans.**
1. As few back-up drivers as possible (only when the standard drivers cannot cover the shift: seats or the time limit).
2. As few cars as possible.
3. Lowest sum of *Selectievolgorde* ranks of the used drivers.
4. Least total waiting time.
5. Wishes, in this order: samen reizen, the own parent drives the own child, voorkeur. A wish may cost extra waiting only within its window (`prefWindowMinutes` for samen reizen and voorkeur, `parentPrefWindowMinutes` for the own parent), measured per girl as her own waiting time.
6. Tie: the highest ranked driver takes the earliest-leaving car.

The size of a car or a group never decides who gets which group; time decides, seats only decide whether it fits. The search tries all divisions (with a node cap) and is verified against a brute-force reference on 300 random shifts (`tests/planning.test.js`); real roster cases are in `tests/planning-scenarios.test.js`.

## Reads and the free plan (v121)
Firestore's free plan (Spark) allows **50,000 reads a day** for the whole app (the day ends at midnight Pacific time = 09:00 Dutch time); above that, reads fail until the next day. What was done about it:
- **Offline copy in the phone** (`index.html`, `persistentLocalCache` with `persistentMultipleTabManager`): a listener that is started again within about 30 minutes only costs the documents that changed. Falls back to a plain in-memory cache (the old behaviour) where the browser cannot store it. *Opnieuw beginnen* (`session-reset.js`, `clearOfflineCopy`) deletes Firestore's IndexedDB databases too.
- **Cron:** `push` rests at night and reads only what it needs; `agenda` runs at most once an hour and not at night (see above).
- **Beheer data only when Beheer is opened:** the coordinator's app listens to the ride log, the error log and the period back-ups only after the Beheer tab has been opened this session (`S.beheerOpened`, set in `activateTab`; `syncListeners` in `data.js`). The ride logging is done by the nightly purge job on the server, so nothing is lost; `logPassedShifts` and the error-log clean-up in the app are safety nets that run when Beheer is open. Links, sessions and invites stay live (small).
- **Obsolete cron line:** the line `5 0 * * 6 ... run.sh purge` (Saturday 00:05) can go: the purge runs on Friday 19:05 and nightly at 23:10.
- **Not done (yet):** a second Firebase project for testing (done: `npm run preview` now uses the test database), tidying old documents in the larger collections, Blaze (pay-as-you-go) as a safety net.

## Quota: coordinator's app and tidy-up (v158)
- Links, sessions and invite codes of all browsers (about 120 documents) are listened to only after the coordinator opened Beheer (same as the ride log, error log and back-ups).
- Tidy-up (`purgeStaleSessions`, `staleSessionPaths` in `data.js`, coordinator's app, once Beheer has loaded both lists): a session older than 30 days is deleted; a link is deleted when its browser has no fresh session and the link itself is older than 30 days. Never the own browser; at most 10 links per run; when no session at all is fresh no link is touched. The person enters the invite code again when coming back.
