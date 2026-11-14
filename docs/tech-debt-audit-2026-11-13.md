# Tech debt audit, 2026-11-13

Scope: `main` on GitHub at v243 (commit 99afcc7). Follow-up of `tech-debt-audit-2026-10-17.md`.
Tests on the local copy (v238): 2750 passed, 0 failed, 40 s.
Score: Priority = (Impact + Risk) x (6 - Effort). Each 1-5.

## Overall

Still a healthy codebase, and better than a month ago. The debt has moved from "code" to "operations": things done by hand or kept in one place.

Solved since the last audit: own test environment and test database, deploy chain tests -> test site -> robot smoke test -> live, stray files and old branches cleaned up, 2262 -> 2750 tests, no npm dependencies.

## Prioritized list

| # | Item | Type | I | R | E | Priority |
|---|------|------|---|---|---|----------|
| 1 | Firebase SDK still loaded from Google's CDN, pinned at 10.14.1 (old major version). Open since October. The service worker caches it, so mainly a risk for new installs and for security fixes that are missed | Dependency | 3 | 3 | 2 | 24 |
| 2 | Back-ups live only on mijn.host, the same host as the app. No off-site copy and no restore script found in the repo; a full restore has never been tried | Infra | 2 | 4 | 2 | 24 |
| 3 | Database rules are published by hand (paste in the Firebase console). Nothing checks that live equals `firebase/firestore.rules`; the 6 rules test files need the emulator and do not run in CI | Infra/Test | 3 | 4 | 3 | 21 |
| 4 | Old site https://mveen.github.io/AZ-Carpool/ is still live on the live database: a second, unguarded entrance that skips the test -> smoke -> live chain. `index.html` still points at that address and is rewritten at build | Infra | 2 | 3 | 2 | 20 |
| 5 | Local working folder: `backups/` holds live database dumps (personal data) and `test-key.json` (a service account key) inside the repo folder. Ignored by git and never committed (history checked), but one mistake away. Local `main` is 3 versions behind; `.claude/` is not in `.gitignore` | Infra | 1 | 3 | 1 | 20 |
| 6 | Robot smoke test runs in Chromium only. Parents use iPhones, the owner has no iOS device, so Safari problems are found by users | Test | 2 | 3 | 2 | 20 |
| 7 | "Temporary" switches that became permanent: `COORDINATOR_ONLY = true` (push test), `INSTALL_PROMPT_ENABLED = false` (install sheet shipped but off), push cron "only for the test phase" | Code | 2 | 2 | 2 | 16 |
| 8 | README (89 KB) is a changelog. Its *Deploy* section still describes uploading by hand to GitHub Pages (cache v16). Claude sessions read this as truth | Docs | 2 | 2 | 2 | 16 |
| 9 | Dead material: about 139 of 1689 text keys (8%) are used nowhere, about 35 CSS classes likewise, comments mention the removed `legacy.css`, `deploy/uitleg-weekrooster/` has a frozen copy of `components.css` from 27 Oct. No test guards this. About 20 texts still say "meiden" | Code | 2 | 1 | 2 | 12 |
| 10 | Inline `style="`: 179 left (ui-beheer 72, ui-ride-log 24, ui-profile 21, unchanged since October), while the test allows 220, so 41 new ones could slip in | Code | 2 | 2 | 3 | 12 |
| 11 | Very large functions: `renderBeheer` 294 lines, `renderMyWeek` 230, `attachDeviationHandlers` 174, `renderDirectionStandard` 142, `startDataListeners` 103. `ui-beheer.js` 987 lines, `data.js` 982 | Code | 3 | 3 | 4 | 12 |
| 12 | No lint or type check; 19 silent `catch {}` blocks (ui-common 4, data 3, push-data 3) | Code | 2 | 2 | 3 | 12 |

## Remediation plan (alongside feature work)

**Phase 1, small and safe (1 PR + local tidy-up)**
- Move `backups/` out of the repo folder; add `.claude/` to `.gitignore`; bring local `main` up to date. (#5)
- Lower the inline-style limit from 220 to the real count. (#10, 5 minutes)
- Remove dead text keys and CSS classes, fix stale comments, add a test "every text key is used". (#9)
- Rewrite the README *Deploy* section to today's route. (#8, first part)

**Phase 2, next 2-3 PRs, each first on test.azcarpool.nl**
- Self-host the Firebase SDK and move to the current version. Also one less Google dependency at runtime. (#1)
- Back-up: nightly copy to a second place (EU) and a restore script, proven once against `az-carpool-test`. (#2)
- Add WebKit (Safari engine) to the smoke test. (#6)

**Phase 3, needs an owner decision**
- Switch GitHub Pages off or make it a redirect to azcarpool.nl. (#4)
- Push test and install prompt: roll out, or remove. (#7)
- Rules: automatic publish from the deploy workflow, or at least a CI check "live rules = repo rules", plus the emulator tests in CI. (#3)

**Phase 4, touch-it-fix-it**
- When a big function is changed anyway: split it first (`renderBeheer` per card, as done for `ui-weekrooster-*`). Convert inline styles in the same PR. (#10, #11)
- ESLint with two rules (no-undef, no-unused-vars) in CI; give each silent catch a line in the error log. (#12)

## Not debt (leave alone)

Test suite and lock file, design-rules test, CACHE_NAME check, additive-only database rule, zero npm dependencies, hand-written cron libraries (small, checked by `selftest` at every deploy).

## Caveats

Read from the code and docs only. Not checked: the live host (cron lines, files in `~/azcarpool-data`), GitHub settings (branch protection, secrets), the Firebase console (which rules are live), the rules emulator tests. Counts of dead keys and classes come from a text search; names built at runtime make the CSS count an upper bound. Scores are judgement calls.
