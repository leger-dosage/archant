---
title: 'Story 10.5: Consent renewal and disconnection'
type: 'feature'
created: '2026-09-24'
status: 'done'
baseline_commit: '3e3542539c4c03b5b8bce9f76aa8c3cb5c2f84d2'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A bank consent lasts 90 days at most, and nothing warns before it ends: once it has, `syncOne` skips the connection silently and the button still shows « Synchronisation terminée » (`sync.ts:231`). A connection cannot be renewed without creating a second one that duplicates its bank accounts, nor removed at all (FR53, FR54).

**Approach:** Renew on the same `bank_connections` row, as Sure's `reauthorize` does, so `bank_accounts` rows and their links survive through `identification_hash`. Refuse or report an expired consent explicitly. Add one warning banner per connection above every page. Disconnect by revoking the session, turning each linked account into a manual one through the ledger with its history unchanged (AD-8), then deleting the connection row.

## Boundaries & Constraints

**Always:**
- Schema: `bank_connections.authorization_started_at` and `authorized_at`, nullable epoch ms, migration `0030_*` through `pnpm --filter @archant/data generate`. `status` values stay `pending` and `active`; « expired » is derived from `consent_expires_at`, so no table rebuild.
- Renewal: `POST /api/bank-connections/:id/renew` (session, `csrf()`) re-reads the bank from `listInstitutions(country)` by `institution_name`, stores a fresh `authorization_state` and `authorization_started_at` on the active row, and answers `{ data: { url } }`. The connection stays `active` and keeps syncing on its old session until the callback succeeds. A start failure clears the state and never deletes an active row.
- Callback: the claim accepts a `pending` or `active` row whose `authorization_started_at` is within 30 minutes (replacing the `createdAt` test). On success it writes the new encrypted `session_id`, `consent_expires_at` and `authorized_at`, and upserts `bank_accounts` on `(bank_connection_id, identification_hash)` as today, which refreshes `provider_uid` and keeps `accounts.bank_account_id`. A bank account new to the session appears unlinked; one the bank no longer lists is kept. A failure deletes the row only when it is `pending`. The old session is not revoked (Sure). New connections set both columns too.
- One-hour spacing: `takeLease` also lets a sync through when `last_synced_at < authorized_at` (AD-18's exception). After a successful renewal callback, the interface starts one sync, as it does after linking.
- Expired consent: the button answers `409 CONSENT_EXPIRED`; the cron reports `result: "consent_expired"` for that connection. Nothing is fetched, written or deleted. `errors.CONSENT_EXPIRED` in `fr.json`.
- Alert: a pure `connectionAlert(connection, now)` in `packages/api/src/domain/bank-connection-alert.ts` returns, first match wins: `consent_expired` when `consent_expires_at <= now`; `sync_stale` when `last_synced_at` is set and older than 48 hours; `consent_expiring` when `consent_expires_at` is within 14 days; else `null`. A connection never synced gets no stale alert. `GET /api/bank-connections` returns `alert` per connection.
- Banner: `BankAlerts` in `_authed.tsx`, between the header and `<Outlet />`, one strip per connection with an alert, asked only when `useBankSetup` says the provider is configured. Full width, warning colour, an icon, one sentence, one action, a close button that hides it for the browser session (`sessionStorage`, keyed by connection and alert). Wording: « Le consentement de {bank} expire le {date}. » with « Renouveler »; « Le consentement de {bank} a expiré. La synchronisation est arrêtée. » with « Reconnecter »; « La synchronisation de {bank} est arrêtée depuis le {date}. » with « Voir la connexion ». Renouveler and Reconnecter call the renew route and send the browser to the bank.
- Connection pages: `/settings/banks` shows « Consentement expiré » instead of the validity date once expired. `/settings/banks/$connectionId` gains « Renouveler le consentement » and « Déconnecter ».
- Disconnect: `DELETE /api/bank-connections/:id` (session, `csrf()`), `NOT_FOUND` for a connection that is not active, `409 SYNC_IN_PROGRESS` while a sync holds the lease (the disconnect takes it, ignoring the one-hour rule). Then, in order: decrypt the session and call `revokeAuthorization` (`DELETE /sessions/{id}`), best effort, as Sure: a failure or an undecryptable session is logged by code and does not stop the disconnect. Then `ledger.unlinkBankAccount` per linked account. Then delete the `bank_connections` row: `bank_accounts` cascade, `entry_keys.connection_id` becomes null, so a later reconnection still recognises every synced line.
- `ledger.unlinkBankAccount(deps, accountId, { origin })`, one transaction, Sure's `unlink`: when the account has a `current_anchor`, write a `reconciliation` on its date whose amount is the stored balance of that day (replacing a reconciliation already on that day), set the `opening_anchor` amount to the stored balance of the opening date, delete the `current_anchor`; clear `bank_account_id`; recompute. Every `balances` row is identical before and after. Without an anchor it only clears `bank_account_id`.
- Confirmation: `ConfirmDialog`, destructive, focus on « Annuler ». « Déconnecter {bank} ? Les {n} comptes liés deviennent des comptes manuels. Leurs transactions et leur historique sont conservés. » Success: back on `/settings/banks` with a toast.
- Logs carry ids and error codes only, never a session id. Tests never reach the network. `domain/**`, `connectors/**` and `services/ledger.ts` stay at 100 % branches.

**Never:** no per-account unlink (Sure has one; not in FR54); no new `status` value or rebuild of `bank_connections`; no `GET /sessions/{id}` call; no reaction to a consent the bank revoked early (it fails as a provider error, and the stale banner catches it after 48 hours); no email or push notice; no change to pending entries on disconnect: they stay « En attente » and in the balance, as Sure keeps them, and the user deletes them by hand; no merge or dismiss of a possible duplicate (10.6).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Expiring | consent ends in 10 days | alert `consent_expiring`, banner names bank and date | — |
| Not yet | consent ends in 15 days, synced today | alert `null` | — |
| Expired and stale | consent ended, last sync 5 days ago | alert `consent_expired` only | — |
| Stale | last sync 49 hours ago, consent valid | alert `sync_stale` | — |
| Never synced | `last_synced_at` null, 3 days old | alert `null` | — |
| Renewal | 2 linked accounts, callback succeeds | same connection id, same links, new uids, `consent_expires_at` moved | — |
| Renewal refused | bank refuses at callback | connection active, old session kept | `BANK_AUTHORIZATION_INVALID` as today |
| Sync after renewal | synced 10 minutes ago, renewed since | sync runs | — |
| Expired, button | consent ended | nothing fetched | 409 `CONSENT_EXPIRED` |
| Expired, cron | consent ended | `consent_expired`, no row changed | 200 |
| Disconnect | 2 linked accounts, pending entry | connection gone, accounts manual, `balances` identical, pending kept | — |
| Anchor day reconciled | reconciliation on the anchor's date | replaced by the stored balance of that day | — |
| Revoke fails | provider 500 or session undecryptable | disconnect completes, code logged | — |
| Sync running | lease held | nothing changed | 409 `SYNC_IN_PROGRESS` |
| Reconnect later | same bank connected again, linked to the manual account | no line duplicated | — |

</frozen-after-approval>

## Code Map

- `packages/data/schema/bank-connections.ts:24-62` -- add the two columns; `authorization_state` unique index at :60 stays. `migrate.spec.ts` checks `0030`.
- `packages/api/src/connectors/bank-connector.ts:66-84` -- add `revokeAuthorization(sessionId)`; the comment at :64 announces it.
- `packages/api/src/connectors/enable-banking/client.ts:198` -- `call()` accepts `"GET" | "POST"` and always parses JSON (:228); `DELETE` needs both loosened. Test with msw in `client.spec.ts`.
- `packages/api/src/services/bank-connections.ts` -- `startConnection` (:196) shows the institution re-read to reuse for `renewConnection`; `completeConnection` (:269) claim at :277-287, failure deletes at :298 and later; upsert at :322-349 already keeps links; `listConnections` (:367) adds `alert`; `toRecord` shape. `services/crypto.ts:33` `decrypt` is unused so far.
- `packages/api/src/services/sync.ts` -- `syncOne` (:224-276) expired branch at :231; `takeLease` (:80-100) interval clause; `syncConnection` (:288); `SyncResult` union and `routes/sync.ts:43`.
- `packages/api/src/services/ledger.ts` -- `linkBankAccount` (:502) is the model for `unlinkBankAccount`; `writeCurrentAnchor` (:464) with `null` deletes the anchor; `backwardAnchor` (:271), `lastBalanceOnOrBefore` (:186), `recomputeBalances` (:304); unique index `entries_one_reconciliation_per_day` (`schema/entries.ts:61`).
- `packages/api/src/lib/errors.ts:7-38` -- add `CONSENT_EXPIRED` (409).
- `packages/api/src/routes/bank-connections.ts` -- add `POST /:id/renew` and `DELETE /:id`; request schemas in `src/schemas/`.
- `packages/web/src/routes/_authed.tsx:130-143` -- banner slot. `components/ConfirmDialog.tsx`, `lib/error-toast.ts`, `hooks/useBankConnections.ts` (add `useRenewBankConnection`, `useDisconnectBankConnection`), `lib/query-keys.ts:69-74`.
- `packages/web/src/routes/_authed.settings.banks.tsx:237-295`, `_authed.settings.banks_.$connectionId.tsx:87-151` (`SyncStatus`), `_authed.settings.banks_.callback.tsx:70-85`. Warning colour token `banner-warning` per `DESIGN.md:122-124`. Strings under `banks` in `locales/fr.json:968`.
- `packages/web/e2e/fake-enable-banking.ts` -- add `DELETE /sessions/:id`. `bank-connections.spec.ts` already opens the database (:136-145) to move `consent_expires_at` and `last_synced_at`.
- Sure, for reference only: `app/controllers/enable_banking_items_controller.rb:76-86`, `:237-259`; `app/models/enable_banking_item.rb:324-341`, `:402-414`; `app/models/enable_banking_item/unlinking.rb`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/migrate.spec.ts`, `schema/bank-connections.ts`, `drizzle/0030_*` -- failing test for the two columns, then the migration.
- [x] `packages/api/src/domain/bank-connection-alert.spec.ts`, `bank-connection-alert.ts` -- the alert rows of the matrix, boundaries at exactly 14 days and 48 hours.
- [x] `packages/api/src/connectors/enable-banking/client.spec.ts`, `client.ts`, `bank-connector.ts` -- `revokeAuthorization` sends `DELETE /sessions/{id}` signed; a provider error throws a sanitised `AppError`.
- [x] `packages/api/src/services/ledger.spec.ts`, `ledger.ts` -- `unlinkBankAccount`: `balances` identical before and after with transactions, a pending entry on and before the anchor, an existing reconciliation earlier and on the anchor day, and for a liability; account without anchor; 100 % branches.
- [x] `packages/api/src/services/bank-connections.spec.ts`, `bank-connections.ts` -- renewal keeps connection id and links and refreshes `provider_uid`; refused renewal keeps the active row; stale state refused; disconnect order, revoke failure ignored, lease conflict, rows gone, keys kept with null connection; `listConnections` returns `alert`.
- [x] `packages/api/src/services/sync.spec.ts`, `sync.ts`, `routes/sync.ts`, `lib/errors.ts` -- button `CONSENT_EXPIRED`, cron `consent_expired` with no write, sync allowed after renewal inside the hour.
- [x] `packages/api/src/app.spec.ts`, `routes/bank-connections.ts` -- both routes need a session and `csrf()`; response envelopes.
- [x] `packages/web/src/components/BankAlerts.tsx`, `routes/_authed.tsx`, the three `settings.banks` routes, `hooks/useBankConnections.ts`, `locales/fr.json` -- banner, renew and disconnect actions, confirmation, expired label.
- [x] `packages/web/e2e/fake-enable-banking.ts`, `bank-connections.spec.ts` -- expiring banner then renewal back on the connection page with the same linked accounts and « Dernière synchronisation : à l'instant »; expired banner and the button's toast; stale banner leads to the connection; disconnect keeps the account in the sidebar with the same balance and transactions.

**Acceptance Criteria:**
- Given a consent expiring within 14 days, when I open any page, then a banner names the bank and the date with « Renouveler », and closing it hides it until the browser session ends.
- Given a renewal completed at the bank, when I return, then the connection keeps its id, linked accounts and history, and syncs once.
- Given an expired consent, when sync runs, then the connection is reported `consent_expired` and no data is deleted.
- Given a last successful sync older than 48 hours, when I open any page, then a banner says sync has stopped.
- Given a connection, when I disconnect it and confirm, then the session is revoked at Enable Banking, the connection and its session are deleted, and its accounts stay as manual accounts with an unchanged balance history.

## Implementation Notes

- `unlinkBankAccount` writes one more kind of reconciliation than the Design Notes foresee. A backward reconciliation that left a gap fixes its day and the days before it, the day after coming from the bank's side; forward, the day after starts from the reconciliation. So the day after such a reconciliation gets a reconciliation holding its stored balance, and only when the two computations disagree there. Without it, `balances` would move on the days after every user snapshot with a gap. Covered in `ledger.spec.ts` (« keeps an earlier reconciliation and the days after it, even when it left a gap »).
- A bank balance dated before the opening date puts nothing on the bank's day: the opening anchor takes the stored balance of the opening date, and no reconciliation competes with it on that day.
- A renewal whose bank the provider no longer lists answers `BANK_PROVIDER_ERROR` (`failure.status` 200) and stores no state.
- An undecryptable session is logged with the code `SESSION_UNREADABLE`, a log code only, never an API one.
- `LEASE_MS` moved from `services/sync.ts` to `services/bank-connections.ts`, which the disconnect needs and which `sync.ts` already imports.
- The return page lands on `/settings/banks/$connectionId?sync=true`; the connection page drops the flag and syncs once when a bank account is already linked, which is a renewal. A new connection has nothing linked and syncs nothing, so the first link's sync is never refused as in progress.
- `DELETE /api/bank-connections/:id` answers `{ data: { id, accounts } }`, `accounts` being the number of accounts turned manual.
- A bank account the renewed session no longer lists keeps its row and its link but gets `bank_accounts.listed = false` (migration `0030`), and `runSync` skips it: neither fetched nor counted as failed, so the connection's last sync still moves. A later session listing it sets it back to `true`. This follows Sure, whose importer syncs only the current session's accounts.
- `e2e/auth.spec.ts` « a session lost mid-use » now waits for the banners' `GET /api/bank-connections` before clearing cookies: every page asks for it after the setup answers, and a request still in flight met the lost session before the click did.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence / route |
|---|---|---|
| The renewal exception in `takeLease` is not "once": a failing post-renewal sync lets every press bypass the hour (blind, edge) | medium | `last_synced_at` moves only on a clean run, so `last_synced_at < authorized_at` stays true. Patch: the lease consumes `authorized_at`; test added. |
| A bank account the renewed session no longer lists stays linked with a stale `provider_uid`, fails every sync, and the connection goes stale (blind, edge) | medium | The intent keeps the row but does not say whether it still syncs. Sure settles it: its importer syncs only the current session's accounts and keeps the others' link. Patch: `bank_accounts.listed`, cleared on renewal for absent accounts, skipped by sync. |
| `linked` read outside the disconnect transaction (blind) | low | An account linked in between loses its link through the FK, keeping its `current_anchor`. Patch: read inside the transaction. |
| Revocation before the ledger transaction: a failed unlink leaves an active connection on a revoked session (blind, edge, verification) | low | The intent orders revoke, unlink, delete; a retried disconnect completes, since a second revocation's 404 is ignored. Deferred. |
| The renewal's arrival sync is not proven by the e2e test (verification) | medium | « à l'instant » can come from the linking sync. Patch: the test ages `last_synced_at` first. |
| Renew buttons stay disabled after Back from the bank (blind) | low | bfcache restores the page with `isSuccess` true. Patch: `isPending` only. |
| « {{bank}} est déconnectée » forces the feminine (blind) | low | Patch: « La connexion à {{bank}} est supprimée. » |
| Pending rows at migration time get a null `authorization_started_at` (blind, edge) | low | Only a consent in flight during a deploy; retrying works. Rejected. |
| A renewal callback racing a disconnect leaks a new session (blind, edge) | low | Needs the bank's return inside a disconnect's few hundred milliseconds; fixing adds guards. Rejected. |
| The superseded session is not revoked on renewal (edge) | false | The intent follows Sure, which overwrites it without revoking. |
| Pending entries stay pending after unlink (edge) | false | The intent keeps them, as Sure does. |
| Revocation failures logged twice (blind) | low | `logFailure` logs provider errors only; the warning covers every failure with its consequence. Rejected. |
| `unlinkBankAccount` called with origin `sync` (blind) | false | `linkBankAccounts` passes `sync` for the same user-started linking; the option is unread. |
| Alert date without the year (blind) | low | An expiring date is within 14 days; a stale one a year old is unlikely. Rejected. |
| Spec status and sprint status disagree; `routes/sync.ts` untouched (blind) | false | The workflow syncs the sprint status at the end; the route passes the new result through unchanged. |
| Expired « Reconnecter » not driven to the return in e2e; unchecked cleanup deletes (blind) | low | Same route and callback as « Renouveler », which is driven end to end. Rejected. |
| Disconnect dialog counts zero while the accounts query loads (edge) | low | The query answers before a user reaches the dialog; guarding adds a branch. Rejected. |
| Arrival sync decides on a cached link list (edge) | false | A renewal changes no link, so the cached list is correct. |
| `sessionStorage` is per tab, so a closed banner returns in a new tab (edge) | low | The intent names `sessionStorage`. Rejected. |
| A failed renewal callback cannot be retried with its state (edge) | false | The state is single use by design; a new renewal starts a new one. |

## Design Notes

History stays unchanged because the backward computation and the forward one agree once the forward start is the stored balance of the opening date: going forward from it adds the same movements the backward pass subtracted. The reconciliation on the anchor day is what AD-8 names; it keeps the bank's last figure visible, pending included, since that is the balance the page showed.

Stale ranks above expiring because a sync that stopped costs data today, while an expiring consent still works.

Renewing on the same row rather than creating one keeps `bank_accounts.id`, so `accounts.bank_account_id` never has to move; the unique key `(bank_connection_id, identification_hash)` already makes the callback's upsert a refresh.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean.
- `pnpm test` -- expected: green, 100 % branches on `connectors/**`, `domain/**`, `services/ledger.ts`.
- `pnpm test:e2e` -- expected: green, no request leaves loopback.
