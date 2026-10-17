# Tech debt audit, 2026-10-17

Scope: whole repo on `fix/weekrooster-review` (v123). Tests green: 2262 passed, 0 failed.
Score: Priority = (Impact + Risk) x (6 - Effort). Each 1-5.

## Overall

Healthy codebase. Strong test suite (84 test files, lock file, "module change needs test change" rule), design-rules ratchet, CI that blocks deploy on red tests and checks the service worker is live. Debt is mostly structural size and loose ends, not rot. No npm dependencies, so no dependency-vulnerability debt.

## Prioritized list

| # | Item | Type | I | R | E | Priority |
|---|------|------|---|---|---|----------|
| 1 | Firebase SDK loaded from gstatic CDN at pinned 10.14.1, no fallback or SRI; app unusable if CDN or version breaks | Dependency | 3 | 4 | 2 | 28 |
| 2 | Inline `style="` ratchet: ui-beheer 72, ui-ride-log 24, ui-profile 21 and more. Violates the repo's own design rule | Code | 3 | 2 | 3 | 15 |
| 3 | `ui-beheer.js` 986 lines, `data.js` 880 lines, `ui-profile.js`, `ui-schedule.js`, `ui-deviation.js` 450-550 lines. Mixed responsibilities | Code/Arch | 4 | 3 | 4 | 14 |
| 4 | Tracked strays: `TESTSCRIPT-MELDINGEN.md` and `preview.mjs` in root; untracked-but-present `.edit-tmp.py`, `Claude outputs/` (2.4 MB), `.claude-worktrees/` (5.9 MB) clutter root. `.edit-tmp.py` is not in `.gitignore` | Infra | 2 | 2 | 1 | 20 |
| 5 | Two stale locked worktrees (`fix/ui-opruimen`, `fix/agenda-iphone`) point at dead `/sessions/...` paths; 13 branches | Infra | 2 | 2 | 1 | 20 |
| 6 | Flat root: ~75 JS files in one folder; no `src/` split between pure logic, UI, cron-shared code. `dist-cron/app` copies app modules at build | Architecture | 3 | 2 | 4 | 10 |
| 7 | Single Firestore (shared live DB), no staging; `npm run preview` hits real data. Only guard is the "additive only" rule | Infra | 3 | 5 | 4 | 16 |
| 8 | `README.md` 345 lines mixing Dutch and English, many "(done)" step notes and version tags (v88, v121); acts as changelog | Docs | 2 | 2 | 2 | 16 |
| 9 | `texts-nl.js` (1424 lines) + `help-nl.js` (593) in one file each; `i18n.js` exists but only `nl` shipped. Fine now, awkward to search and review | Code | 2 | 1 | 3 | 9 |
| 10 | `innerHTML` used in ~18 UI modules (counts up to 11 in ui-common). Escaping depends on `escape.js` discipline; no lint rule | Code/Security | 2 | 3 | 3 | 15 |
| 11 | CI deploy workflow has long inline shell; deploy depends on single host (mijn.host) via rsync, no rollback automation beyond `v1-stable` tag | Infra | 2 | 3 | 3 | 15 |
| 12 | No lint/format config, no type checking (plain JS). Conventions enforced only by custom tests | Code | 3 | 2 | 4 | 10 |

Order by priority: 1, 4, 5, 7/8 (tie 16), 2/10/11 (tie 15), 3, 6/12, 9.

## Remediation plan (alongside feature work)

**Phase 1, this week (hours)**
- Add `.edit-tmp.py` to `.gitignore` or delete it. Move `TESTSCRIPT-MELDINGEN.md` under `docs/`. Move `preview.mjs` under `scripts/` (update `package.json` and README).
- `git worktree prune`; delete merged branches.
- Business case: zero risk, cleaner onboarding.

**Phase 2, next 2-3 PRs**
- Self-host the Firebase SDK files (or vendor into `vendor/`, add to `ASSETS` in the service worker). Removes CDN outage and version-drift risk. Bump `CACHE_NAME`.
- Add an `innerHTML` safety test: every `${...}` inside an `innerHTML` template must pass through `esc()`; extend `design-rules.test.js`.
- Fix README: one language, move per-version notes to `CHANGELOG.md`.

**Phase 3, opportunistic (touch-it-fix-it)**
- When editing a UI module, convert its inline `style="` to classes and lower the ratchet number in the same PR. Start with `ui-beheer.js` (72).
- Split `ui-beheer.js` by tab/section into `ui-beheer-*.js` (pattern already used for `ui-weekrooster-*`). Same for `data.js` by domain (rides, profiles, periods). Each split needs matching test file per the repo rule; move tests, do not rewrite.

**Phase 4, only if the app grows**
- Folder structure (`src/logic`, `src/ui`, `cron`). Mechanical but touches every import and the SW `ASSETS`; do in one dedicated PR.
- Add ESLint with a minimal ruleset (no-undef, no-unused-vars). Add JSDoc types + `// @ts-check` on `data.js` first.
- Staging Firebase project, so previews stop using live data.

## Not debt (leave alone)

Test suite size and lock file, snapshot tests, `v1-stable` rollback tag, additive-only DB rule, service-worker CACHE_NAME CI check.

## Caveats

Static survey only. Did not read function bodies, measure coverage, or audit Firestore rules (`firebase/firestore.rules`, 466 lines, has its own `rules-test`). Scores are judgement calls.
