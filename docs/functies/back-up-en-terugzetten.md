# Back-up en terugzetten

What is saved where, how the copy on the owner's own computer works, and how a back-up is put back. Decided 2026-11-14 (tech-debt audit): the back-ups used to live only on the host, the same place as the app.

## Two places

| Where | What | How often | Kept |
|---|---|---|---|
| Host (mijn.host), `~/azcarpool-data/backups/` | `cron/backup.mjs` (see README, *Cron jobs on the host*) | every night | last 30 days + the 1st of each month for a year |
| The owner's Mac, `~/azcarpool-backup/` | `scripts/offsite-backup.mjs` | once a day | only the newest (rolling; owner's choice: no history needed) |

Both read the database themselves and write the same file format: `firestore-YYYY-MM-DD.jsonl.gz`, one document per line in Firestore's own format (`{path, name, fields, createTime, updateTime}`). The Mac does not copy from the host: it reads the database directly, so it still works when the host (or the account there) is gone. That costs one full read of the database per day (about 300 documents on 2026-11-02).

## The copy on the Mac

- **Set up / update:** in Terminal, in the repo folder: `bash scripts/install-mac-backup.sh`. It copies the script and what it imports to `~/azcarpool-backup/code/`, writes the schedule `~/Library/LaunchAgents/nl.azcarpool.backup.plist`, makes a copy at once and only then switches the schedule on. Run it again after a change to `scripts/offsite-backup.mjs`, `cron/backup.mjs` or `cron/lib/`, and after installing another Node.js (the schedule holds the full path of `node`).
- **The key:** `~/azcarpool-backup/backup-key.json`, the same read-only key as on the host (role *Cloud Datastore Viewer*). The installer prints the `scp` command to fetch it when it is missing. Never in git. The script refuses a key of another project.
- **No intervention needed:** macOS starts the script at login and every hour. It does nothing (no database read) when today's file is already there. So a Mac that was off, asleep or offline makes its copy the next time it is on and online. A failed try changes nothing: the previous copy stays until a new one is written and read back.
- **When it keeps failing:** if the newest copy is older than 3 days (or there is none), a failed run shows a macOS notification. `~/azcarpool-backup/backup.log` holds the last 200 lines (what was copied, or why not).
- **Why outside Documents:** a background job that reads `~/Documents` makes macOS ask for folder permission, and fails silently when nobody answers. `~/azcarpool-backup` needs no permission. The folder is 700, the files 600: they hold personal data (names, phone numbers).
- **Switch off:** `bash scripts/install-mac-backup.sh --remove` (the files stay).

## Putting a back-up back (`scripts/restore-backup.mjs`)

```
node scripts/restore-backup.mjs --backup FILE --key KEYFILE              # dry run: what would change
node scripts/restore-backup.mjs --backup FILE --key KEYFILE --write      # write missing and different documents
... --write --delete-extra        # also delete documents that are not in the back-up
... --only families,settings      # only these collections
... --write --live az-carpool     # needed to write to the LIVE database
```

- The database is the project of the key file. The key needs the role *Cloud Datastore User* (the read-only back-up key cannot write). For live such a key does not exist on the Mac on purpose: make one in the Google Cloud console when it is really needed, and delete it afterwards.
- Documents go back exactly as saved (`setDocumentRaw`: a timestamp stays a timestamp, a whole number a whole number). Equal documents are not written. Documents that are in the database but not in the back-up stay, unless `--delete-extra`.
- After writing, the whole database is read again and compared with the back-up; a difference makes the run fail.
- A restore puts back the state of the back-up: what users entered after it is gone for the documents that are written. Do the dry run first and read the numbers.
- **In an emergency (live is damaged):** 1. switch on the maintenance page (Beheer) if the app still works; 2. take the newest good file (Mac: `~/azcarpool-backup/`, host: `~/azcarpool-data/backups/`); 3. dry run; 4. `--write --live az-carpool`, with `--only` when only part is damaged.

### Proven on the test database (2026-11-14)

Run against `az-carpool-test` with the test key: made a back-up (583 documents); a dry run right after it said *0 to write, 583 already equal*. Then three marker documents in a scratch collection were damaged on purpose (one changed, with a timestamp turned into text; one deleted; one added). Dry run: *2 to write (1 missing, 1 different), 1 not in the back-up*. Restore with `--write --delete-extra --only restoreProof`: *2 written, 1 deleted, read back and compared: equal*, and the documents were back field for field (timestamp, whole number and list included). The markers were removed afterwards.

Not proven: a full restore into an EMPTY database, and a restore on live. The logic is the same (every document is "missing"); the tests cover it with a fake database (`tests/restore-backup.test.js`).

## Tests

`tests/cron-backup.test.js` (the file format, `keep`), `tests/offsite-backup.test.js` (when a copy is made, rolling, offline, warning, the installer), `tests/restore-backup.test.js`, `tests/cron-firestore.test.js` (`setDocumentRaw`).
