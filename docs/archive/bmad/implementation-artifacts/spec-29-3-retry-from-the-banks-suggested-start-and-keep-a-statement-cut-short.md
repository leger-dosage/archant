---
title: "Story 29.3: Retry from the bank's suggested start, and keep a statement cut short, as Sure"
type: 'feature'
created: '2026-10-17'
status: 'done'
baseline_commit: '9d21bb65140f5786d24692803c6c3d428f17e616'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-29-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure's `Provider::EnableBanking#get_account_transactions` retries every transactions call, every page included, that the bank refuses with `WRONG_TRANSACTIONS_PERIOD` or N26's `{ "code": "PERIOD_INVALID" }` (`wrong_transactions_period?`): first from the bank's own `detail.date_from` when it is later than the refused start (`corrected_date_from`), then from 89, 60 and 30 days back, each later than the start just refused (`next_transactions_date_from`). Its importer's `fetch_paginated_transactions` keeps the pages read when page two or later answers 400 or 422 for another reason, and the account counts as synced; any other error fails the account and keeps nothing. Archant retries only the first page, never reads the suggested date nor N26's shape, and treats every failure after page one alike: the pages read are written, the balance is not read, the account fails and its window stays. A bank that cuts its statement short on every sync, as Trade Republic does (Sure's comment on `fetch_paginated_transactions`), never syncs in Archant.

**Approach:** The Enable Banking connector retries each page through Sure's `next_transactions_date_from`, reads the refusal's code and suggested date in `errorResponseSchema`, and reports a statement cut short by a 400 or 422 after page one as complete but cut short. The sync service ingests it with its balance and moves the account's window; any other failure after page one throws, as Sure.

## Boundaries & Constraints

**Always:**
- A refusal is a non-2xx answer whose body has `error: "WRONG_TRANSACTIONS_PERIOD"` or `code: "PERIOD_INVALID"`, under any status but 401, 403, 404, 408 and 429, whose body Sure's `handle_response` never reads.
- Next start, per call, from the start just refused: on the first retry the bank's `detail.date_from`, read as an ISO date, basic form included as `Date.iso8601`, when it is later; otherwise the first of 89, 60, 30 days before `today` later than the refused start; at most four retries, as `retry_attempt > FALLBACK_TRANSACTIONS_DATE_FROM_DAYS.length`. No next start throws the refusal.
- Every page asks from `since` and is retried that way on its own, with its continuation key, as `fetch_paginated_transactions` passes its `start_date` to every page. The statement's `from` is the latest start a page was accepted from; lines are kept from the start asked for, `since`, as Sure's `filter_transactions_by_date` filters by its own start date.
- After page one, a 400 or 422 that is not a refused period ends the read: the pages read are the statement, `cutShort` names the failure. A refused period with no start left, or any other failure, throws: the account fails and writes nothing, as Sure's importer raises.
- A statement cut short: balance read, lines ingested, `bank_accounts.last_synced_at` moved, the account counted as synced, a log line at error level with the code, status and line count, never an amount. It counts no pending miss, since Story 29.6 has not removed the misses yet and unread pages would otherwise count as missing.
- The provider's error body stays inside `errorResponseSchema`: the code, a boolean for the consent validity, and a parsed date, nothing else (AD-14).
- AD-18 states the refused period and the partial pages as Sure; `docs/sure-parity.md` « Refused period » and « Pagination » become Parity.

**Never:** no change to the 100-page cap or the repeated key; no change to the pending-miss rule beyond a cut-short read (Story 29.6); no `transaction_status` query or PSU headers (Stories 29.6, 29.9); no new dependency; no visible change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Suggested date | 422 `WRONG_TRANSACTIONS_PERIOD`, `detail.date_from` later | retried from it | none |
| Suggested date not later | `detail.date_from` ≤ refused | 89-day start | none |
| Suggested date refused too | refusal again | first of 89, 60, 30 later than the suggested | none |
| N26 | 400 `{ code: "PERIOD_INVALID", detail: "dateFrom=..." }` | same as a refusal without a date | none |
| Unreadable `detail.date_from` | `"soon"` | ignored, 89 days | none |
| Page two refused | refusal on `continuation_key` | page two retried with its key from the next start; page three from `since` | none |
| Page two cut short, 400 or 422 | other code | pages read kept, balance read, synced, window moves | logged |
| Page two 500 | `ASPSP_ERROR` | throws | account fails, nothing written |
| Every start refused | page one or later | four retries at most | throws, account fails |

