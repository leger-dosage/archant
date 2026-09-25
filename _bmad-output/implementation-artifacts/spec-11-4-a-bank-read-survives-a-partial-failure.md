---
title: 'Story 11.4: A bank read survives a partial failure'
type: 'bugfix'
created: '2026-09-25'
status: 'done'
baseline_commit: '8b7aae0c564f9fb94ecad6abffe402123b244ee5'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** One failing call costs a whole account's sync: `fetchStatement` awaits the balance after the lines, so a balance error drops every line; a `WRONG_TRANSACTIONS_PERIOD` refusal is never retried; an error on page two throws page one away; a line the bank lists twice under two `entry_reference`s is created twice; the consent asks for the bank's exact maximum, which some banks refuse.

**Approach:** Follow Sure's `Provider::EnableBanking` and `EnableBankingItem::Importer`. The connector reads lines only, retries a refused period, keeps the pages it read and says whether the read is complete, removes repeats by content, and trims the consent. The sync reads the balance on its own after a complete read, and a balance failure costs the balance alone.

## Boundaries & Constraints

**Always:**
- Balance failure: the account's lines are ingested with `balance: null`, so its `current_anchor` stays; its bank account's `lastSyncedAt` moves; the connection's `lastSyncedAt` moves if no account failed. `lastError` holds the first account failure's code, else `BANK_BALANCE_UNAVAILABLE` (new code, 502), else `null`. The cron result stays `synced`.
- Refused period: on `providerCode === "WRONG_TRANSACTIONS_PERIOD"` from the first page, read again from page one with `date_from` 89, then 60, then 30 days before today (app zone), skipping any start not later than the current one. All refused: the account fails with `BANK_PROVIDER_ERROR`, as today. The accepted start is the read's `from`: lines before it are dropped, and only pending entries dated `from` or later can count a miss.
- Error after page one (any `BankProviderError`): the lines read are ingested, no balance is read, no pending entry counts a miss, the bank account's `lastSyncedAt` stays, the account counts as failed with the error's code. An error on page one fails the account as today.
- Repeats: before mapping, raw lines with the same content keep one copy. Content is Sure's `build_transaction_content_key`: date (`booking_date`, else `value_date`, else `transaction_date`), amount, currency, creditor name, debtor name, remittance lines, `transaction_id`, `credit_debit_indicator`. `entry_reference` and `status` are left out; booked lines come before pending ones so the booked copy wins.
- Consent: `min(maximum ?? 90 days, 90 days)` minus 60 seconds.
- Logs carry ids, counts, day counts and codes only (AD-14): a retry logs the window's days, a partial read its line count, a balance failure its code.
- `connectors/**`, `domain/**` and `services/ledger.ts` stay at 100 % branches.

**Never:** no retry from the bank's suggested `detail.date_from` (Sure's first retry); no consent step-down on refusal; no remembered accepted window; no new column or migration; no change to key matching or pending reconciliation beyond the miss count's scope (Story 11.5).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Balance fails | lines 200, balances 500 | lines created, previous balance unchanged, account synced | `lastError` `BANK_BALANCE_UNAVAILABLE`; page shows its line |
| Balance fails, other account fails | account A balance 500, account B lines 500 | A synced, B rolled back | `lastError` is B's code, connection `lastSyncedAt` unchanged |
| Period refused once | first read refused, 89 days accepted | lines since today−89 synced, account synced | — |
| Period refused thrice | 89, 60, 30 refused | account failed | `BANK_PROVIDER_ERROR` |
| Short window | since today−7, refused | no retry (every fallback starts earlier) | `BANK_PROVIDER_ERROR` |
| Window shortened past a pending entry | pending dated today−80, 60 days accepted | pending not counted as missed | — |
| Page two fails | page 1 read, page 2 500 | page 1 lines created, no balance read, pending untouched | account failed, next read from its last success |
| Repeat in one response | two lines, same content, two `entry_reference`s | one transaction | — |
| Booked and pending repeat | same content, `BOOK` and `PDNG` | one booked transaction | — |
| Consent | maximum 180 days / 30 days / none | 90 d − 60 s / 30 d − 60 s / 90 d − 60 s | — |

