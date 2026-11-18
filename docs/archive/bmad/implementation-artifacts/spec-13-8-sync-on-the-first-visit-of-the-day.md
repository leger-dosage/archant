---
title: 'Story 13.8: Sync on the first visit of the day'
type: 'feature'
created: '2026-09-29'
status: 'done'
baseline_commit: '90a2444f5376d58f9102effe40dd4ebf8447bc36'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Banks sync only from the host's daily `POST /api/sync` cron or the « Synchroniser » button. On a machine that sleeps, the cron misses its run and the owner opens stale accounts.

**Approach:** As AD-18 and Sure's `AutoSync` say: the first authenticated `/api` request of the day, in `APP_TIMEZONE`, takes the lease of each active connection with no sync attempt since the start of that day, answers, then syncs those connections beside it in the same process. The interface shows the sync running and refetches when it ends. `POST /api/sync` stays, optional.

## Boundaries & Constraints

**Always:**
- An attempt is a run that took the lease, whatever its trigger or outcome. A new nullable column `bank_connections.sync_attempted_at` (epoch ms) is stamped by `takeLease` itself, in the same `UPDATE`.
- Eligible: `status = 'active'`, consent not ended, `sync_attempted_at` null or before the start of today in `APP_TIMEZONE`, and `takeLease`'s own conditions (lease free, one-hour spacing). A failed attempt today, an ended consent, a held lease, or a sync within the hour starts nothing.
- The request awaits only the selection and the leases, local SQLite writes; the Enable Banking calls run after it answers. Two concurrent requests race on `takeLease`'s single `UPDATE`, so one connection syncs once.
- The detached work never rejects unhandled: an error is logged with the connection id and code, as `syncAll` does. Trigger `"auto"` joins `SyncTrigger`; refusals are silent, like `"cron"`.
- Nothing runs when Enable Banking is not configured, and nothing on public paths (`isPublicPath`).
- `BankConnectionRecord` gains `syncing: boolean`, true while a lease younger than `LEASE_MS` is held. `useBankConnections` polls every 2 seconds while any connection is `syncing`; when that goes back to false, it invalidates what `useSyncBankConnection` invalidates.
- While a connection syncs, `BankAlerts` shows « Synchronisation en cours » on every page, as a `status` line, and the connection page's « Synchroniser » is disabled with the same words.

**Never:** no setting to turn it off, no new environment variable, no timer or scheduler inside the server, no change to the one-hour spacing, to the renewal exception or to `POST /api/sync`'s answer, no new dependency.

## I/O & Edge-Case Matrix

| Scenario | State | Expected |
|----------|-------|----------|
| First visit | active, last attempt yesterday, last sync 20 h ago | lease taken before the answer, sync runs after it, `sync_attempted_at` today |
| Second tab | same, concurrent request | one sync only |
| Failed today | attempt at 08:00 today, `last_error` set | nothing until tomorrow; button still works |
| Cron ran late | cron synced 23:30, visit at 00:10 | `SYNC_TOO_RECENT` skip, retried by a request after 00:30 |
| Ended consent | `consent_expires_at` past | nothing |
| Midnight | attempt 23:50 Paris, request 00:05 Paris | eligible: the day is Paris's, not UTC's |
| Detached failure | connector throws | logged with `connectionId` and code, lease released, request already answered 200 |

</frozen-after-approval>

## Code Map

