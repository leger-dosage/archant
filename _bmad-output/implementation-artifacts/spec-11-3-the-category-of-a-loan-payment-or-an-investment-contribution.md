---
title: 'Story 11.3: The category of a loan payment or an investment contribution'
type: 'bugfix'
created: '2026-09-25'
status: 'done'
baseline_commit: 'e5d7cd5c7bdc8d9f69a92da747739a44a6ce4084'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The dashboard counts the outflow of a `loan_payment` or `investment_contribution` transfer in its category (`countsInCashFlow`, `cashFlowByCategory`), but the list shows the transfer chip in place of that category, the sheet hides the category field, and a bulk edit skips the row. A category set before the match, or by a rule, is counted and can be neither seen nor changed.

**Approach:** One rule decides whether a row shows its category: not a transfer side, or the spent outflow that `direction` already calls an expense. The list, the sheet, the row shortcut and bulk edit follow it, as Sure lets a loan payment keep an editable category (`Transfer#categorizable?`). The dashboard already counts correctly; tests pin it.

## Boundaries & Constraints

**Always:**
- A spent outflow (negative amount, kind in `EXPENSE_TRANSFER_KINDS`) shows `CategoryChip` in the list, `CategoryField` in the sheet, opens its picker on `c`, and takes a category from bulk edit. The inflow side of those transfers, and both sides of `internal_move` and `credit_card_payment`, keep `TransferChip` and hide the category, as today.
- The kind stays visible on a spent outflow row: its subtitle reads « {kind} · Vers {compte} », as Sure's row says « Loan payment • A → B ». Other transfer sides keep « Vers/Depuis {compte} » alone.
- Web code reads the rule from one helper in `packages/web/src/lib/transfers.ts`, also replacing `recurrable` in the sheet (same rule). The API reuses `isTransferSide` for bulk edit, so SQL and `direction` cannot disagree.
- `domain/**` and `services/ledger.ts` stay at 100 % branches; no test reaches the network.

**Never:** no automatic « Versements » category (Spec 7.2 keeps it out); no category on the inflow of a loan payment, even though Sure shows one there; no change to `direction`, `countsInCashFlow` or `cashFlowByCategory`; no API refusal of a category on a hidden transfer side; no change to rules, which already set a category on any row; no migration.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Uncategorised loan payment | checking −1 200 € linked to a mortgage | outflow row: « Catégorie : Sans catégorie » button, subtitle « Remboursement de prêt · Vers {prêt} »; loan row: chip « Remboursement de prêt »; dashboard « Sans catégorie » −1 200 € | — |
| Category picked on the outflow | list picker or sheet sets « Logement » | row shows « Logement »; dashboard line « Logement » −1 200 €; its drill-down lists the outflow | — |
| Category set before the match | categorised −500 €, then linked to a PEA | category shown and counted | — |
| Bulk edit over mixed rows | spent outflow, loan inflow, internal move sides | only the spent outflow takes the category | — |
| Dissociated | spent outflow with a category, « Dissocier » | category kept, standard row | — |
| Internal move, card payment | either side | chip, no category field, `c` does nothing | — |

</frozen-after-approval>

## Code Map

- `packages/web/src/lib/transfers.ts` -- `transferCaption`, `TRANSFER_COLOR`; add the helper here (name e.g. `showsCategory(amount, transfer)`), reading `EXPENSE_TRANSFER_KINDS` from `@archant/data/transfer-kinds`.
- `packages/web/src/components/TransactionList.tsx:138-151` -- `TransferChip` and its doc comment; `:297-302` the `categoriseRow` shortcut's transfer check; `:363-370` subtitle built from `transferCaption`; `:517-518` chip or `CategoryChip`.
- `packages/web/src/components/TransactionSheet.tsx:522-529` -- `expenseKinds` and `recurrable`, replaced by the helper; `:656-657` `categoryId` sent only when `transfer === null`; `:734` recurring block; `:789-790` category field gate.
- `packages/api/src/services/ledger.ts:2314` -- `selectedRows` selects `inTransfer`; `:2395-2408` `bulkUpdateTransactions` skips the category when `inTransfer`. Select `isTransferSide` (`:3889`, spent outflows already left out) instead, keep `inTransfer` nowhere else in this function.
- `packages/api/src/services/ledger.ts:3838-3860` -- `categoryCondition`: unchanged, already lists spent outflows under « Sans catégorie »; its comment stays true.
- `packages/api/src/app.spec.ts:6323-6362` -- loan and contribution cash-flow tests; helpers `openOwn`, `spend`, `listed`, `cashFlowOf`, `line`, `mortgage`, `pea`, `sendOwn`.
- `packages/api/src/services/ledger.spec.ts:4381` -- `matchedOf(kind, outflowAccount, inflowAccount)` helper for bulk tests.
- `packages/web/e2e/transfers.spec.ts:238-340` -- loan and PEA tests asserting the outflow's kind chip; helpers `visitOperations`, `rowItem`, `rowButton`, `sheet`, `api.categorise`, `api.createCategory`, `api.unlinkTransfer`, `api.matchTransfer`.
- `packages/web/src/locales/fr.json:312-317` -- `transactions.transfer.kinds`; no new key needed.
- `docs/sure-parity.md:140-153` -- Transfers table.

