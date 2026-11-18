---
title: "Story 29.9: Sync at the chosen time, on demand, with the PSU address"
type: 'feature'
created: '2026-10-17'
status: 'done'
baseline_commit: '5ecdc5782cd8c415f13110e042e7cb9f28ae53e6'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-29-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (at `00dd977fb`) syncs every connection each day at `Setting.auto_sync_time`, 02:22 by default, while `Setting.auto_sync_enabled`, on by default, holds (`app/services/auto_sync_scheduler.rb`, `settings/hostings/_sync_settings.html.erb`); its sync button only waits for a sync already running (`syncing?`); and for a bank whose `required_psu_headers` is `Psu-Ip-Address` alone it sends the browser's address, stored at `authorize` and at `callback`, on the balance and transactions calls (`enable_banking_item/provided.rb#build_psu_headers`), clearing it once the consent ends (`DataCleanerJob#clean_stale_enable_banking_psu_ips`). Archant syncs only on the first signed-in request of the day or a cron calling `POST /api/sync`, refuses the button within the hour of the last sync (`SYNC_TOO_RECENT`), and sends no PSU header.

**Approach:** Two settings rows beside « Inclure les transactions en attente », stored in `settings`; an in-process timer that reads them and runs `syncAll` at the chosen time in `APP_TIMEZONE`; the hour between two syncs removed, so only the lease refuses; the bank's required PSU headers and the browser's address stored on `bank_connections` and turned into `Psu-Ip-Address` on data calls by the connector, the address cleared daily once the consent has ended.

## Boundaries & Constraints