</frozen-after-approval>

## Code Map

- `packages/api/src/connectors/enable-banking/schemas.ts` -- `errorResponseSchema` reads `error` or `code`, either optional, and `detail.date_from`; transforms to `{ error, consentValidity, suggestedFrom }`.
- `packages/api/src/connectors/enable-banking/client.ts` -- `call` throws a module-local `PeriodRefused` carrying `suggestedFrom`; `fallbackStarts` becomes Sure's `nextStart(refused, suggested, attempt, today)`; `fetchLines` retries each page and returns `{ lines, from, cutShort }`; `readFrom` goes; `fetchStatement` maps with `since`.
- `packages/api/src/connectors/bank-connector.ts` -- `BankStatement.interrupted` becomes `cutShort`; `fetchStatement`'s doc.
- `packages/api/src/services/sync.ts` -- `runSync` handles `cutShort`; `runSync` doc.
- `packages/api/src/services/ledger/ingest.ts` -- the `missesFrom` comments name a read cut short.
- Specs: `client.spec.ts` (`nextStart`, suggested date, `PERIOD_INVALID`, a later page refused, cut short by 400 and 422, 500 after page one throwing), `sync.spec.ts` (cut short synced with balance and window, a 500 on page two failing and writing nothing).
- Docs: `docs/architecture.md` AD-18, `docs/sure-parity.md` rows « Refused period » and « Pagination », `docs/troubleshooting.md` or `docs/security-model.md` only if they describe it.
- Sure, read-only, at `00dd977fb`: `app/models/provider/enable_banking.rb`, `app/models/enable_banking_item/importer.rb`.

## Tasks & Acceptance

**Execution:**
- [x] Vitest first, failing: `nextStart`; a refusal with a later and a not-later suggested date, an unreadable one, N26's `PERIOD_INVALID`; a later page refused and retried with its key; a statement cut short by a 400 and by a 422; a 500 after page one throwing; the sync of a cut-short read (balance, window, synced, no miss) and of a 500 on page two (failed, nothing written).
- [x] Schema, client, port type, sync service.
- [x] AD-18 and parity rows.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass with no request reaching Enable Banking.

## Design Notes

Assumptions taken alone, each settled by Sure. A refusal is read from the body at any status, as `wrong_transactions_period?` ignores the status. The retry counter starts again on each page, as each `get_account_transactions` call starts at `retry_attempt: 0`. Lines are filtered by the start asked for, not the one accepted: Sure filters by its own `start_date`, and a later page retried from a later start would otherwise drop lines the bank gave for the earlier pages. Any failure after page one other than a 400 or 422 now fails the account without writing the pages read, as Sure raises: Story 11.4 kept them, a departure without one of the four reasons, and the next sync reads the same window again. A statement cut short counts no pending miss until Story 29.6 removes the misses. No Playwright test: the story asks Vitest only, and nothing visible changes.

## Spec Change Log

- Code review, second pass: Sure's `fetch_paginated_transactions` asks every page from its own `start_date`, and its `handle_response` reads no body under 401, 403, 404, 408 or 429; `Date.iso8601` reads `20260710`. The frozen constraints said each page asks from the start accepted last and any status counts. Amended « Always » and the page-two matrix row to Sure, which the owner's rule puts above this spec. Known-bad state avoided: a statement read from a later start than Sure's, and a 401 retried four times. KEEP: per-page retries with their own counter, lines kept from `since`, `from` as the narrowest accepted start for the misses.

### Review Findings

Second pass, `bmad-code-review` (four layers) over the committed tree.