## Tasks & Acceptance

**Execution:**
- [x] `packages/web/src/lib/transfers.spec.ts` -- tests first: the helper for no transfer, each kind on either sign.
- [x] `packages/api/src/app.spec.ts` -- tests first: a loan payment's outflow categorised through `PATCH /api/transactions/:id` counts in that category's line and its drill-down (`?category=<id>&from&to`) lists it; a contribution categorised before its match keeps and counts its category.
- [x] `packages/api/src/services/ledger.spec.ts` -- tests first: bulk categorisation over a spent outflow, a loan inflow and an internal move side changes the outflow alone.
- [x] `packages/web/src/lib/transfers.ts` -- the helper.
- [x] `packages/api/src/services/ledger.ts` -- bulk edit reads `isTransferSide`; update the comment at `:2406`.
- [x] `packages/web/src/components/TransactionList.tsx` -- chip, shortcut and subtitle follow the helper; update `TransferChip`'s comment.
- [x] `packages/web/src/components/TransactionSheet.tsx` -- category field and its save follow the helper; `recurrable` goes.
- [x] `packages/web/e2e/transfers.spec.ts` -- update the loan and PEA tests (outflow: category button and kind in the subtitle; inflow: chip); add: picking « Logement » on the loan outflow's row shows it on the dashboard line of that month; the sheet of a PEA outflow saves a category; a card payment's sides show no category button and their sheet no « Catégorie » field.
- [x] `docs/sure-parity.md` -- new Transfers row « Category of a transfer side »: Sure, editable on loan payments, badge otherwise, automatic category on contributions; Archant, editable on the outflow of loan payments and contributions, hidden elsewhere; « Different. Spec 11.3: the dashboard counts that outflow, so the list shows what it counts. »

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then every matrix row has an automated test: Playwright for what the interface shows, Vitest for the rest.

## Implementation Notes

- The helper is `showsCategory(amount, transfer)`; the list names its result `categoryShown`.
- The spent-outflow subtitle goes through a new key, `transactions.transfer.spentCaption` (`{{kind}} · {{caption}}`), rather than joining two strings with a hard-coded separator.
- Bulk edit reads `isTransferSide` as `categoryHidden`: `transferSide` shadowed a name and failed `no-shadow`.
- The parity row stays within the table's column widths so the table does not reflow.
- A web import of `direction` from the API would remove the third copy of the rule, but `@archant/api` exports no `domain/*` path; left as is, like `recurrable` before it.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| `showsCategory` repeats `direction`'s spent-outflow rule with no parity test | low | Same duplication `recurrable` had before; a shared predicate in `@archant/data` is a refactor across packages. | rejected |
| `it.each` table hard-codes the four kinds | low | A fifth kind is unlikely; covering it needs a list the code does not export. | rejected |
| SQL tells the outflow by `outflowTransactionId`, the web by sign | false | `isTransferCandidate` requires non-zero opposite amounts, so the outflow is always the negative side. | rejected |
| Sheet reads the saved amount, not an edited sign | low | `transferCaption` already reads the saved amount; the form shows saved state until saved. | rejected |
| « Category set before the match » has no Playwright test | low | Showing a category takes the same path whenever it was set; the loan test covers the display. | rejected |
| Internal move sides have no Playwright check (blind and edge-case layers) | medium | Matrix row asks for chip and no category on both kinds; only the card payment was checked. | patch |
| Negative `c` check can pass before the picker renders (all three layers) | low | A keydown is a discrete event, which React commits synchronously before `press` resolves; the loan test proves `c` opens the picker. | rejected |
| Bulk edit returns 4 while changing one row | false | `bulkUpdateTransactions` documents that it counts matched rows, unchanged ones included. | rejected |
| Subtitle joins two translations with a hard-coded « · » | low | Visible text outside the translation layer; one key fixes it. | patch |
| `categoryHidden` names a UI choice in the service | low | The name says what the flag is used for; renaming to `transferSide` hit `no-shadow`. | rejected |
| PEA test title stale | low | Test now picks a category in the sheet. | patch |
| Contribution test takes the first `?category=` row without checking it is alone | low | Assertion weaker than its sibling's. | patch |
| Spec `in-review`, sprint status `in-progress` | false | Sprint status moves at the presentation step, by design. | rejected |
| Parity row silent on the loan payment's inflow | low | Sure makes both sides categorisable; Archant hides the inflow. | patch |
| Kind prefix absence on chip-keeping sides untested (verification gap) | medium | `toContainText` assertions still pass if the prefix leaks onto every side. | patch |

## Design Notes

The rule already exists three times: `direction` in `domain/cash-flow.ts`, `isTransferSide` in SQL, `recurrable` in the sheet. The story makes the category follow it rather than adding a fourth. The inflow of a loan payment is not counted by the dashboard, so hiding its category keeps « what the dashboard counts is what the list shows » true where Sure would show it.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint:code && pnpm test` -- expected: green, `domain/**` and ledger at 100 % branches.
- `pnpm test:e2e` -- expected: green.
