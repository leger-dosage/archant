---
title: 'Story 14.3: The transactions list and the drawer'
type: 'feature'
created: '2026-09-29'
status: 'done'
baseline_commit: '0787fdc52125f702e8ad22d56084a9eb11c1a5e3'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-14-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The transactions list, Archant's most used screen, still has Epic 12's proportions: 36 px rows with 22 px icons, a thin grey day bar, no column header, a one-line « N résultats · Total » in 12 px, a 448 px sheet glued to the viewport edge, and a bulk bar of 28 px controls. Sure shows the matching rows' count, income and expenses above the list, and Archant's API answers only their count and signed sum.

**Approach:** Lay the list out as Sure's `transactions/index`, `_list`, `entries/_entry_group` and `_transaction` do, in `DESIGN.md`'s tokens and with Story 14.2's primitives (`InsetGroup`, `SummaryStrip`, `TintedIcon` sizes, `amount-summary`), make the sheet Sure's inset drawer, and add the income and expense sums to `GET /api/transactions`.

## Boundaries & Constraints

**Always:**
- API. `sum` in `listAllTransactions` gains `income` and `expense`, minor units in the reporting currency beside `amount`: `income` sums the rows `DIRECTION_CONDITIONS.income` matches (positive), `expense` those `DIRECTION_CONDITIONS.expense` matches (zero or negative), so a transfer side counts in neither, as in Sure's `Transaction::Search#totals` and Archant's direction filter. Same rows as the signed sum otherwise: excluded and pending included, other currencies left out and counted in `skippedCount`. One query: `ledger.sumTransactions` returns `income` and `expense` per currency beside `amount` and `count`.
- Transactions page. Under the page header, a `SummaryStrip` card (`rounded-xl border bg-card`) with Opérations (the count), Revenus (`Money signed plusSign`) and Dépenses (`Money signed`), `aria-live="polite"`; the skipped-currency sentence stays under it. Then the list card (`rounded-xl border bg-card p-4`, `px-3 py-4` below `lg`) opening with the 36 px search field and the filters, as today's `SearchField` and `TransactionFilters`.
- List (`TransactionList.tsx`, both pages). From `md`, an `overline` column header on `bg-inset rounded-xl` naming Opération, Catégorie, Compte (only with `showAccount`, from `lg`) and Montant, on the rows' grid so the columns line up; then each day an `InsetGroup` (heading level 3, rows in its inner block) whose header holds the day and its count on the left and the day's subtotals on the right, days `gap-4` apart.
- Row. From `md`, 56 px (`h-14`): the checkbox, an `lg` tinted icon or the merchant's letter, the label with its badges over the caption, the 24 px category pill (`h-6`, 12 px icon), the account with its `sm` type icon (from `lg`), the amount right-aligned. Hover `bg-hover`; selection `bg-selection` with the 2 px `accent-brand` bar, both clipped to the inner block's corners. Below `md`, two lines: label and amount, then the date and the category pill.
- Drawer (`TransactionSheet.tsx`). From `md`: 550 px wide, 12 px from the top, right and bottom of the viewport, `rounded-xl` with a border; below `md`: the full screen, no radius. Saving on `⌘Enter`/`Ctrl+Enter`, closing on `Esc` and focus return unchanged.
- Bulk bar (`BulkBar.tsx`): its buttons at the default 36 px size, text `text-sm`.
- Account page: the same list card, column header and day groups, without the account column; it has no search today and gets none.

**Never:** no change to the signed sum's value, to the filters, to paging or to the account endpoint; no Sure inflow/outflow fallback; no sparkline; no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mixed rows | EUR +100,00, EUR -42,90 excluded, EUR -8,00 pending | `income` 10000, `expense` -5090, `amount` 4910 | — |
| Transfer | a funds movement's two sides in EUR | neither in `income` nor `expense`; both in `amount` | — |
| Other currency | EUR +100,00, USD -10,00 | `income` 10000, `expense` 0, `skippedCount` 1 | — |
| Filtered | `direction=expense` over the mixed rows | `income` 0, `expense` equals `amount` | — |
| Nothing matches | an unknown account | `income` 0, `expense` 0 | — |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/ledger.ts:4229-4241,4354-4392` -- `isTransferSide`, `DIRECTION_CONDITIONS`, `sumTransactions` (per-currency `amount`, `count`; add `income`, `expense` with `sum(case ...)`); `toRecord`.
- `packages/api/src/services/transactions.ts:63-77,253-275` -- `FilteredTransactionPage`, `listAllTransactions`.
- `packages/api/src/services/ledger.spec.ts:2523-2659,4463` and `packages/api/src/app.spec.ts:1192-1497` -- sum assertions use `toEqual` on the whole object: extend them; the 50 000-row timing test (:2743) must still pass.
- `packages/app/src/hooks/useTransactions.ts:27` -- the response type is inferred through Hono's client: no hand-written type.
- `packages/app/src/routes/_authed.transactions.tsx:82,184-213,270` -- `SearchField`, summary, `BulkBar`; `locales/fr.json:370-374` (`operations.results`, `total`, `skipped`).
- `packages/app/src/components/TransactionList.tsx` -- day header (:201-224), `li` (:255), grid templates (:278-287), row button, `CATEGORY_SLOT` (:59), account cell (:355), skeleton (:410).
- `packages/app/src/components/CategoryPill.tsx`, `StatusBadge.tsx` -- pill `h-5` → `h-6`; badges stay 20 px until Story 14.4.
- `packages/app/src/components/TransactionSheet.tsx:967-987`, `components/ui/sheet.tsx` -- widths and position.
- `packages/app/src/components/BulkBar.tsx:138-200` -- `size="sm"` buttons.
- Sure: `app/views/transactions/{index,_summary,_list,_transaction,_selection_bar}.html.erb`, `entries/_entry_group.html.erb`, `app/components/DS/dialog.rb`.
- Tests: `e2e/operations.spec.ts` (summary text at :15, :85-308), `e2e/transaction-rows.spec.ts:107-165` (height 36, day header, selection), `e2e/bulk.spec.ts:206`, `e2e/keyboard.spec.ts`, and every spec locating rows by `listitem` and `button[data-transaction-id]`: keep those locators working.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/services/ledger.spec.ts`, `app.spec.ts` -- matrix rows first, failing.
- [x] `packages/api/src/services/ledger.ts`, `transactions.ts` -- the two sums.
- [x] `packages/app/src/routes/_authed.transactions.tsx`, `locales/fr.json` -- strip and list card.
- [x] `packages/app/src/components/{TransactionList,CategoryPill,TransactionSheet,BulkBar}.tsx`, `ui/sheet.tsx` if the variant belongs there -- list, rows, drawer, bar.
- [x] `packages/app/src/routes/_authed.accounts.$accountId.tsx` -- list card on the account page.
- [x] `packages/app/e2e/*` -- strip figures (20 px, count, income, expenses, filtered, other currency); column header on `inset`; day tray and header; row 56 px with a 36 px icon and a 24 px pill; account column gone at 900 px; two-line row at 390 px; drawer 550 px, 12 px inset and radius at 1440, full screen at 390; bulk bar buttons 36 px.