- [x] [Review][Patch] Each page asked from the start accepted last, where Sure asks every page from its `start_date` [packages/api/src/connectors/enable-banking/client.ts]
- [x] [Review][Patch] A refused period read under 401, 403, 404, 408 or 429, whose body Sure never reads [packages/api/src/connectors/enable-banking/client.ts]
- [x] [Review][Patch] `detail.date_from` in the basic form `20260710` ignored, which `Date.iso8601` reads [packages/api/src/connectors/enable-banking/schemas.ts]
- [x] [Review][Patch] No test that the suggested start is followed on a page's first retry only [packages/api/src/connectors/enable-banking/client.spec.ts]
- [x] [Review][Patch] No test of a refused period under a 500 [packages/api/src/connectors/enable-banking/client.spec.ts]
- [x] [Review][Patch] Two suggested-start tests did not check `statement.from` [packages/api/src/connectors/enable-banking/client.spec.ts]
- [x] [Review][Patch] `docs/sure-parity.md`: Sure's « Refused period » cell named neither N26 nor every page; « Balance » still said « after a complete read » [docs/sure-parity.md]
- [x] [Review][Patch] `cutShort` and `fetchStatement` docs left out « no refused period »; `runSync` comment badly wrapped [packages/api/src/connectors/bank-connector.ts]

Rejected:
- `low` A suggested start after today is asked for: Sure's `next_transactions_date_from` does not bound it either.
- `false` `WRONG_TRANSACTIONS_PERIOD` under `code` or `PERIOD_INVALID` under `error` not retried: Sure's `wrong_transactions_period?` reads exactly those two keys.
- `low` Both `error` and `code` present logs `error`: no bank known to send both.
- `false` A consent-length 422 after page one cuts the read short: Sure's `:validation_error` does the same.
- `false` A cut-short read moves the window and writes the balance: what the story and Sure's importer ask.
- `false` A page retried with the same continuation key and a new start: Sure's `get_account_transactions` keeps the key too.
- `low` No `last_error` for a read cut short: the account is synced, as in Sure; the error-level log names it.
- `low` No test of a cut-short read whose body has no code: `providerCode` is `null` as for any unreadable body, covered elsewhere.
- `low` No sync-level test of a later page refused: the connector tests pin the requests and `from`; the sync passes `from` unchanged.
- `low` The « counts no miss on a read cut short » test checks no window: the parameterised cut-short test checks the window and the sync.
- `low` `periodRefused` is a fourth field out of `errorResponseSchema`: a boolean, no provider text.

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | « Pagination » row says Parity while a cut-short read counts no pending miss | low | patch | The row now gives that sub-difference its own status, Later with Story 29.6. |
| 2 | A suggested `detail.date_from` after today is asked for | low | reject | Sure's `next_transactions_date_from` does not bound it either; a bank suggesting a future start is not seen. |
| 3 | `nextStart`'s four-retry guard is unreachable | low | reject | It is Sure's `retry_attempt > FALLBACK_TRANSACTIONS_DATE_FROM_DAYS.length`, kept to read as Sure. |
| 4 | No troubleshooting section for a read cut short | low | reject | The account syncs; the error-level log line is what Sure gives too. |
| 5 | The review diff leaves out the spec and sprint status | false | reject | Excluded on purpose; the spec is the claims file. |
| 6 | No test of a later page refused for every start with a 400 | low | patch | The exhausted later-page test now answers 400, proving it throws rather than cuts short. |
| 7 | A later page refused, then another 422, reports the previous page's start | low | reject | That page was never accepted, so the last accepted start is the right `from`. |
| 8 | `call` raises `PeriodRefused` on every endpoint | false | reject | It is a `BankProviderError` with the same code everywhere; only `fetchPage` reacts, as `ConsentLengthRefused`. |
| 9 | Both `error` and `code` present: the logged code is `error` | low | reject | No bank is known to send both; the refusal is still read as Sure reads it. |
| 10 | `BankStatement.from`'s doc no longer says lines go back to `since` | low | patch | Doc now says lines are kept from the start asked for. |
| 11 | « window shortened » logs the last accepted start, not page one's | low | reject | That start is the one the read speaks for, as the misses use it. |
| 12 | Unwrapped comment line in `errorResponseSchema`; message literal repeated | low | patch / reject | Comment rewrapped; the literal follows `ConsentLengthRefused` beside it. |
| 13 | Page one empty with a key, page two 400: synced over unread pages | low | reject | Sure's `page_count == 1` check does the same. |
| 14 | A cut-short read moves the window past unread pages | false | reject | The story and Sure ask for it: the account counts as synced. |
| 15 | A later page retried from a later start may drop lines silently | low | reject | Sure retries the same way; the shortened window is logged. |
| 16 | No test that N26's `code` reaches `providerCode` | medium | patch | A test now refuses every start with N26's body and checks `providerCode: "PERIOD_INVALID"`. |

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.
