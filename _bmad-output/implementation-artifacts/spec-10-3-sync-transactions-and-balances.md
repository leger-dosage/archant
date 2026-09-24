---
title: 'Story 10.3: Sync transactions and balances'
type: 'feature'
created: '2026-09-24'
status: 'ready-for-dev'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A linked account (10.2) holds one bank balance taken at link time and never hears from the bank again: nothing fetches transactions, `POST /api/sync` is only a public path with no route behind it, and a connection shows no sync state (FR43, FR50, FR52, FR55).

**Approach:** Port Sure's `EnableBankingItem::Importer` window and pagination into a connector `fetchStatement`, feed each linked account through `ledger.ingest` with a connection source, rewrite the `current_anchor` from the bank balance, and expose one `services/sync.ts` function behind the cron route and the connection's « Synchroniser » button.

## Boundaries & Constraints

**Always:**
- Connector: `fetchStatement(uid, since)` calls `GET /accounts/{uid}/transactions?date_from=<since>` and loops on `continuation_key`, stopping at 100 pages or a repeated key (Sure). Then `GET /accounts/{uid}/balances`. Lines dated before `since` are dropped, because some banks ignore `date_from`. Mapping per AD-18: `externalId` is `entry_reference`, never `transaction_id`; `DBIT` negative; `BOOK` kept, every other status dropped (pending is 10.4); date `booking_date` else `value_date` else `transaction_date` through `domain/provider-date.ts`. Label is Sure's order: counterparty (`creditor` for DBIT, `debtor` for CRDT) name, else `bank_transaction_code.description`, else the first `remittance_information` line, else « Virement entrant » / « Virement sortant ». It is capped at `LABEL_MAX_LENGTH`. Notes are the remittance lines joined. Every response is parsed by Zod; an unreadable line goes to `rejected`, never fails the page.
- Balance: `ITBD` else `CLBD` as today, now keeping `reference_date`. The `current_anchor` is dated at that date, clamped to today in `deps.timeZone`, for both linking and sync. This fixes the deferred 10.2 finding that dates a `CLBD` from yesterday as today.
- Window per bank account: its own `last_synced_at` minus 7 days; never synced means today minus 90 days (Sure's 3 months). Lines before the account's opening date are rejected by `ingest` as today.
- `ingest` gains the source `{ connectionId }`. Keys go under source `enable-banking` with `connection_id` set. Step 7 rewrites the account's `current_anchor` (AD-8) instead of writing a `reconciliation`. Existing key matching and `pairLines` (3 days, nearest date, tie flagged `possible_duplicate`) give file convergence unchanged. Origin `sync`.
- One account = one `ingest` transaction. A failure rolls that account back, the others continue, and its `last_synced_at` stays unchanged. The connection's `last_synced_at` advances only when every account succeeded. `last_error` holds the `AppError` code of the latest failed run and is cleared by a clean run. Only linked bank accounts whose account is active are synced.
- Lease: an update sets `bank_connections.sync_started_at` only if it is null or older than 10 minutes. Otherwise the button answers `409 SYNC_IN_PROGRESS` and the cron skips the connection. The lease is released in `finally`. A connection synced less than an hour ago answers `409 SYNC_TOO_RECENT` on the button and is skipped by the cron. Connections that are not `active`, or whose consent has expired, are skipped.
- `POST /api/sync` compares `Authorization: Bearer <SYNC_SECRET>` with `timingSafeEqual`. A missing, wrong or unset secret gives `401 UNAUTHORIZED` before any read. It answers `{ data: { connections: { id, result: "synced" | "failed" | "skipped" }[] } }`. `SYNC_SECRET` is optional in `validateEnv`, with at least 32 characters when set. `POST /api/bank-connections/:id/sync` is session-guarded and answers the connection's `{ lastSyncedAt, lastError }`.
- `detectRecurring` runs once after all accounts. Its failure is logged, never returned.
- Logs carry connection and account ids, counts, durations and error codes only. A log-capture test fails on an amount, an IBAN pattern, a uid or the session id.
- Interface: `/settings/banks/$connectionId` shows « Dernière synchronisation : … » or « Jamais synchronisée », the translated last error, and a « Synchroniser » button with a spinner. The 409 errors are toasts from `errors.<CODE>`. `/settings/banks` shows the last sync per connection. After « Valider » links at least one account, the page starts a sync, as Sure's `complete_account_setup` does. The transaction sheet names the source « Enable Banking » for an entry with an `enable-banking` key.

**Never:** no pending lines, `absorb` or `pending_missed_syncs` (10.4); no expiry banner, stale banner, renewal or disconnect (10.5); no queue or background job; no `transaction_id` key; no merchant creation from counterparties; no currency conversion or `originalAmount`; no `GET /sessions/{id}` call; no « Doublon possible » marker, merge or dismiss action, nor `ledger.absorb` (Story 10.6, after 10.4 writes `absorb`): 10.3 only flags ties, as file imports have since Epic 2.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First sync | linked, never synced, 3 BOOK lines | created, `date_from` = today − 90 days, anchor rewritten | — |
| Overlap | same lines again 1 day later | nothing created, `date_from` = last sync − 7 days | — |
| File-fed | CSV entry −42.90 on 03-10, bank line −42.90 on 03-12 with no key match | bank keys attached to the CSV entry | — |
| Tie | two CSV entries ±1 day | line created, `possible_duplicate` | — |
| No `entry_reference` | same line twice | fingerprint key matches | — |
| Paging | 2 pages then no key | all lines ingested | — |
| One account fails | account B transactions 500 | A committed, B untouched, `last_error` `BANK_PROVIDER_ERROR` | 200, connection keeps old `last_synced_at` |
| Lease held | `sync_started_at` 2 minutes ago | nothing fetched | button 409 `SYNC_IN_PROGRESS`, cron `skipped` |
| Too soon | last sync 30 minutes ago | nothing fetched | button 409 `SYNC_TOO_RECENT`, cron `skipped` |
| Bad secret | no header, wrong or unset secret | nothing read | 401 `UNAUTHORIZED` |
| PDNG / `INFO` status | line with that status | dropped | — |

</frozen-after-approval>

## Code Map

- `packages/data/schema/entry-keys.ts` -- `source` check from `FILE_SOURCE_IDS` (`schema/imports.ts:20`) widens to include `BANK_CONNECTOR_IDS`; add `connection_id` referencing `bank_connections`, `on delete set null`. Migration `0028_*` via `pnpm --filter @archant/data generate`; check that drizzle-kit keeps the `ON DELETE` (it dropped it in `0027`).
- `packages/data/schema/bank-connections.ts`, `schema/bank-accounts.ts` -- add `last_synced_at`, `last_error`, `sync_started_at` to connections; add `last_synced_at` to bank accounts.
- `packages/api/src/connectors/bank-connector.ts:56` -- the port: add `fetchStatement`; `fetchBalance` returns a date.
- `packages/api/src/connectors/enable-banking/client.ts` (`call` :75, `fetchBalance` :184), `schemas.ts` (`balanceSchema` :82 drops `reference_date`), `fixtures/` -- add `transactions-page-1.json`, `transactions-page-2.json`, anonymised.
- `packages/api/src/domain/statement.ts:13` -- `NormalizedTransaction` unchanged here; `pending` is 10.4's.
- `packages/api/src/services/ledger.ts` -- `IngestSource` (:481), `ingest` (:864), `attachKeys`, `pairCandidates` (:633, reused as is), step 7 (:1096) branches on the source, `linkBankAccount` (:433) takes the anchor date, `importOrigins` (:2842) learns the bank source.
- `packages/api/src/services/transactions.ts:47` -- source type gains `{ kind: "bank", connector }`.
- New `packages/api/src/services/sync.ts` -- `syncConnection(deps, id, trigger)` and `syncAll(deps)`; reuses `bankDepsFromEnv` and `logFailure` (`services/bank-connections.ts:86`, `:139`); `detectRecurring` (`services/recurring.ts:101`) as `detectAfterImport` does (`imports.ts:431`).
- `packages/api/src/routes/bank-connections.ts` -- `POST /:id/sync` behind `requireBankConnector`; new `routes/sync.ts` mounted in `app.ts` (:59–72). `/api/sync` is already in `PUBLIC_PATHS` (`routes/middleware/auth.ts:13`).
- `packages/api/src/env.ts`, `.env.example:77`, `docs/deployment.md` -- `SYNC_SECRET`, plus a `curl` example.
- `packages/api/src/lib/errors.ts:7` -- add `SYNC_IN_PROGRESS` and `SYNC_TOO_RECENT` (409).
- `packages/web/src/routes/_authed.settings.banks_.$connectionId.tsx`, `_authed.settings.banks.tsx` (`Connections()` :229), `hooks/useBankConnections.ts`, `components/TransactionSheet.tsx:835`, `locales/fr.json` (`banks.*`, `errors.*`, sheet source).
- `packages/web/e2e/fake-enable-banking.ts` -- `GET /accounts/:uid/transactions` with two pages, and a switch that fails one account.
- Sure: `app/models/enable_banking_item/importer.rb` 624–768, `app/models/enable_banking_entry/processor.rb` 114–213, `app/models/account/current_balance_manager.rb`.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/data/migrate.spec.ts`, schema files, `drizzle/0028_*` -- failing tests for the widened source check, `connection_id` set null on connection delete, and the new columns; then the migration.
- [ ] `packages/api/src/connectors/enable-banking/*.spec.ts`, `client.ts`, `schemas.ts`, `fixtures/*`, `bank-connector.ts` -- mapping, label fallbacks, statuses, pages, repeated key, `date_from` filter, balance date; 100 % branches.
- [ ] `packages/api/src/services/ledger.spec.ts`, `ledger.ts` -- connection source keys, anchor rewrite, anchor date, file convergence and tie through a bank line, sheet source.
- [ ] `packages/api/src/services/sync.spec.ts`, `sync.ts` -- the matrix, window per bank account, lease expiry, recurring failure swallowed, log capture.
- [ ] `packages/api/src/env.ts`, `routes/sync.ts`, `routes/bank-connections.ts`, `app.ts`, `app.spec.ts`, `lib/errors.ts` -- the two routes, 401 without reading, 409s, 503.
- [ ] `packages/web/e2e/fake-enable-banking.ts`, web routes, hook, sheet, `fr.json` -- status, button, sync after linking.
- [ ] `packages/web/e2e/bank-connections.spec.ts` -- sync shows the bank's lines and the last sync time; a failed account shows the error; the sheet names « Enable Banking ».
- [ ] `.env.example`, `docs/deployment.md`, `AGENTS.md` if a convention changed -- the secret and a cron example.

**Acceptance Criteria:**
- Given linked accounts, when the cron route or the button runs, then transactions since the window start land once, the account's balance today equals the bank balance, and a second run creates nothing.
- Given a connection page, when it shows, then it displays the last successful sync time and the last error.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

The window lives on each bank account because sync is atomic per account: with one date per connection, an account that fails for more than 7 days would come back with a gap. Sure gets away with a connection date because it fails the whole item. The anchor takes the balance's `reference_date` because a `CLBD` often describes yesterday. Dated today, the backward computation would subtract today's synced lines a second time.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean.
- `pnpm test` -- expected: green, 100 % branches on `connectors/**`, `domain/**`, `services/ledger.ts`.
- `pnpm test:e2e` -- expected: green, no request leaves loopback.