</frozen-after-approval>

## Code Map

- `packages/api/src/connectors/bank-connector.ts:78-87` -- port: `fetchStatement` stops reading the balance and returns `transactions`, `rejected`, `from: IsoDate` (the start actually read) and `interrupted: BankProviderError | null`; update the doc comments. `fetchBalance` stays.
- `packages/api/src/connectors/enable-banking/client.ts:42-55` -- `consentValidUntil`, add the 60-second margin. `:258-286` `fetchLines`: keep pages read on an error after page one; wrap it with the period retry. `:366-380` `fetchStatement`: repeats removal before `toTransaction`, no `fetchBalance`. Export the pure helpers (e.g. `withoutRepeats`, `fallbackStarts`) for unit tests.
- `packages/api/src/services/sync.ts:147-191` -- `runSync` loop: after a complete read, call `fetchBalance` in its own try and put the result, or `null` on failure, in the statement given to `ingest`, so lines and anchor commit in one transaction. Pass `missesFrom` (the read's `from`, or `null` when interrupted); move the bank account's `lastSyncedAt` only on a complete read. `:58-66` `toParsedStatement` takes the balance apart. `:194-209` connection update with the error precedence above.
- `packages/api/src/services/ledger.ts:708` -- `IngestSource` connection variant gains the miss scope, e.g. `{ connectionId, missesFrom: IsoDate | null }` (`null`: count none). `:1476-1485` pass it; `:2236-2262` `countMissedSyncs` filters pending dated before it. Update `ingest`'s doc comment.
- `packages/api/src/services/ledger.ts:4378` -- `oldestPendingDate`, unchanged.
- `packages/api/src/lib/errors.ts:32-44` -- add `BANK_BALANCE_UNAVAILABLE: 502`.
- `packages/web/src/routes/_authed.settings.banks_.$connectionId.tsx:105-145` -- `SyncStatus`: for `BANK_BALANCE_UNAVAILABLE`, its own line (`role="status"`, not destructive) and a warning toast instead of `banks.sync.failed`.
- `packages/web/src/locales/fr.json:1006,1093-1096` -- `errors.BANK_BALANCE_UNAVAILABLE`, `banks.sync.balanceUnavailable` (« Opérations à jour, mais la banque n'a pas donné le solde : le solde affiché reste celui de la synchronisation précédente. »).
- `packages/api/src/testing/enable-banking.ts` -- `mockProvider(overrides)`, `transactionsPage(url)`, `fixtures`; errors as `HttpResponse.json({ error: "..." }, { status })`.
- `packages/api/src/services/sync.spec.ts:170-205` -- `failingOn`, `withoutPending`, `linkedAccount`, `pendingOf`, `connectionRow`, `bankAccountSyncedAt`, `balanceOn`.
- `packages/web/e2e/fake-enable-banking.ts:22-28,255-275` -- `FAILING_BANK`, `FAKE_BANKS`, balances route; `packages/web/e2e/bank-connections.spec.ts:353-376` the failing-bank test to mirror.
- `docs/sure-parity.md:108,112,113,114,117` -- Consent, Refused period, Pagination, Balance, Same line twice rows.
- `_bmad-output/planning-artifacts/architecture/architecture-archant-2026-09-21/ARCHITECTURE-SPINE.md:194` -- AD-18 rule.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/connectors/enable-banking/client.spec.ts` -- tests first: consent margin (180 d, 30 d, none); repeats removal (content key fields, `transaction_id` kept apart, booked wins); period retry order, skip of earlier starts, all refused; page-two error keeps page one with `interrupted` set; page-one error throws; no balances request from `fetchStatement`.
- [x] `packages/api/src/services/ledger.spec.ts` -- tests first: `missesFrom` null counts no miss; a date counts only pending dated on or after it.
- [x] `packages/api/src/services/sync.spec.ts` -- tests first: one test per matrix row from « Balance fails » to « Page two fails », asserting lines, `balanceOn`, `lastError`, both `lastSyncedAt`, `pendingOf`, and that logs carry no amount.
- [x] `packages/api/src/connectors/bank-connector.ts`, `client.ts` -- port and connector changes.
- [x] `packages/api/src/services/ledger.ts`, `sync.ts`, `lib/errors.ts` -- miss scope, sync loop, new code.
- [x] `packages/web/src/routes/_authed.settings.banks_.$connectionId.tsx`, `fr.json` -- balance line and toast.
- [x] `packages/web/e2e/fake-enable-banking.ts`, `bank-connections.spec.ts` -- a bank whose balances answer 500; connecting it shows the balance line, the lines listed, and the account at the balance given when linked.
- [x] `docs/sure-parity.md`, `ARCHITECTURE-SPINE.md` -- rows and AD-18 updated; the pagination row says Archant keeps partial pages on any error but leaves the account failed, where Sure keeps them on 400/422 only and calls it a success.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then every matrix row has an automated test: Playwright for the balance line, Vitest for the rest.

## Design Notes

Reading the balance before `ingest` keeps NFR8's one transaction per account: lines and anchor commit together. A partial read writes lines on purpose: they carry `ext:`/`fp:` keys, so the next read from the unchanged `lastSyncedAt` recognises them, and no miss is counted, so nothing is deleted on half a statement.

## Implementation Notes

- `fetchStatement(uid, since, today)` takes today so the connector computes the fallback starts (`fallbackStarts`); repeats are removed by `withoutRepeats` on raw lines, and `transaction_id` joins `transactionSchema` for that key only.
- `readBalance` in `sync.ts` turns a `BankProviderError` into a missing balance and rethrows anything else, so a bug still fails the account.
- The fake Enable Banking gains « Banque Sans Solde », whose balances answer when an account is linked and 500 on sync.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| Pending entry older than the accepted window never counts a miss and stays (blind, edge) | low | Needs a pending line older than the bank's maximum period; Sure keeps stale pending lines forever; the matrix asks for exactly this. | rejected |
| Shortened window leaves a gap without a notice | low | Sure does the same; the intent says the account syncs within the accepted window; logged at info. | rejected |
| Survivor between two repeats depends on response order | false | The survivor's `fp:` key is date, amount and label, identical for both copies, so the other copy is recognised next sync. | rejected |
| Two genuine identical purchases without `transaction_id` collapse (blind, edge) | low | Sure's content key does the same; the parity row did not say so. | patch |
| `readBalance` swallows non-provider errors (blind, edge) | medium | A bug or signing failure reads as `BANK_BALANCE_UNAVAILABLE` and the account counts as synced; Sure rescues `EnableBankingError` only. | patch |
| No combined tests (shortened then interrupted; interrupted absorbing a pending) | low | Each path is tested alone and the combination composes `from` and `interrupted` without new code. | rejected |
| « Balance history range » parity row overwritten by a copy of « Balance » | medium | Baseline line 86 lost its content; the Enable Banking table already holds the row. | patch |
| Spec `in-review`, sprint `in-progress` | false | Sprint status moves at the presentation step, by design. | rejected |
| `errors.BANK_BALANCE_UNAVAILABLE` never shown, two texts | low | Every `ErrorCode` needs its `errors.*` key; the page shows its own line by design. | rejected |
| `ingest` doc comment badly wrapped | low | Rewrapped before review. | patch |
| `vi.importActual` inside `mockImplementationOnce` | low | Readability only. | rejected |
| Consent margin has no floor for a maximum of 60 s or less | low | No bank advertises a consent under a minute. | rejected |
| Balance answered 200 without ITBD or CLBD sets no `lastError` | low | Pre-existing: a `null` balance was silent before this story. | rejected |
| Creditor `null` versus `{ name: null }` defeats the content key (edge, claim) | low | The schema turns both into objects with a nullable name only when present; a bank mixing both shapes for one line is unlikely. | rejected |
| Warning toast of « Synchroniser » untested (verification gap) | medium | No test runs `onSuccess` with `BANK_BALANCE_UNAVAILABLE`. | patch |

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint:code && pnpm test` -- expected: green, 100 % branches on `connectors/**`, `domain/**`, `services/ledger.ts`.
- `pnpm test:e2e` -- expected: green.
