---
title: 'Story 13.6: A copy before every migration'
type: 'feature'
created: '2026-09-27'
status: 'done'
baseline_commit: '2da63e343c2518f57e11b8ca91d1b48d85291f93'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The server migrates the database at start with no copy. Migrations only go forward, so an upgrade that goes wrong leaves a file the previous image cannot open, and « Upgrading » in `docs/deployment.md` still describes `git pull` and a local build.

**Approach:** Before `runMigrations`, when a pending migration exists on a local file, the server writes a `VACUUM INTO` copy to `backups/` beside the database, keeps the five most recent, and exits without migrating if the copy fails. « Upgrading » and « Backups » describe the pinned tag, `docker compose pull`, the copy, and going back with it.

## Boundaries & Constraints

**Always:**
- Copy only when the URL starts with `file:`, is not `:memory:`, the database has a `__drizzle_migrations` table, and at least one journal entry is newer than its last `created_at`. Pending is decided exactly as `drizzle-orm/libsql/migrator` decides it: `readMigrationFiles` from `drizzle-orm/migrator`, compared on `folderMillis`.
- Name: `<stem>-<YYYYMMDDTHHMMSSZ>-<version>.db` in `<database dir>/backups/`, `<stem>` being the database file name without extension, `<version>` being `APP_VERSION` or `dev` when null. The timestamp comes first so a name sort is a time sort.
- `VACUUM INTO` writes `<name>.partial`, renamed to `<name>` on success; a failed copy removes its partial file. The path is bound as a parameter, never interpolated.
- After a copy, delete the `<stem>-*.db` files matching that pattern beyond the five most recent. A pruning failure is a `warn` and the server goes on.
- A failed copy (directory, disk space, permission, SQLite error) is a `fatal` log with the error code and the backup directory, then `process.exit(1)` before `runMigrations`.
- One `info` log per start: the copy's file name and how many copies remain; or why nothing was copied (no pending migration, a remote database, a new database).
- `backups/` joins `.gitignore` and `.dockerignore`, since `local.db` sits at the repository root.

**Never:** no scheduled or off-site backup, no new environment variable, no restore command in the application, no copy from `pnpm data migrate:local`, no copy of a remote database, no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Upgrade | file migrated up to the next-to-last migration, `APP_VERSION=1.2.0` | `backups/archant-<ts>-1.2.0.db` holds the pre-migration rows, then migrations run | — |
| Development build | same, `APP_VERSION` unset | name ends in `-dev.db` | — |
| Up to date | every migration applied | no file written, log says no pending migration | — |
| New database | no file, or no `__drizzle_migrations` | no file written, log says new database | — |
| Remote | `libsql://…` | no file written, log says remote database | — |
| Sixth copy | five copies present | the oldest goes, five remain; other files in `backups/` untouched | pruning error → `warn`, start goes on |
| Copy fails | `backups` is a regular file, or `VACUUM INTO` throws | exit code 1, `fatal` log, database still at its previous migration, no partial file left | — |

</frozen-after-approval>

## Code Map

- `packages/data/migrate.ts` -- export `migrationsFolder`; add `pendingMigrations(db)` returning `"new" | "none" | number`. `runMigrations` stays unchanged.
- `packages/data/backup.ts` (new, exported as `./backup` in `package.json`) -- `copyBeforeMigrating({ url, authToken, version, now })` returns `{ copied: string, kept: number } | { skipped: "remote" | "new" | "up-to-date" }` and throws on a failed copy. Handles `file:relative` (resolved against the working directory, as libSQL does) and `file:///absolute`. Opens and closes its own client through `createDb`. `sql` template with a bound path: no Drizzle builder exists for `VACUUM INTO`.
- `packages/data/migrate.spec.ts:318-340` -- the truncated-journal helper; move it to `packages/data/testing/migrations.ts` (exported as `./testing/migrations`) as `migrateAllButLast(url)`, without importing vitest, so the backup spec, `index.spec.ts` and the CI `image` job share it.
- `packages/api/src/index.ts:47-50` -- call `copyBeforeMigrating` before `runMigrations`, log the outcome, `fatal` and exit on a throw, as `portTaken` does.
- `packages/api/src/index.spec.ts` -- spawns the entrypoint with a temp `DATABASE_URL`; the existing `listening` helper and log-line parsing apply.
- `.github/workflows/ci.yml:160-165` -- after the restart step: `docker compose stop`, then `docker compose run --rm --no-deps --workdir /app/packages/data --entrypoint node archant` removing `/data/archant.db*` and running `migrateAllButLast`, then `up --detach --wait --pull never`, then `ls /data/backups` shows exactly one `archant-*-0.0.0.db` and health answers ok. The read-only root leaves `/tmp` for the journal copy.
- `docs/deployment.md:91-129` -- « Upgrading »: `ARCHANT_VERSION` pinned, `docker compose pull`, `up --detach --wait`, the copy in `/data/backups`, going back (stop, restore the copy with the existing recipe from `/data/backups`, previous tag, up); checkout path kept. « Backups »: the automatic copy, five kept, same disk so no substitute for the manual `VACUUM INTO` copy.
- `AGENTS.md` « Deployment » -- one sentence: the server copies the database to `backups/` before a pending migration and refuses to migrate without the copy.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/testing/migrations.ts`, `migrate.spec.ts` -- move the helper; existing migration tests still pass.
- [x] `packages/data/backup.spec.ts` -- failing specs for every matrix row, `now` injected for the name and the pruning order.
- [x] `packages/api/src/index.spec.ts` -- failing specs: a server started on a next-to-last database logs the copy before « migrations applied » and leaves one file in `backups/`; with `backups` a regular file it exits 1 and the database keeps its migration count.
- [x] `packages/data/migrate.ts`, `backup.ts`, `package.json` -- the pending check and the copy.
- [x] `packages/api/src/index.ts` -- the call, the logs, the exit.
- [x] `.gitignore`, `.dockerignore` -- `backups/`.
- [x] `.github/workflows/ci.yml` -- the pending-migration restart step; `actionlint` passes.
- [x] `docs/deployment.md`, `AGENTS.md` -- as in the code map; `pnpm lint:format` passes and `#connecting-a-bank` survives.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and the CI `image` job run, then every matrix row has an automated test, and a container restarted onto a volume with a pending migration leaves a copy in `/data/backups`.
- Given `docs/deployment.md`, when a self-hoster reads « Upgrading » and « Backups », then they find the pinned tag, `docker compose pull`, the automatic copy, and the way back by restoring it.