**Always:**
- Settings: `settings` rows `auto_sync_enabled` (on unless it holds `false`) and `auto_sync_time` (`HH:MM`, `02:22` without a row), read and saved by `services/bank-settings.ts` with `syncs_include_pending`. `GET`/`PUT /api/bank-connections/settings` carry `{ includePending, autoSyncEnabled, autoSyncTime }`, the `PUT` replacing all three; a time not matching Sure's `AUTO_SYNC_TIME_FORMAT` (`^([01]?\d|2[0-3]):([0-5]\d)$`) is a `VALIDATION_ERROR` on `autoSyncTime`; a valid one is stored with two-digit hours.
- Timer: `startSyncSchedule(deps)` in `services/sync-schedule.ts`, started by `index.ts`, wakes at least once a minute and at the chosen time. On a wake, when auto sync is on and the chosen time, read in `APP_TIMEZONE`, fell after the previous wake and less than five minutes ago, it runs `syncAll`; a wake later than that, as after the host slept, skips that day's run, as sidekiq-cron skips a missed run. No connector configured skips it without an error line. A failure is logged by its code and the timer keeps going. The first signed-in request of the day and `POST /api/sync` stay as they are.
- The hour goes: `takeLease` refuses only a held lease, `SYNC_TOO_RECENT` and `authorized_at` go (migration `0088`), the button, the first visit, the cron, the timer and a setting's sync all wait only for a running sync (`409 SYNC_IN_PROGRESS` for the button).
- A run with no linked active account stamps `last_synced_at` and clears `last_error`, as Sure's item sync completes, so no « synchronisation arrêtée » banner shows on a connection with nothing left to read.
- PSU: `bank_connections.required_psu_headers` (JSON list, `[]` by default) takes the bank's `required_psu_headers` from the listing at every start and renewal, as Sure's `start_authorization`; `bank_connections.psu_ip_address` takes the client address at a new connection's start and at the callback's claim, before the session is asked for, as Sure's `authorize` and `callback`, never at a renewal's start (Sure's `reauthorize` stores none). The address is the TCP peer, or `X-Forwarded-For` read past `TRUSTED_PROXIES`, as the sign-in limit reads it, IPv6 kept whole; none believable keeps the stored one. The connector sends `Psu-Ip-Address` on `GET /accounts/{uid}/balances` and `/transactions` only when the required headers, lower-cased, are non-empty and all `psu-ip-address`, and an address is stored; otherwise none, so a bank asking for more gets none. No other call carries it.
- The address is cleared once a day, at the timer's first wake of each day in `APP_TIMEZONE` and at start, on every connection whose consent has ended, and on a pending row older than the 30 minutes its `state` lives; a disconnection deletes it with the row. It is never logged nor returned by an endpoint.
- Interface (« Réglages › Banques », « Paramètres de synchronisation »), Sure's order and words: « Activer la synchronisation automatique » with « Lorsque cette option est activée, tous les comptes seront automatiquement synchronisés quotidiennement à l'heure spécifiée. », a switch saved on change; « Heure de synchronisation (HH:MM) » with « Spécifiez l'heure à laquelle la synchronisation automatique doit se produire. », a time field disabled while auto sync is off, saved when it loses focus with a changed value. Each save toasts « Paramètres mis à jour »; a refused time toasts Sure's « Format d'heure de synchronisation invalide. Veuillez utiliser le format HH:MM (ex. 02:30). » and the field returns to the saved time.
- AD-18 changes with this story: the schedule, the removed hour and the PSU headers; `docs/sure-parity.md` « Schedule » and « PSU headers on data calls » read Parity; `docs/deployment.md`, `docs/hosting.md`, `docs/security-model.md` and `AGENTS.md` describe the timer, the button and the address sent.

**Never:** no `AUTO_SYNC_*` environment variables (the interface sets both, and `.env.example` gains nothing); no change to which connections `syncAll` or the first visit select; no PSU header on `/auth`, `/sessions` or `/aspsps`; no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Timer fires | on, 02:22, Europe/Paris, wake at 02:22:00 local | `syncAll` runs once | a failure is logged, timer re-armed |
| Timer off | `auto_sync_enabled` false | nothing runs | none |
| Time moved | 02:22 changed to 07:00 at 03:00 | runs at 07:00 that day | none |
| Host slept | wake at 08:00, last wake 01:00 | no run that day | none |
| No connector | no credentials | no run, no error line | none |
| Button within minutes | synced 5 minutes ago | syncs | `409 SYNC_IN_PROGRESS` only while a run holds the lease |
| Nothing linked | active connection, no active linked account | `last_synced_at` stamped, `last_error` cleared | none |
| IP-only bank | `required_psu_headers` `["psu-ip-address"]`, address stored | `Psu-Ip-Address` on balances and transactions | none |
| Other headers | `["psu-ip-address", "psu-user-agent"]` | no PSU header | none |
| No address | IP-only bank, address null | no PSU header | none |
| Consent ended | `consent_expires_at` past | address cleared at the next daily clean | none |
| Bad time | `PUT` `autoSyncTime: "24:00"` | refused | `400 VALIDATION_ERROR`, field `autoSyncTime` |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/bank-settings.ts` -- the two new rows beside `syncs_include_pending`.
- `packages/api/src/schemas/bank-connections.ts` -- `bankSyncSettingsSchema` with the three fields and Sure's time format.
- `packages/api/src/services/sync-schedule.ts` (new) -- `startSyncSchedule`: the minute wake, the run at the chosen time, the daily address clean.
- `packages/api/src/domain/dates.ts` -- the instant of a local time on a day in a zone, the way `startOfDay` reads offsets.
- `packages/api/src/services/sync.ts` -- `takeLease` without the hour, `refusal` and `anyInterval` gone, the empty run stamped, the connection's PSU context passed to the connector.
- `packages/api/src/connectors/bank-connector.ts`, `connectors/enable-banking/client.ts`, `connectors/enable-banking/schemas.ts` -- `requiredPsuHeaders` on an institution, a `PsuContext` on `fetchBalance` and `fetchStatement`, Sure's `build_psu_headers`.
- `packages/api/src/services/bank-connections.ts` -- headers stored at start and renewal, the address at start and callback; `clearEndedPsuAddresses`.
- `packages/api/src/lib/client-address.ts` -- the client address for the PSU header.
- `packages/api/src/routes/bank-connections.ts` -- the address read from the request for start and callback.
- `packages/api/src/index.ts` -- starts the timer.
- `packages/api/src/lib/errors.ts`, `packages/app/src/locales/fr.json` -- `SYNC_TOO_RECENT` gone; settings strings.
- `packages/data/schema/bank-connections.ts`, `packages/data/drizzle/0088_*.sql` -- the two columns, `authorized_at` dropped.
- `packages/app/src/routes/_authed.settings.banks.tsx`, `hooks/useBankConnections.ts`, `routes/_authed.settings.banks_.$connectionId.tsx` -- the two rows; `SYNC_TOO_RECENT` handling gone.
- Tests: `services/sync-schedule.spec.ts` (new), `services/sync.spec.ts`, `services/bank-connections.spec.ts`, `connectors/enable-banking/client.spec.ts`, `routes/bank-connections.spec.ts`, `routes/sync.spec.ts`, `domain/dates.spec.ts`, `packages/data/migrate.spec.ts`; e2e `bank-connections.spec.ts`, `duplicates.spec.ts`.
- Docs: `docs/architecture.md` AD-18, `docs/sure-parity.md`, `docs/deployment.md`, `docs/hosting.md`, `docs/security-model.md`, `AGENTS.md`.
- Sure, read-only, at `00dd977fb`: `app/services/auto_sync_scheduler.rb`, `app/models/setting.rb`, `app/controllers/settings/hostings_controller.rb`, `app/views/settings/hostings/_sync_settings.html.erb`, `config/locales/views/settings/hostings/fr.yml`, `app/models/enable_banking_item/provided.rb`, `app/models/enable_banking_item.rb` (`with_stale_psu_ip`, `start_authorization`), `app/controllers/enable_banking_items_controller.rb` (`authorize`, `callback`, `reauthorize`), `app/models/enable_banking_item/importer.rb`, `app/jobs/data_cleaner_job.rb`.

## Tasks & Acceptance

**Execution:**
- [x] Vitest first, failing: the timer runs `syncAll` at the chosen time in `APP_TIMEZONE`, not when off, not after a missed wake, at a moved time, and clears ended addresses once a day; the local-time instant across both DST changes; the button syncs minutes after a sync and refuses only a held lease; an empty run stamps; the settings round-trip and refuse a bad time; the address and headers stored at start, renewal and callback; the header sent on balances and transactions for an IP-only bank and never otherwise; the address never in a response or a log line.
- [x] Migration `0088` and schema; settings service and schema; dates helper; timer; sync without the hour; connector PSU context; address capture in the routes; `index.ts`.
- [x] Interface rows, hook, locale strings; `SYNC_TOO_RECENT` removed from errors, locale and pages.
- [x] Playwright: set the sync time and turn auto sync off and on in « Réglages › Banques », read back after a reload; the second sync after linking syncs; the hour-only `age` calls and `syncedHoursAgo` go.
- [x] AD-18, parity rows, deployment, hosting, security model, `AGENTS.md`; `deferred-work.md` items resolved.

**Acceptance Criteria:**
- Given « Activer la synchronisation automatique » on and « Heure de synchronisation (HH:MM) » at its time, when that time comes in `APP_TIMEZONE`, then the server syncs every active connection from its own timer; the first visit of the day and `POST /api/sync` still sync.
- Given a connection synced minutes ago, when « Synchroniser » is pressed, then it syncs; only a running sync makes it wait.
- Given a bank whose required PSU headers are `Psu-Ip-Address` alone, when the browser starts the authorisation or returns from it, then its address is stored, sent on balance and transactions calls, and cleared once the consent ends; a bank needing other headers gets none.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then Vitest covers the timer, a sync within the hour and the headers, Playwright sets the sync time, and no request reaches Enable Banking.

### Review Findings

Second pass, `bmad-code-review` (four layers) over the committed branch.

- [x] [Review][Patch] The end-to-end server's own timer could sync every test connection at 02:22: `setup` now turns auto sync off through the settings route, and the settings test starts from off and leaves it off [packages/app/e2e/auth.setup.ts, packages/app/e2e/bank-connections.spec.ts]
- [x] [Review][Patch] No test of a time just before midnight run on a wake just after it, which only the day before's slot catches [packages/api/src/services/sync-schedule.spec.ts]
- [x] [Review][Patch] `.env.example` still described sync without the daily time, `APP_TIMEZONE` as balances only, and `TRUSTED_PROXIES` as sign-in limits only [.env.example]
- [x] [Review][Patch] The security model's « Trusted proxies » and the PSU paragraph did not say a proxy left out, or Tailscale, decides the address the bank receives [docs/security-model.md, docs/hosting.md]
- [x] [Review][Patch] `docs/deployment.md` counted « Synchroniser » among the four unattended reads, though the user asks for it [docs/deployment.md]
- [x] [Review][Patch] The export's reason for leaving `bank_connections` out did not name the stored address [packages/api/src/services/ledger/export.ts]
- [x] [Review][Defer] A stored `auto_sync_time` that no longer reads falls back to 02:22 untested [packages/api/src/services/bank-settings.ts] — deferred: only the validated `PUT` writes the row

Rejected:
- `low` A server restarted within the five minutes after the time skips that day: a restart is a missed wake, and the first visit syncs that day anyway.
- `low` `psu` optional on the port's two reads: the one caller that missed it is fixed and tested; making it required touches every test call for no new behaviour.
- `low` `breaking-change` label: an upgrade needs no action; a host with its own cron reads twice a day until it removes it, which the pull request and `docs/deployment.md` say.
- `low` `saveBankSyncSettings` falls back to 02:22 for a time the schema already refuses: no caller bypasses the schema.
- `low` The time field saves on blur only: a time typed and left by navigation is lost, as an unsubmitted form is.
- `false` A failed renewal callback still stores the new address: Sure's `callback` updates `last_psu_ip` before `complete_authorization` as well.
- `low` A private, loopback or tailnet address is sent: Sure sends `request.remote_ip` whatever it is; the docs now say so.
- `low` An active connection without a consent end keeps its address: every Archant session stores `access.valid_until`.
- `false` A failed renewal start leaves the new required headers: Sure stores the ASPSP metadata before calling the provider on purpose.
- `low` One unreadable `required_psu_headers` entry empties the list: the bank then gets no header, Sure's behaviour for a list it cannot satisfy.
- `false` `index.ts` discards the schedule's stop handle on SIGTERM: the server installs no SIGTERM handler by design and the timer is `unref`'d.
- `low` A wall clock stepping back during a long run could run the day twice: NTP slews rather than steps on a running host; a second sync is harmless beside the lease.
- `low` A connection with nothing linked shows a last sync that read nothing: Sure's item sync stamps the same way, which is what lifts the stopped-sync banner.

## Design Notes

Assumptions taken alone, each settled by Sure or by Archant's model:

- The time is read in `APP_TIMEZONE`, the story's wording; Sure stores `Current.family.timezone` beside it, which Archant's single household holds in `APP_TIMEZONE`. On the spring change a 02:22 that does not exist runs at 03:22, the next existing minute; on the autumn change the second 02:22, once.
- A timer, not a cron library: one `setTimeout` re-armed at most a minute ahead, because a long timer drifts by the time a host sleeps. Running a missed day late would add a sync to a day the first visit already syncs, and a PSD2 consent allows four unattended reads a day, so a wake more than five minutes late skips it, as sidekiq-cron does.
- The address clean runs at the first wake of each day and at start, where Sure's `DataCleanerJob` runs at 03:00: a host asleep at 03:00 would otherwise keep it. A pending row older than 30 minutes is cleared too, where Sure waits for its `requested_consent_valid_until`: Archant refuses its callback after 30 minutes, so nothing can use the address.
- The address is stored in clear, as Sure's `last_psu_ip` (not among its encrypted attributes): it is no credential; it is never logged nor returned.
- No `Psu-Ip-Address` on `/accounts/{uid}/details`: Archant never calls it, and Sure's importer sends PSU headers only on balances and transactions.
- The `PUT` replaces the three settings, Archant's settings convention (`/api/prices/settings`); the interface sends the saved values with the one changed.
- The time field saves on blur rather than on each keystroke: a time input fires a change per segment typed, and Sure's form would save each one.
- `authorized_at` existed only to let one sync through the hour after a renewal; with the hour gone it is dropped.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | `linkBankAccounts` reads the balance without the connection's PSU context | medium | patch | The link's `fetchBalance` had no third argument; it now passes the stored headers and address, with a test on the captured `/balances` request. |
| 2 | The daily address clean marks the day done before it runs, so one failure skips it until tomorrow | low | patch | `cleanedOn` set only after `clearEndedPsuAddresses` resolves. |
| 3 | A throw outside the wake's try blocks leaves the timer unarmed for good | low | patch | `arm(next)` moved to a `finally`. |
| 4 | A settings read failure logs the same message as a failed sync | low | patch | Logged under its own message. |
| 5 | The refused-time toast and the field's return to the saved time are untested | low | patch | The Playwright settings test clears the field, blurs, and checks Sure's toast and the saved time. |
| 6 | Without `TRUSTED_PROXIES` the bank receives the proxy's address, and the docs justify the variable by sign-in limits only | low | patch | One sentence in `docs/deployment.md` « Behind a reverse proxy ». |
| 7 | Existing installs start syncing at 02:22 by themselves, so a cron already calling `POST /api/sync` adds a second read | low | patch | One sentence in `docs/deployment.md` « Scheduled synchronisation »; the pull request says it too. |
| 8 | A private, loopback or Tailscale address may be stored and sent | low | reject | Sure sends `request.remote_ip` whatever it is; Rails resolves it the same way from the peer and the proxies it trusts. |
| 9 | The address sent on unattended syncs may be months old | low | reject | Sure's `build_psu_headers` sends `last_psu_ip` on every sync, scheduled ones included. |
| 10 | A pending attempt's 30 minutes are counted on `updated_at`, not `authorization_started_at` | low | reject | Same clock as the abandoned-attempt deletion in `startConnection`, which the callback's claim bumps on purpose. |
| 11 | The e2e server's timer may fire at 02:22 during a run | low | patch | Fixed in the second pass: `setup` turns auto sync off through the settings route. |
| 12 | Clicking the auto sync switch right after typing a time is lost while the time saves | low | reject | The switch is disabled during the save, so no stale payload is sent; the click is merely ignored. |
| 13 | The scheduled run logs only a connection count | low | reject | Each connection's outcome is already logged by `runLeased` with its trigger. |
| 14 | `index.ts` never stops the schedule on SIGTERM | false | reject | `index.ts` installs no SIGTERM handler by design; the timer is `unref`'d. |
| 15 | The timer's DST behaviour is tested through `instantAt` only | low | reject | `dueTimes` only maps days through `instantAt`, which covers both changes. |
| 16 | « an account the bank fails to list » lost its « Jamais synchronisée » check | low | reject | The empty first run now stamps the connection, as Sure's; the test still asserts the card's error. |
| 17 | `psuAddress` relies on `getIP`'s loopback fallback in test and development | low | reject | The comparison follows `getIP` itself, so a change of fallback changes both sides. |
| 18 | Spec `in-review` while sprint status reads `in-progress` | false | reject | Both move to `done` at the workflow's end, in this pull request. |
| 19 | `AGENTS.md` omits the clean at start and of pending attempts | low | reject | It states the rule's purpose; `docs/architecture.md` AD-18 and the security model carry the detail. |
| 20 | An IPv6 address is sent expanded, not compressed | low | reject | Both forms are the same address; any parser reads either. |
| 21 | A failed renewal start leaves the new required headers stored | false | reject | Sure's `start_authorization` stores the ASPSP metadata before calling the provider, « so it's available even if auth fails ». |
| 22 | An active connection without a consent end keeps its address | low | reject | Every Archant session stores `access.valid_until`; no active row lacks it. |
| 23 | `index.ts` starting the timer is untested | low | defer | One line in the entrypoint; testing it needs a clock in the e2e server. |

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.
