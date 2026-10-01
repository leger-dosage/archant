---
title: 'Story 15.5: Fast at ten years of history'
type: 'feature'
created: '2026-10-01'
status: 'done'
baseline_commit: '3fc14f69624c9a9cfa5f5cbbdc218d54226ac388'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-15-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** At 100,000 transactions SQLite plans blind: no statistics ever exist, so transfer candidates scan an index instead of the primary key (PERF-1); the list's count and sums rerun on every page with a correlated `exists` per row (PERF-3); « Dépenses » sorts every expense (PERF-4). Nothing is compressed (PERF-6), Recharts and the date picker ship to every page (PERF-8), and every window focus refetches everything (PERF-9).

**Approach:** Give SQLite statistics and an index for the totals, move the totals to their own request without the page, steer the list onto the date index, compress responses, lazy-load the heavy components, and revise NFR10 to the measured target with a spec that holds it.

## Boundaries & Constraints

**Always:**
- `refreshStatistics(db)` in `packages/data/client.ts` runs `PRAGMA analysis_limit=1000; ANALYZE;` through one `executeMultiple`, so both reach the same pooled connection. The server calls it after `runMigrations` on every start, and `confirmImport` after the commit when `counts.created > 1000`. A failure logs a warning, code only, and never stops startup or fails the import (Turso is best-effort).
- Totals: `GET /api/transactions/totals`, same query schema minus `page` and `pageSize`, answers `{ data: { total, sum } }` from one `sumTransactions` call (`total` is the sum of every currency's `count`). `GET /api/transactions` answers `items`, `page`, `pageSize` and runs no count and no sum. The app reads totals through `useTransactionTotals(filters)`, key `["transactions", "totals", filters]`, under `queryKeys.transactions.all` so every invalidation still reaches it.
- Migration `0036` through `pnpm data generate`: index `entries_kind_currency_amount` on `entries(kind, currency, amount, id)`.
- The transfer side in the list, its count and the sum is read from the left-joined `asOutflow` and `asInflow` (each unique, so no row doubles); the `exists` form stays only for queries that join no `transfers` (bulk selection, cash flow).
- List order unchanged, `transactions.pending` included. The list query, filtered or not, reads `entries_kind_date`, or `entries_account_date` when one account is filtered, and sorts only within a day (`USE TEMP B-TREE FOR LAST 3 TERMS OF ORDER BY`). The planner hint that gets there (`+entries.amount`, a date bound) carries a why-comment.
- `compress()` from `hono/compress` on every response, API and assets: gzip, threshold 1 KB.
- `React.lazy` with a fallback of the same height: `BalanceChart`, the pie of `CashFlowSection` moved to its own `CashFlowChart`, and `CreateAccountDialog`, mounted from its first opening on so its closing animation still plays.
- `QueryClient` gets `staleTime: 30_000`.
- NFR10 reads: with 100,000 transactions, the first page of the transaction list and an account's page answer in under 150 ms, and a 24,000-line OFX file is confirmed in under 3 seconds on a small server. Edited in `epics.md` and wherever 300 ms or 50,000 is cited.

**Never:** no `INDEXED BY` or raw SQL outside `packages/data`; no worker thread, keyset pagination or trimmed preview; no new dependency; no change of the list's order, of a sum's value or of what a filter matches; no partial `cache_size` or `synchronous` on some connections only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Large import | OFX creating 1,001+ lines | statistics refreshed after commit | failure logged, import confirmed |
| Small import | 1,000 lines or fewer | no `ANALYZE` | — |
| Page 2 | same filters | only the list request runs; totals come from cache | — |
| Filter changes | « Dépenses » added | both requests run | — |
| Gzip accepted | `Accept-Encoding: gzip`, body ≥ 1 KB | `Content-Encoding: gzip`, `Vary: Accept-Encoding` | — |
| No encoding accepted | no header | body as today | — |

</frozen-after-approval>

## Code Map

- `packages/data/client.ts:48-80` -- `createDb`; the pool (`@libsql/client` 0.18 `sqlite3.js` `ConnectionPool`) opens connections lazily, up to 20, with no per-connection hook.
- `packages/api/src/index.ts:97-101` -- `runMigrations`, `createDb`, `seedDefaults`: call `refreshStatistics` after `createDb`.
- `packages/api/src/services/imports.ts:371-417` -- `confirmImport`; hook after `countsOf`, beside `detectAfterImport` (same non-fatal pattern).
- `packages/data/schema/entries.ts:55-73` -- indexes; `entries_kind_amount_date` stays for candidates.
- `packages/api/src/services/ledger.ts` -- `candidateOf` `:3371`, `candidatePairQuery` `:3440`; `isTransferSide` `:4235`, `DIRECTION_CONDITIONS` `:4240`, `filterCondition` `:4250` (also used at `:2653` and `:4424`), `listTransactions` `:4299` (keeps its count for `listAccountTransactions`; the cross-account path skips it), `sumTransactions` `:4371`; `asOutflow`/`asInflow` `:3963`.
- `packages/api/src/services/transactions.ts:63-83,260-290` -- `FilteredTransactionPage`, `listAllTransactions`: split into the page and `transactionTotals`.
- `packages/api/src/routes/transactions.ts:29-36` -- add `/totals` before `/:id`.
- `packages/app/src/hooks/useTransactions.ts:52`, `lib/query-keys.ts:89`, `routes/_authed.transactions.tsx:144,217-229` -- page and totals.
- `packages/app/src/app.tsx:42` -- `QueryClient`.
- `packages/app/src/components/BalanceChart.tsx`, `CashFlowSection.tsx`, `NetWorthSection.tsx`, `routes/_authed.accounts.$accountId.tsx:17`, `AppShell.tsx:209-218`.
- `packages/api/src/app.ts:259-289,359` -- `cacheControl`, `serveInterface`; add `compress()` before them.
- `packages/api/src/services/ledger.spec.ts:2683-2786` -- the 50,000-row suite, superseded and removed; its direct seeding is the model.
- `packages/api/src/app.spec.ts:1198,1243,1364,5705` -- `sum` assertions move to `/totals`; `:3614` the 5,000-line test stays.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/services/history-volume.spec.ts` -- write first: seed 100,000 rows over ten years on three accounts with transfers, call `refreshStatistics`; one `describe` times NFR10 (page plus totals, an account's page, a 24,000-transaction OFX through `createImport`, `previewImport`, `confirmImport`), limit = target × 2 when `CI` is set; another asserts plans (see Design Notes). Remove the 50,000-row suite.
- [x] `packages/data/client.ts` + `client.spec.ts` -- `refreshStatistics`; `sqlite_stat1` has rows after it.
- [x] `packages/api/src/index.ts`, `services/imports.ts` + specs -- the two calls, the 1,000 boundary, the logged failure.
- [x] `packages/data/schema/entries.ts` + `pnpm data generate` -- the covering index.
- [x] `packages/api/src/services/ledger.ts` -- joined transfer side, planner hints; existing sum, list and direction tests pass unchanged.
- [x] `services/transactions.ts`, `routes/transactions.ts`, `schemas/transactions.ts`, `app.spec.ts` -- the split; `/totals` tests.
- [x] `packages/api/src/app.ts` + `app.spec.ts` -- compression on an API answer and a hashed asset, none without the header.
- [x] `packages/app` hooks, keys, transactions page, `app.tsx`, lazy components; `e2e/serving.spec.ts` -- the dashboard's scripts hold no `rdp-` class, the settings page's no `recharts-wrapper`; the dashboard's charts and the dialog still render.
- [x] `epics.md` NFR10, `docs/architecture.md:328`, the comment of `entries.ts:69-72` -- the new target.

**Acceptance Criteria:**
- Given 100,000 seeded transactions after `refreshStatistics`, when `pnpm test` runs, then NFR10's three targets hold and every plan assertion passes.
- Given the pull request, when CI runs, then the seven required checks pass.

## Design Notes

Plans are read without exporting a query: spy on `db.$client.execute` while calling the public function, then run `EXPLAIN QUERY PLAN` on the captured statement. Asserted: the candidate query searches the source by primary key and `entries_kind_amount_date` on `kind`, `amount` and `date`, never on `kind` alone; the sum reads `entries_kind_currency_amount` with no correlated subquery; the list, plain and « Dépenses », reads the date index and sorts only within a day.

Why not « sorts nothing in a temporary B-tree », as the epic says: the order puts `transactions.pending` between `date` and `createdAt`, a column of another table, so no index can give the whole order. Measured on 100,000 rows, the planner today sorts the whole table (about 65 ms); on the date index it sorts one day at a time and stops at the page (about 4 ms). Statistics alone do not steer it there: with `analysis_limit=1000` `kind` and `account_id` look equally selective.

Why no `cache_size` or `synchronous`: both last one connection, and libSQL's pool opens connections lazily with no hook. `concurrency: 1` would apply them, but the pool then rejects any query made while a transaction holds that connection (`TRANSACTION_ACTIVE`), which the first-visit sync beside a request would hit. The audit rates the gain low.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- green, no tracked change.

## Implementation Notes

- Statistics alone did not steer the candidate query. With `analysis_limit=1000`, `kind` and `account_id` sample as a few hundred rows each, so the planner read the sources through `entries_kind_currency_amount (kind=?)` or `entries_account_date`, and looped over the accounts first: the 24,000-line confirm took 17 s. `candidatePairQuery` now cross-joins its tables, with the conditions in `where`, which fixes the join order (SQLite's documented manual control, no `INDEXED BY`), and `candidateOf` writes the source's `kind` as `+kind`. The confirm takes about 2.2 s on an M4 Pro.
- The list needed `+entries.amount` for « Dépenses » and, for an account filter, `+kind` with one account or `+account_id` with several; no date bound was needed. Each hint carries its why-comment.
- libSQL embeds SQLite 3.45, which prints `USE TEMP B-TREE FOR RIGHT PART OF ORDER BY`; newer releases print `LAST 3 TERMS`. The plan assertion accepts both.
- `history-volume.spec.ts` runs in its own Vitest project, `volume`, after the `unit` project and without coverage: beside the other files and instrumented, the confirm measured 3.1 s on the same machine. `pnpm --filter @archant/api test` runs both projects.
- `listTransactions` keeps its count for the account page; the cross-account page calls the new `listTransactionPage`.
- `staleTime: 30_000` made the category edit invalidate `transactions.all` too, since the dashboard's cash flow no longer refetches on mount, and the bank-connections e2e test moves the browser clock past `staleTime` before its `visibilitychange`.
- The account dialog has no placeholder: a dialog takes no room in the page.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|---|
| 1 | blind, edge | A failed `/totals` shows no error, no pagination and no empty state | medium | `_authed.transactions.tsx:273` shows `ErrorNote` for `transactions.isError` only; `QueryCache.onError` toasts, but the page stays blank | patch |
| 2 | blind, edge | Placeholder totals of the previous filter feed `pageCount`, `BulkBar` and the empty states | low | `:152-156`, `:292-299`, `:330-334` read `totals.data` without `isPlaceholderData`; only `useClampPage` checks it | patch |
| 3 | blind | `transactionTotalsSchema` is not strict like `bulkFilterSchema` | false | `bulkFilterSchema` is strict because it drives a write; the list's `transactionFilterSchema` is not strict either, and `/totals` only reads | reject |
| 4 | blind, edge, verification | Statistics not refreshed after a first bank sync, a revert or an account deletion | low | the first sync reads 90 days (`sync.ts:25`), hundreds of lines; the next start refreshes; a fix adds branches | reject |
| 5 | blind, edge | A lazy chunk that 404s after an upgrade drops the page to `RootError` | low | real, but route chunks were already lazy (`autoCodeSplitting`), so a stale tab already fails the same way on navigation | defer |
| 6 | blind | The epic's AC still says « sorts nothing in a temporary B-tree » and « gzip or Brotli » | low | `epics.md` Story 15.5 unchanged; Design Notes record why | patch: amend `epics.md` |
| 7 | blind | Spec `in-review` while sprint status says `in-progress` | false | the workflow moves sprint status to `review` at presentation | reject |
| 8 | blind | The Story 1.5 entry of `deferred-work.md` is now covered | low | `history-volume.spec.ts` asserts the date index; the workflow forbids editing existing entries | reject |
| 9 | blind, verification | No test of a refused `ANALYZE` at startup | low | `index.ts` excluded from coverage; the same catch is tested on the import path | defer |
| 10 | blind | Matrix rows « Page 2 » and « Filter changes » have no test | medium | no e2e counts `/totals` requests; matrix audit requires one | patch |
| 11 | blind | One timed sample per target | maybe-false | 2.2 s locally against 6 s in CI; the first CI run settles it | reject: settled by CI |
| 12 | blind | Plan assertions run after the 24,000-line import | false | Vitest runs a file's tests in order; the plans then hold at 124,000 rows, a stronger case | reject |
| 13 | blind | The `volume` Vitest project is undocumented | low | `AGENTS.md` and `CONTRIBUTING.md` « Testing » say nothing of a second pass | patch |
| 14 | blind | `compress()` also covers `/api/auth/*`, where a body can carry a token beside reflected input | low | BREACH needs both in one compressed body; skipping the auth routes is one condition | patch |
| 15 | blind | `TransactionTotalsQuery` is exported and never imported | low | `grep` finds it only in `schemas/transactions.ts` | patch |
| 16 | edge | Small JSON answers are compressed below the threshold | low | `hono/compress` checks the threshold only with `Content-Length`; a few bytes of overhead | reject |
| 17 | edge | No volume check of an account page's `total` | low | `ledger.spec.ts` covers the count's value; the volume spec checks time | reject |
| 18 | verification | No test that a category rename reaches the dashboard within `staleTime` | medium | no e2e edits a category then reads the dashboard without reload | patch |
| 19 | verification | No plan assertion for two accounts filtered (`+account_id`) | medium | `history-volume.spec.ts:334` covers none, one account only | patch |