- `packages/data/schema/bank-connections.ts:50-55` -- add `syncAttemptedAt: integer("sync_attempted_at")` with a why-comment; `pnpm data generate` writes the migration.
- `packages/api/src/services/sync.ts:82-106` `takeLease` -- also sets `syncAttemptedAt: now`. `syncOne:303-363` -- split the lease from the run so the new `startDailySync(deps)` can await leases then run detached; keep the button and cron paths unchanged. `SyncTrigger:31` gains `"auto"`.
- `packages/api/src/services/sync.ts:407` `syncAll` -- model for the sequential loop and per-connection error logging.
- `packages/api/src/domain/dates.ts:11` -- add `startOfDay(timeZone, now): number`, epoch ms of today's midnight in `timeZone`, with `Intl` like `today()`.
- `packages/api/src/routes/middleware/auth.ts` -- `requireSession` sets no context; add a sibling middleware mounted right after it at `packages/api/src/app.ts:236`, skipping `isPublicPath`.
- `packages/api/src/services/bank-credentials.ts` `resolveBankConnector` -- gives the connector, or none when unconfigured.
- `packages/api/src/services/bank-connections.ts:60-75` `BankConnectionRecord` -- add `syncing`; `LEASE_MS:47`.
- `packages/app/src/hooks/useBankConnections.ts:68-74,172-195` -- polling and the shared invalidation list.
- `packages/app/src/components/BankAlerts.tsx:111-128`, `packages/app/src/routes/_authed.settings.banks_.$connectionId.tsx:101-172` (`SyncStatus`) -- indicator; `locales/fr.json` `banks.sync.running`.
- Tests: `packages/api/src/services/sync.spec.ts` (fake `Date`, `NOW`, `DAY`), `packages/api/src/app.spec.ts:7548` « bank sync routes »; e2e `packages/app/e2e/bank-connections.spec.ts:585-636` and its `age()` helper at `:789`, since the e2e server's clock cannot be faked; `packages/app/e2e/fake-enable-banking.ts:26-48` banks by name.
- Docs: `docs/deployment.md:233-239`, `docs/hosting.md:85-101` step 7, `docs/sure-parity.md:125` (« Sync on page load not recorded »).

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/dates.spec.ts` -- `startOfDay` across a daylight-saving change -- test first.
- [x] `packages/api/src/services/sync.spec.ts` -- every matrix row, with fake `Date` and msw; a slow msw handler proves the leases are taken before `startDailySync` resolves and the reads after -- test first.
- [x] `packages/api/src/app.spec.ts` -- an authenticated `GET` starts the sync; `/api/health` and an unauthenticated request start nothing; `syncing` in `GET /api/bank-connections`.
- [x] `packages/data/schema/bank-connections.ts` + generated migration -- the column.
- [x] `packages/api/src/domain/dates.ts`, `services/sync.ts`, `services/bank-connections.ts`, `routes/middleware/*`, `app.ts` -- server side.
- [x] `packages/app/src/hooks/useBankConnections.ts`, `components/BankAlerts.tsx`, `$connectionId.tsx`, `locales/fr.json` -- indicator, polling, refetch.
- [x] `packages/app/e2e/fake-enable-banking.ts` -- `SLOW_BANK`, whose transactions answer after about two seconds, so the indicator can be seen.
- [x] `packages/app/e2e/bank-connections.spec.ts` -- attempt aged to yesterday: opening a page shows « Synchronisation en cours », then the new lines; a page left open, aged, then refocused starts it.
- [x] `docs/deployment.md`, `docs/hosting.md`, `docs/sure-parity.md` -- the cron becomes optional, for a host that stays on; the first visit of the day syncs.

**Acceptance Criteria:**
- Given `pnpm test` and `pnpm test:e2e`, when they run, then every matrix row and every epic criterion of Story 13.8 has a test, with the clock and Enable Banking mocked.
- Given `pnpm lint:format`, when it runs, then `#connecting-a-bank` still resolves.

## Design Notes

Leases are taken before the answer, so the very response that started the sync already says `syncing: true` and the interface starts polling without a second round trip. Connections then sync one after another, as `syncAll` does. The middleware runs on `GET` only, so a button press or a disconnect that is the day's first request keeps its own lease. A household has one to three connections; a first run past ten minutes lets its successors' leases expire, which only allows a button press to double one run.

Sure's `AutoSync` runs before `authenticate_user!`, so `Current.family` is nil and it never fires; its « does sync » tests are skipped. Archant follows its rule, a sync created today counts whatever its status, not that bug.

## Implementation Notes

- `syncOne` hands its run to `runLeased`, shared with `startDailySync`; the button and cron paths are unchanged.
- `startDailySync` returns early without `encryptionKey`, before any query, and after the query when `resolveBankConnector` says the bank is unconfigured.
- `app.spec.ts` bank tests mark the day attempted after connecting (`attemptedToday`), so the first-visit sync does not race the sync each test drives.
- `dailySync` runs on `GET` requests only: a button press or a disconnect that is the day's first request keeps its own lease.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence / route |
|---|---|---|
| The day's first request being the button's `POST .../sync` or a disconnect's `DELETE` loses the lease to the middleware and answers `SYNC_IN_PROGRESS` | medium | Reachable from a tab left visible overnight, where no `visibilitychange` fires. Patch: `dailySync` runs on `GET` only, every page load reads. |
| No test proves the button and the cron stamp `syncAttemptedAt` | medium | Moving the stamp out of `takeLease` passes every test. Patch: test. |
| No test proves the middleware's `catch` keeps the request alive | medium | Removing it passes every test. Patch: test. |
| No test proves `syncing` is false past `LEASE_MS` | low | Dropping the age check passes every test. Patch: test. |
| `attemptedToday` does nothing when `own` is undefined | low | Direct fix. Patch. |
| `sure-parity.md` says « Parity » then says Sure's `AutoSync` never fires | low | Direct wording fix. Patch. |
| `hosting.md` « Nothing to do here if you skip it » reads oddly | low | Direct wording fix. Patch. |
| The serial run's comment claims concurrent `ingest` is unsafe, unproven, and the button can already run beside it | low | The claim is unverified; the code keeps the order of `syncAll`. Patch: the comment cites `syncAll` only. |
| A lease loop that throws midway leaves earlier leases unrun for ten minutes | low | Only a failing local `UPDATE` throws there; the button still works. Rejected. |
| Queued connections share one `now`, a lease can expire behind a run past ten minutes | low | One to three connections of seconds each; recorded in Design Notes. Rejected. |
| A queued connection disconnected or expired before its turn | false | `disconnectConnection` refuses a held lease, and a consent ending within the queue's seconds is negligible. Rejected. |
| A restart during the detached run spends the day's attempt | low | Seconds-wide window, the button still syncs; a fix needs a second state. Rejected. |
| The migration leaves `sync_attempted_at` null, one extra sync on upgrade day | low | Once, after the hour. Rejected. |
| Every mounted `useBankConnections` invalidates, and a sync too fast to be seen never invalidates | low | Invalidations cancel each other into one refetch; a real bank takes seconds. Rejected. |
| One select and a few `Intl` calls per authenticated request | low | A household's handful of rows. Rejected. |
| A new connection auto-synced before « Valider » can make the linking sync answer `SYNC_IN_PROGRESS` | low | The empty run lasts milliseconds while the owner chooses accounts. Rejected. |
| Other e2e tests' unlinked connections get auto-synced | low | No test asserts the line's absence; the suite passed. Rejected. |
| `role="status"` inserted with its text may go unannounced | low | Keeping it mounted needs restructuring `BankAlerts`. Rejected. |
| `AGENTS.md` omits the consent and configuration conditions | low | Agent-context file, the docs carry the detail. Rejected. |
| `durationMs` of a queued run includes its wait | low | Log only. Rejected. |
| Auto refusals are not logged | false | The spec asks for silence. Rejected. |
| Spec and sprint status disagree | false | Step 05 syncs them. Rejected. |

## Verification

**Commands:**
- `pnpm lint:code && pnpm typecheck && pnpm test` -- expected: green.
- `pnpm test:e2e` -- expected: green, new tests included.
- `pnpm format && pnpm lint:format` -- expected: green, no tracked file changed by the second run.
