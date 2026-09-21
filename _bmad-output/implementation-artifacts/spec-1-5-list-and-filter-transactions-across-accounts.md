---
title: 'Story 1.5: List and filter transactions across accounts'
type: 'feature'
created: '2026-09-21'
status: 'ready-for-dev'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/scaffolding-lessons.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-archant-2026-09-21/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Transactions can only be read one account at a time, with no way to search them, and nothing marks a transaction the household wants kept out of future reports.

**Approach:** Add `/operations`, one paginated list of every account's transactions with filters on account, date range, amount range and text, all held in the URL, plus a result count and a signed total. Add an "exclude from reports" flag, set in the transaction sheet and shown as a muted amount with an eye-off icon wherever a transaction is listed.

## Boundaries & Constraints

**Always:**
- Spine AD-2, AD-5, AD-6, AD-10, AD-15 and the Consistency Conventions bind; `scaffolding-lessons.md` pitfalls apply.
- `GET /api/transactions` answers `{ items, page, pageSize, total, sum }`, ordered `date DESC, created_at DESC, id DESC`. Query params: `page`, `pageSize`, `account` (repeatable id), `from`, `to` (inclusive ISO dates), `amountMin`, `amountMax` (decimal text), `q`. Every transaction item gains `excluded`; these items also carry `accountName`.
- Amount bounds compare the absolute value, as Sure's `EntrySearch`: `20` to `50` finds `-42,90` and `+42,90`. The sign filter is Epic 5's direction filter. A bound is converted per currency; a bound finer than a currency's minor unit rounds inward.
- Text: case-insensitive substring of `label` or `notes`, `%`, `_` and `\` in `q` matched literally. `LIKE`, no FTS5 unless the 300 ms target fails.
- `sum` is the signed sum of every filtered row in the reporting currency, excluded rows included, as the mockup and Sure's list totals do; rows in another currency are skipped and counted: `sum: { amount, currency, skippedCount }`.
- `excluded` is a `transactions` column, boolean, default false, lockable (`LOCKABLE_FIELDS`). It changes no balance. `PATCH /api/transactions/:id` accepts it.
- Interface: sidebar item « Opérations »; page title, a search field bound to `q`, a « Filtrer » menu adding Compte, Période, Montant, each a removable chip; « N résultats · Total : ±X » at the right; rows under day headers (reuse `TransactionList`) with date, label, account name and amount; `Pagination` at 50. A row opens `TransactionSheet`. The sheet gains a switch « Exclure des rapports ». Empty states per EXPERIENCE.md.
- Every transaction write invalidates the cross-account list too.
- Needs Story 1.7's Playwright harness. Every acceptance criterion and every interface row of the I/O matrix has a Playwright test; the rest has Vitest tests.

**Never:**
- No command palette, no keyboard shortcut layer, no selection or bulk bar, no creation from `/operations`. The palette and shortcuts are Story 1.8, decided by the project owner on 2026-09-21; `x` selection is Story 4.5.
- No category, tag, merchant or direction filter, no exchange rates, no change to balance computation. No raw SQL in application code.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Cross-account | Checking and card, 3 transactions each | 6 items, most recent first, `total 6` | — |
| Combined filters | `account=<checking>&from=2026-09-01&q=carre` | Checking rows from 09-01 whose label or notes contain "Carre" | — |
| Absolute amount | `amountMin=40&amountMax=50`, rows `-42,90`, `+45,00`, `-12,00` | First two | — |
| Literal wildcard | `q=50%`, labels `Remise 50%`, `Remise 500` | First only | — |
| Sum | EUR `-42,90` excluded, EUR `+100,00`, USD `-10,00` | `sum { amount 5710, currency EUR, skippedCount 1 }` | — |
| Exclude | `PATCH { excluded: true }` | Flag stored, `excluded` locked, account balance unchanged | — |
| Bad range | `from=2026-09-10&to=2026-09-01` | Nothing listed | `400`, field `to`, `before_from` |
| Bad amount | `amountMin=abc` or `amountMin=60&amountMax=50` | — | `400`, `invalid_amount` or field `amountMax` `below_min` |
| Unknown account | `account=<unknown id>` | Empty page, `total 0` | — |
| Performance | 50,000 transactions, no filter | First page under 300 ms | — |

</frozen-after-approval>

## Code Map

- `packages/data/schema/transactions.ts` -- add `excluded` (integer mode boolean, not null, default false) and `"excluded"` to `LOCKABLE_FIELDS`. `pnpm data generate --name add_transaction_exclusion` writes `drizzle/0003_*.sql`.
- `packages/data/schema/entries.ts` -- `entries_account_date` (L55) cannot order across accounts; add `entries_kind_date` on `(kind, date, created_at, id)` for the unfiltered first page and the count.
- `packages/data/money.ts` -- `parseAmount(text, currency)` (L238), `minorUnitsOf` (L196), `isCurrencyCode`: bounds are parsed once, then scaled per currency.
- `packages/api/src/services/ledger.ts` -- only file allowed to read `entries`/`transactions` (`.oxlintrc.json`). Generalise `listTransactions` (L521) to take an optional filter (`accountIds`, `from`, `to`, amount bounds per currency, `q`) and join `accounts` for the name; the count (L535) must join `transactions` when `q` is set. Add the sum query grouped by currency. `updateTransaction` (L334): `TransactionPatch` (L297) and the loop (L349) gain `excluded`; lock rule unchanged (L384). `transactionColumns` (L483), `toRecord` (L493) gain `excluded`.
- `packages/api/src/services/transactions.ts` -- `TransactionItem` (L22), `listAccountTransactions` (L72); add `listAllTransactions(filter)` using `getReportingCurrency` as `services/accounts.ts` (L66–80) does.
- `packages/api/src/schemas/transactions.ts` -- `pageQuerySchema` (L103), `transactionBodySchema` (L12), `updateTransactionSchema` (L75): add `excluded` (boolean) and `transactionFilterSchema`.
- `packages/api/src/routes/transactions.ts` (only `PATCH`, `DELETE` today), `app.ts` (L20–25, keep the chain), `app.spec.ts` helpers `request`, `openAccount`, `postTransaction` (L224–248); `ledger.spec.ts` helpers `openChecking`, `add`, `lockedFields` (L195–232).
- `packages/web/src/components/TransactionList.tsx` -- `groupByDay` and rows (L14–69); add an optional account name and the excluded marker. `Money.tsx` has no muted variant.
- `packages/web/src/components/TransactionSheet.tsx` -- needs `SheetAccount { id, currency, openingDate }` (L43); on `/operations` get it from `useAccount(item.accountId)`. `valuesOf` (L72) gains `excluded`.
- `packages/web/src/components/Pagination.tsx`, `lib/page-search.ts`, `comptes.$accountId.tsx` `useClampPage` (L67–86) -- hard-coded to `/comptes/$accountId`; generalise to take the route.
- `packages/web/src/hooks/useTransactions.ts` -- `useInvalidateAccount` (L39) must also invalidate `transactions.all`; `lib/query-keys.ts` (L21–26).
- `packages/web/src/components/AppSidebar.tsx` (L118–135) -- the one nav item to copy.
- `packages/web/e2e/` -- Story 1.7's harness and fixtures: fresh database per run, helpers to open an account and add a transaction through the interface.
- `~/github/sure/app/models/entry_search.rb` (L16–58) -- text, date and absolute amount filters.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/data/schema/transactions.ts`, `entries.ts`, `drizzle/0003_*.sql` -- `excluded` column, lockable, and `entries_kind_date` index.
- [ ] `packages/api/src/domain/transaction-filter.spec.ts`, `transaction-filter.ts` (new) -- tests first: `amountBoundsFor(min, max, currency)` (inward rounding, absolute) and `escapeLike(q)`. 100% branches.
- [ ] `packages/api/src/services/ledger.spec.ts`, `ledger.ts` -- tests first: filtered list, count and sum per currency, `excluded` patch and lock, a 50,000-row seeded first page timed under 300 ms; then the code.
- [ ] `packages/api/src/schemas/transactions.ts`, `services/transactions.ts`, `routes/transactions.ts`, `app.spec.ts` -- `GET /api/transactions` and `excluded` on `PATCH`; the spec covers the I/O matrix.
- [ ] `packages/web/src/components/ui/switch.tsx`, `badge.tsx` -- `pnpm dlx shadcn add switch badge`, patched for oxlint as other `ui/` files.
- [ ] `packages/web/src/lib/transaction-filters.spec.ts`, `transaction-filters.ts` (new) -- search schema (`.catch(undefined)` per param) and chip labels, tested.
- [ ] `packages/web/src/lib/query-keys.ts`, `hooks/useTransactions.ts` -- `transactions.list(filters, page)` under `transactions.all`, `useTransactions(filters, page)`, invalidation.
- [ ] `packages/web/src/routes/operations.tsx` (new), `components/TransactionFilters.tsx` (new), `TransactionList.tsx`, `Money.tsx` or an `ExcludedAmount` wrapper, `TransactionSheet.tsx`, `Pagination.tsx`, `AppSidebar.tsx`, `locales/fr.json` -- page, filters, chips, count and total, marker, switch, nav item.
- [ ] `packages/web/e2e/operations.spec.ts` (new) -- Playwright: cross-account order and account name, each filter alone and combined, reload keeping chips, removing a chip, « Effacer les filtres », count and total with a USD account skipped, pagination at 51 rows, exclusion marker on both lists with the header balance unchanged.