**Acceptance Criteria:**
- Given any existing end-to-end test, when the gate runs, then it passes with its assertions kept or made stricter.

## Implementation Notes

- `ledger.sumTransactions` returns `income` and `expense` per currency in its one query, from the same `DIRECTION_CONDITIONS` the direction filter uses. Drizzle's `and()` may answer `undefined`, which left an unreachable branch under the ledger's 100 % branch threshold; a small `both()` builds each condition as plain SQL.
- The strip replaces « N résultats · Total » (`operations.results`, `operations.total` give way to `operations.summary.*`); while the first page loads, an `aria-hidden` copy with skeleton figures holds its place. The other-currency sentence now says the rows are left out of « Revenus » and « Dépenses ».
- `TransactionListCard`, exported from `TransactionList.tsx`, wraps the list on both pages. The column header is `aria-hidden`: each row already names its cells. Column widths are fractions so the row button's centre stays on the label at any width; with fixed widths it fell on the category pill at 1440 px.
- `InsetGroup` gains a `detail` slot beside its heading, for the day's count.
- The drawer's inset and radius live in `TransactionSheet.tsx`, not `ui/sheet.tsx`, which also serves the full-screen accounts overlay.
- Below 768 px the second line holds the date (`formatShortDate`) and the pill; the merchant caption and tags stay from 768 px up. Status badges show their icon only there (`StatusBadge`'s `iconBelowMd`), their text kept for assistive technology.
- Shared-database amounts: the summary and amount-filter tests type random amounts (`typedCents`), since a fixed income could be matched as a transfer with another test's row.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|---|
| 1 | blind, edge, verification | The other-currency sentence still names a total the page no longer shows | medium | `operations.skipped_*` says « pas comptée dans le total »; `sum.amount` is read nowhere in the app | patch |
| 2 | blind | The net signed sum left the screen; day subtotals include transfers | false | Sure's `transactions/_summary` shows count, income and expenses only; the intent asks for those three | reject |
| 3 | blind | The strip colours income and expenses | false | expenses use the text colour; income green matches the dashboard's month strip, as before this story | reject |
| 4 | blind, edge | The strip appears only when data lands, the list jumps | low | no placeholder while `isPending` | patch |
| 5 | blind, edge, verification | Below 768 px, badges clip or squeeze the label to nothing | medium | badges `shrink-0` in an `overflow-hidden` line; `max-md:flex-wrap` removed | patch |
| 6 | blind, edge | Mobile rows drop the merchant caption and tags | false | the intent's two lines are label and amount, then date and category | reject |
| 7 | blind | `InsetGroup` doc says the heading's parent holds the total | low | `detail` wraps the heading; tests moved to `../..` | patch |
| 8 | blind | `isTransferSide` evaluated twice per row in the sum | low | indexed `exists`; the 50 000-row test runs in ~80 ms of 300; not measured with transfers | reject |
| 9 | blind, verification | Amount-filter test relies on a fixed 45,00 income in the shared database | medium | another test's -45,00 row within four days would be matched as a transfer | patch |
| 10 | blind | Spec artifact names a machine-local script and has empty notes | false | a spec edit, not a code finding; notes are filled at the end of the run | reject |
| 11 | blind | Skeleton hard-codes the column header's 42 px | low | cosmetic, one constant | reject |
| 12 | blind | Empty and error boxes framed inside the list card | low | Story 14.4, stacked on this one, turns every empty box into a card or note | reject |
| 13 | edge | `bulk.spec.ts` count assertion matches 160 or 600 | low | `toContainText("60")` | patch |

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- expected: all pass.
- `bash /tmp/archant-e2e-locked.sh` instead of a bare `pnpm test:e2e` -- another worktree may be running the suite on port 8788; the script waits for it, then runs the suite (pass Playwright arguments to run a subset). Start it in the background: waiting plus the run can exceed ten minutes.
