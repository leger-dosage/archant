---
title: "Story 27.16: Categories as Sure in the transaction list"
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_commit: 'e21634be194dcaf0467d4fe927545ebd01110dc5'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A transaction's category pickers cannot create a category, where Sure's can (`e8e142db6`, `7dc33b990`); a loan payment's or contribution's inflow hides its category, and the sheet shows merchant and tags on transfer sides, where Sure does neither; a day's header sums transfers and shows a transfer twice when both sides are on the page, where Sure's `calculate_total` and `entries_by_date` do not (Sure read at `origin/main` `275f2f994`).

**Approach:** Turn on and extend `CategoryCombobox`'s create option in the sheet's and the row's pickers, with Sure's subcategory step; show the outflow's category, read-only, on the inflow of a loan payment or contribution, as Sure's `7e1d93613`; leave transfer sides out of day totals and drop an inflow whose outflow is on the page.

## Boundaries & Constraints

**Always:**
- « Créer « nom » » shows when the trimmed text is non-empty and no category holds it, case and accents aside (`isNewName`); it creates a top-level `expense` category, icon `tag`, colour `CATEGORY_COLORS[0]` in `CategoryField`, a random `CATEGORY_COLORS` swatch in the row's `CategoryChip`, as Sure's two pickers, then sets it.
- « Ajouter comme sous-catégorie… » shows beside it when at least one top-level category exists; it replaces the list by « Créer « nom » dans : » and the top-level categories by name, with « Retour » first; `Escape` and editing the text go back too. Picking a parent creates the child under it, kind and colour inherited by `createCategory`, and sets it.
- A failed creation shows the toast « Impossible de créer la catégorie ». In the row's picker, a category created but not set shows « Catégorie créée, mais impossible de l'attribuer. Choisissez « Créer » à nouveau pour réessayer. » and keeps the picker open; « Créer » with the same name and parent then retries the assignment with the remembered id, posting nothing.
- `CategoryField`, so the sheet, the new-transaction sheet, the split dialog and the bill dialog, and the row picker shown to an administrator, offer creation, as Sure's `DS::CategorySelect` and quick picker. The rule form keeps it, with these words.
- The outflow of a `loan_payment` or `investment_contribution` keeps its editable category. Its inflow shows the outflow's category, disabled: in the sheet with « C'est le côté entrant d'un transfert. Sa catégorie appartient au côté sortant et ne se modifie que là, pour que les budgets la comptent une fois. », in the row a muted chip with the tooltip « La catégorie appartient au côté sortant de ce transfert et ne se modifie que là. » `PATCH /api/transactions/:id` refuses a `categoryId` for that inflow with `VALIDATION_ERROR`, `fields: [{ path: "categoryId", code: "set_on_outflow" }]`. What counts stays Story 27.6's.
- The sheet hides merchant and tags on every transfer side.
- `groupByDay`'s subtotals leave out every row with a `transfer`, pending included; a row whose `transfer.counterpartTransactionId` is on the page and whose amount is positive is not shown, its outflow is. A day whose rows are all transfers keeps no subtotal.

**Never:** no creation in the bulk bar or the filters; no change to the « Sans catégorie » filter, the bulk edit's silent drop, rules or the assistant's tools, whose `update_transaction` Sure leaves unguarded; no automatic contribution category; no other list total changes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Name taken | « courses » with « Courses » | no « Créer » | none |
| Subcategory | « Bio », parent « Alimentation » (income, green) | child income, green, set | create fails: toast |
| Assignment fails | PATCH 500 after POST 201 | assign message, picker open; « Créer » retries PATCH only | none |
| Loan inflow | outflow « Prêt immo » | inflow shows « Prêt immo », disabled | PATCH categoryId: 400 `set_on_outflow` |
| Day with transfer | −50 € groceries, −500 € / +500 € loan pair | one row −500 €, subtotal −50 € | none |
| Lone inflow | +500 €, outflow on another page | shown, not summed | none |

</frozen-after-approval>

## Code Map