**Acceptance Criteria:**
- Given filters set on `/operations`, when the page reloads, then the same filters, chips and page are shown.
- Given a transaction excluded in the sheet, when the sheet closes, then its row shows the muted amount and eye-off icon with tooltip « Exclue des rapports » on `/operations` and on its account page, and the header balance is unchanged.
- Given filters matching nothing, then « Aucune opération ne correspond à ces filtres. » and « Effacer les filtres » show, and the button clears every param.
- Given the finished story, when the AGENTS.md verification gate runs, then every command passes and leaves no tracked file modified.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

The total includes excluded rows because it describes the rows on screen; AD-8's `countsInCashFlow` governs reports, which Epic 6 builds. Absolute amount bounds follow Sure and leave the sign to Epic 5's direction filter, so the mockup's « Montant < 0 » chip is not reproduced. SQLite `LIKE` folds ASCII case only: « électricité » does not match « Électricité ».

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test` -- all pass, `git status` clean afterwards.
- `pnpm test:e2e` -- `operations.spec.ts` and the Story 1.7 suite pass.
- `pnpm data migrate:local` -- applies `0003` on an existing local database.

**Manual checks:**
- Two accounts in EUR and one in USD: combine every filter, reload, clear chips one by one, exclude a transaction, check the total and the skipped count; light and dark, 1280 and 600 px.