## Implementation Notes

- The helper at `migrate.spec.ts` was `migratedBefore(tag)`; `testing/migrations.ts` exports it as `migrateBefore(url, tag)` beside `migrateAllButLast(url)`, both copying the journal to the system temporary directory.
- `pendingMigrations` reads `sqlite_master` and `__drizzle_migrations` through `sqliteTable` declarations local to `migrate.ts`, outside `schema/`, rather than raw SQL.
- A failed pruning comes back as `pruneFailed` (the error code) on the copied outcome; `index.ts` logs it at `warn`. `BackupError` carries `code` and `directory` for the `fatal` line.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| A non-copy error (`SQLITE_NOTADB`, `SQLITE_BUSY`) gets the disk-space advice (blind, edge) | medium | `createDb` and `pendingMigrations` sit outside the `BackupError` wrapping; `index.ts` gives every throw the same message. | patch |
| A `.partial` left by a killed copy is never removed (blind) | medium | Its timestamp differs from the next copy's, and `prune` matches `.db` only; a database-sized file accumulates per crash. | patch |
| A clock behind existing copies prunes the copy just written (edge) | low | Names sort by timestamp; one guard line keeps the new copy. | patch |
| A percent-encoded `file:` path is skipped as new, and migrated without a copy (blind, edge) | low | libSQL decodes the path, `databasePath` does not, so `existsSync` misses it. Direct correction. | patch |
| « backups is a regular file » test asserts nothing about what is left (blind) | low | Title promises it; two assertions. | patch |
| The chmod test cannot observe partial removal (verification) | low | SQLite fails before creating the partial; the title claims more than the test proves. Retitled; a mid-write failure is costly to provoke. | patch |
| The pruning `warn` and the start going on have no entrypoint test (verification, edge) | medium | Pre-verified: only `backup.spec.ts` sees `pruneFailed`. | patch |
| The failing-copy entrypoint test can hang if the copy succeeds (edge) | low | `outcome` waits for exit; a `finally` kill. | patch |
| « Upgrading » says pin in `.env` but shows `export` (blind) | medium | A new shell forgets it, so after a rollback the next `up` returns to `latest` and migrates again. | patch |
| Disk cost of five copies not documented (blind) | low | Full-disk is the case that stops the start; one sentence. | patch |
| Two copies in one second overwrite each other (blind) | low | Needs two pending-migration starts in one second, which only a crash loop gives, and both copies hold the same state. | rejected |
| No test that the copy holds writes still in the WAL (blind) | false | `VACUUM INTO` reads through the WAL, and opening a database after a crash replays it before the copy. | rejected |
| The documented rollback is not exercised in CI (blind) | low | The recipe is the existing restore from another path; exercising it adds a CI phase. | rejected |
| `AGENTS.md` does not list the new `image` check, nor that `testing/migrations.ts` must stay free of dev dependencies (blind) | low | Agent-context file; the constraint is stated in the file's own comment. | defer |
| A test helper ships in the image and the package exports (blind) | false | Deliberate: the CI `image` job runs it inside the production image; the file says why. | rejected |
| Backup permissions follow the umask (blind) | low | Same mode as the database file beside it; restricting only the copies protects nothing the database does not already expose. | rejected |
| Spec and sprint status disagree (blind) | false | Transitional; step 5 syncs `sprint-status.yaml`. | rejected |
| A bare `:memory:` URL logs « remote » (edge) | low | `DATABASE_URL=:memory:` is not a configuration anyone runs the server with. | rejected |
| A cyclic `cause` chain loops `errorCode` forever (edge) | low | Neither Node nor libSQL builds cyclic causes; a guard adds state for an unseen case. | rejected |

## Design Notes

Sure copies nothing: `bin/docker-entrypoint` runs `db:prepare` and leaves backups to a Postgres sidecar. The epic goes further on purpose, because a single SQLite file can be copied by the application itself.

A new database is skipped although every migration is pending: it holds nothing to lose, and copying it would leave an empty file on every fresh install and every end-to-end run.

The copy is named after the version that is about to migrate, not the one that wrote the file, because the server cannot know the latter. « Upgrading » says so: to go back from `1.3.0`, restore the copy whose name ends in `-1.3.0.db` and pin the tag you came from.

A crash loop after a failed migration makes a new copy at every restart. Each holds the same pre-migration state, since a failed migration rolls back, so pruning the older ones loses nothing newer than what is kept.

## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- expected: green, including `backup.spec.ts` and `index.spec.ts`.
- `pnpm lint:code && pnpm lint:format` -- expected: green.
- `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.11` -- expected: no finding.