- `packages/app/src/components/CategoryCombobox.tsx:47-140` -- `allowCreate`, `canCreate`, `create()`: add the parent step (a second view inside the same `Command`), a `color` choice from the caller, `onCreateError` message, and a remembered `{ name, parentId, id }` for the retry; the doc comment's « best picked, not made up » goes.
- `packages/data/category-presets.ts:101` -- `newCategory(name)`; reuse, override `color` and `parentId`.
- `packages/app/src/hooks/useCategories.ts:50-66` -- `useCreateCategory`, reused.
- `packages/app/src/components/TransactionFields.tsx:19-81` -- `CategoryField`; pass `allowCreate`, first swatch; read-only variant for an inflow (disabled button and the note).
- `packages/app/src/components/TransactionList.tsx:97-134,329,493-512,544,594-608` -- `CategoryChip` with `allowCreate` when `useIsAdmin()`, random swatch, the assign error kept in the picker; `categoryShown` and the muted chip for an inflow; day rendering.
- `packages/app/src/hooks/useTransactions.ts:148,220` -- `useSetRowField`, `useSetTransactionCategory`: let the chip learn of a failed PATCH (an `onError` callback) instead of only the generic toast.
- `packages/app/src/lib/transfers.ts:40-45` -- `showsCategory`; add `categorySetOnOutflow(amount, transfer)` (positive amount, expense kind).
- `packages/app/src/components/TransactionForm.tsx:192,310,369,383-407` -- inflow shows the read-only field, never sends `categoryId`; merchant and tags hidden when `transaction.transfer !== null`.
- `packages/api/src/services/ledger/queries.ts:77-150` -- `TransferLink`: add `counterpartCategoryId` (the outflow's category, read through the existing join), so the inflow row names it from the cached categories.
- `packages/api/src/routes/transactions.ts` -- the PATCH refuses `categoryId` on such an inflow, before `updateTransaction`, so the MCP path stays Sure's.
- `packages/app/src/lib/transaction-days.ts:72-104` -- `groupByDay`: dedupe, then skip transfer rows in subtotals; `shownOrder` follows the deduped rows.
- `packages/app/src/locales/fr.json:349-358,2385` -- `transactions.category.create` becomes « Créer « {{name}} » »; new keys for the subcategory step, the two errors, the two inflow texts; `errors.fields.set_on_outflow`.
- `packages/app/e2e/categorise.spec.ts:100-108` -- the test that asserts no « Créer » goes; `rules.spec.ts:808,867,926` take the new wording and error.
- `docs/sure-parity.md:147-148,165,191` -- rows to update.

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/lib/transaction-days.spec.ts` -- first: a day with a paired transfer on the page, a lone inflow, a pending proposal, an all-transfer day -- the story's Vitest criterion.
- [x] `packages/api/src/routes/transactions.spec.ts` -- first: PATCH `categoryId` on a loan inflow is 400 `set_on_outflow`, on its outflow 200; list rows carry `counterpartCategoryId`.
- [x] `packages/app/src/lib/transaction-days.ts` -- dedupe and Sure's subtotal.
- [x] `packages/api/src/services/ledger/queries.ts`, `routes/transactions.ts` -- the counterpart's category and the refusal.
- [x] `packages/app/src/components/CategoryCombobox.tsx` -- create, subcategory step, errors, retry.
- [x] `TransactionFields.tsx`, `TransactionForm.tsx`, `TransactionList.tsx`, `lib/transfers.ts`, `hooks/useTransactions.ts` -- wiring, read-only inflow, hidden merchant and tags.
- [x] `packages/app/src/locales/fr.json` -- the strings above.
- [x] `packages/app/e2e/categorise.spec.ts` -- create « Voyages » from the sheet, then « Train » under it from a row; `transfers.spec.ts` -- the loan inflow shows the outflow's category disabled with the note, and the day header of the loan test reads the groceries total alone -- the story's Playwright criterion.
- [x] `docs/sure-parity.md` -- « Day totals » and « Creating a category from the pickers » Parity, Story 27.16; « Category of a transfer side » Parity, its Sure column: outflow editable since `a92dec1e6`, inflow read-only since `7e1d93613`, merchant and tags hidden in the drawer, contributions' automatic category on the outflow; the rule form row keeps Different only for what Sure's rule pickers lack.

**Acceptance Criteria:**
- Given a viewer, when they open a row's picker, then no « Créer » shows.
- Given an inflow previously categorised, when the list shows it, then it shows the outflow's category, not its own.

## Design Notes

The epic's criterion says « categorise both sides … the inflow included », from Sure's `a92dec1e6` of 8 October. Sure's `7e1d93613` of 9 October, after the epic's read of `00dd977fb`, keeps the category on the outflow and shows it disabled on the inflow, because a category picked there « would look saved but never reach a budget »; Archant counts neither inflow (Story 27.6). The owner's rule is to follow Sure, so this story follows `7e1d93613`.

Sure's two inflow texts are English only; the French above is Archant's. Sure's `create_error` and `assign_error` have no French either; the epic gives the latter.

## Verification

**Commands:**
- `pnpm --filter @archant/app exec vitest run src/lib/transaction-days.spec.ts` -- expected: pass.
- `pnpm --filter @archant/api exec vitest run src/routes/transactions.spec.ts` -- expected: pass.
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- expected: all green.

**Manual checks (if no CLI):**
- Screenshots, light and dark: the picker's « Créer » and subcategory step, a loan inflow's sheet and row, a day header beside a loan payment.

## Implementation Notes

- `TransferCandidate` gains `categoryId`, so an inflow paired from its own sheet shows its outflow's category at once rather than « Sans catégorie » until the sheet reopens. `get_transfer_candidates` maps its rows field by field and is unchanged.
- The counterpart's category is read through a fourth alias, `counterpartTransaction`, joined on `counterpartEntry` in `findTransaction` and `listSelect`.
- `Escape` in the parent step is caught by a window capture listener: Radix's popover dismisses on a document capture listener, which a React handler runs too late to stop.
- Every e2e test that read an inflow beside its outflow on one page now asserts it hidden there and reads it on a page of its own (`expectInflow` in `transfers.spec.ts`); `transaction-rows.spec.ts` counts six rows instead of eight.
- After the self-review: `categorySetOnOutflow` lives in `@archant/data/transfer-kinds.ts`, so the route and the interface read one rule; the row picker's « Ajouter comme sous-catégorie… » no longer truncates in its 18 rem popover.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | blind | An inflow keeps its own category in the database, which the category filter still matches | low | Sure keeps `category_id` on the inflow too and filters by it; the frozen Never leaves the filters alone | reject |
| 2 | blind, edge | The refusal also blocks `categoryId: null` and a pending transfer's inflow | false | Sure's `transactions_controller` drops `category_id` whatever its value, and `transfer_as_inflow` holds a pending transfer too | reject |
| 3 | blind, edge | Merchant and tags hidden in the sheet but still shown on the row, or saved when paired in the same sheet | low | Sure's row keeps its tags menu and only the drawer hides them; saving a value set before pairing is the same as setting it first | reject |
| 4 | blind | `isNewName` ignores case but not accents, so « cafe » offers « Créer » beside « Café » | false | Sure compares lowercased names only, and `assertNameFree` accepts « cafe » beside « Café » | reject |
| 5 | blind | The viewer e2e check passes by construction | low | `TransactionForm`'s `fieldset disabled={!admin}` keeps every picker shut for a viewer; the test adds little but asserts nothing false | reject |
| 6 | blind | No creation test in the split and bill dialogs, nor of the row's random colour | low | Both reach the same `CategoryField` the sheet test drives; a random colour has no stable expectation | reject |
| 7 | blind | The PATCH refusal is tested for a loan payment only | medium | No contribution or `internal_move` case in `routes/transactions.spec.ts` | patch |
| 8 | blind | No Vitest for `CategoryCombobox` | low | Playwright drives create, subcategory, Back, Escape and the retry | reject |
| 9 | blind, edge | After a remembered top-level creation, picking a parent posts the same name again and fails `name_taken` | low | Sure's quick picker posts again for a different parent and fails the same way | reject |
| 10 | blind | A page shows fewer rows than its size once an inflow is dropped, while counts keep both sides | low | Sure's `entries_by_date` dedupes the rendered page only, and its pagination counts both sides | reject |
| 11 | blind, edge | The inflow check reads outside `updateTransaction`'s transaction | low | A pairing between the read and the write needs two concurrent requests from the one household; guarding it adds a service flag | reject |
| 12 | blind | The row's reason is a tooltip only, unreadable on touch | low | Sure's row shows the same tooltip on desktop and a plain badge on mobile | reject |
| 13 | blind | Spec boxes unticked, Code Map missing the candidate's `categoryId` | false | Boxes ticked at review; the addition is in Implementation Notes | reject |
| 14 | edge | « Créer » clicked again while the assignment is in flight sends a second PATCH | low | Needs a click within one request's time; the fix adds a prop | reject |
| 15 | edge | A failed creation shows the generic message instead of the server's reason | false | The frozen block asks for « Impossible de créer la catégorie » | reject |
| 16 | gap | A transfer candidate's `categoryId` is asserted only as `null` | medium | `services/ledger/transfers.spec.ts:78` is the only assertion | patch |
| 17 | gap | Merchant and tags hidden is asserted only on a loan's inflow | medium | `e2e/transfers.spec.ts:392-393` is the only check | patch |
