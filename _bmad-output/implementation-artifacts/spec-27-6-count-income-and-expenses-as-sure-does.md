---
title: 'Story 27.6: Count income and expenses as Sure does'
type: 'bugfix'
created: '2026-10-10'
status: 'done'
baseline_commit: 'e60e93eed1a54307058234ebfc4286fc678ac164'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `cashFlowBreakdown` in `domain/cash-flow.ts` files each category's signed net under its category's `kind`, so a refund lowers an expense and an income category's outflow stays income; `cashFlowByCategory` counts dividends and interest as uncategorised income; nothing leaves out a PEA or an assurance-vie. Sure (`origin/main` `7e1d93613`) classifies each line by its sign (`classification_sql`, loan payments and contributions always expenses), sums each category's side as `ABS(SUM)` (`IncomeStatement::Totals`), counts no trade (`trades_subquery_sql` is `WHERE false`), leaves out `tax_advantaged_account_ids`, and nets each top-level category only for the dashboard and the budget's spending (`net_category_totals`).

**Approach:** split the domain into Sure's two views over the same counted rows: a gross view (`IncomeStatement::Totals`, `build_period_total`) and a net view (`net_category_totals`), the category's `kind` read by neither; drop the income trades; take the tax-advantaged accounts out of the accounts every cash-flow read counts. Each consumer reads the view Sure's counterpart reads.

## Boundaries & Constraints

**Always:**
- A counted row: a `transaction` entry, neither excluded nor pending, on an active, reported, reporting-currency account that is not tax-advantaged, and not a transfer side unless it is the outflow of a `loan_payment` or `investment_contribution`. Income when its amount is above zero, expense otherwise; such an outflow is always an expense.
- Gross view: per category and side, a sub-category's rows rolled into its top-level parent, the side's sum, so a category may sit on both sides and a refund is income in its category. « Sans catégorie » on each side. Sub-category lines per side, as `subcategory_totals`. Expense amounts stay negative (AD-5); magnitude equals Sure's `ABS(SUM)`.
- Net view: per top-level category, « Sans catégorie » included as Sure's `:uncategorized` key, gross income plus gross expense; a positive net is an income line, a negative one an expense line, zero dropped. Its totals are the sums of its lines.
- Consumers: `getCashFlow` and the dashboard read the net view, the summary strip included; `getIncomeStatement`, its periods, its previous period and `monthlyStatistics` read the gross view; `actualsOf` takes spending from the net view (`total_net_expense`) and income from the gross view (`actual_income`); `netsOf` nets every category whatever its kind and nets « Sans catégorie » the same way (`budget_category_actual_spending`), floored at zero; `monthlyExpenses` in `services/goals.ts` follows `suggestions`.
- `TAX_ADVANTAGED_SUBTYPES` in `@archant/data/account-types.ts`: `pea`, `assurance_vie`, Sure's `:tax_advantaged` subtypes Archant has. `getIncomeStatement` refuses one in `accountIds` as `unknown_account`, as it refuses any account it would silently report as zero.
- Transaction list totals (`sumTransactions`): tax-advantaged accounts' rows leave the income and expense sums, as `Transaction::Search#totals`; `count` and `amount` keep every row, since the list pages on them.
- Decided by the owner on 2026-10-10: the list's « Sens » filter, its totals and the rule condition follow Sure's `Transaction::Search#apply_type_filter` and `Rule::ConditionFilter::TransactionType`: every transfer side is `transfer`, a loan payment or contribution outflow included, so `direction` returns `transfer` for any side and the filter's SQL twins follow. The recurring callers of `direction` keep today's test, the outflow of those two kinds not a transfer, under a name of their own until Story 27.24, so a loan bill stays payable.
- The dashboard's « Sans catégorie » line links to the uncategorised list without `direction`, since the net line holds both signs.
- AD-9 rewritten: the two views, Sure's sign classification, no trade, tax-advantaged accounts out, kind for display only. AD-22 drops dividends and interest counted as income. `docs/sure-parity.md` « Cash flow » (line 234): Parity for the classification, the trades and the tax-advantaged accounts, Story 27.6, the one-time kind and medians still Later for 27.7; « Investment » (line 62) drops « counted as income ».

**Never:** no change to net worth or balance sheet accounts (`reportedAccounts` stays); no one-time kind or median rewrite (Story 27.7); no category `kind` removal (Sure dropped it in #1160; out of this story); no assistant output format change (Story 27.12); no migration.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Refund | « Courses » −100 €, +30 € | gross: expense −100, income +30 in « Courses »; net: expense line −70 | none |
| Category net income | « Courses » −20 €, +50 € | net: income line +30 | none |
| Income-kind category spends | « Salaire » −40 € | gross and net: expense line −40 | none |
| Dividend | trade, `income_kind` dividend, +12 € | counted nowhere; « Ordres » lists it | none |
| PEA line | PEA cash line −15 € | counted nowhere; checking → PEA contribution −200 € still an expense | none |
| Loan payment | outflow −500 € of `loan_payment` | expense, gross and net | none |
| Uncategorised both signs | −80 €, +100 € | gross: −80 and +100; net: income +20 | none |
| Budget | refund beyond spend in an envelope | that envelope spends 0; income reads gross | none |
| PEA asked | `get_income_statement` `account_ids` [pea] | refused | `VALIDATION_ERROR`, `unknown_account` |

</frozen-after-approval>

## Code Map

- `packages/api/src/domain/cash-flow.ts` -- `direction`, `countsInCashFlow` (l.31-55): `countsInCashFlow` keeps its meaning through its own test of the expense kinds. `cashFlowBreakdown` (l.111) becomes the gross view; add the net view beside it; `subcategoryLines` (l.170) gives per-side lines. `CashFlowCategory.kind` stays for display only.
- `packages/api/src/services/ledger/queries.ts:527-600` -- `countedInCashFlow` builds the counted predicate itself instead of `direction: ["income","expense"]`; delete `incomeTradesIn` and its union in `cashFlowByCategory` and `cashFlowKeyed`. Grouping by `categoryId` and sign stays.
- `packages/api/src/services/ledger/queries.ts:430` -- `sumTransactions`: `accountIds` it receives for the income and expense sums exclude tax-advantaged accounts; keep the joins it has.
- `packages/api/src/services/ledger/filter.ts:146-180` -- `transferSideOf`, `correlatedTransferSide`, `joinedTransferSide`: `is` becomes any transfer side, `notInArray(..., EXPENSE_TRANSFER_KINDS)` goes; `filter.spec.ts` keeps them tied to `direction`.
- `packages/api/src/services/reports.ts:87,279-345,425-530` -- `reportedAccounts` untouched; a `cashFlowAccounts` beside it drops `TAX_ADVANTAGED_SUBTYPES`; `getCashFlowWithRows` (net), `getCashFlowHistory` (rows and both views per month), `getIncomeStatement` and `monthlyStatistics` (gross).
- `packages/api/src/domain/budgets/actuals.ts:29` -- `actualsOf` takes the two views; `suggestions` follows. `packages/api/src/domain/budgets/categories.ts:203` -- `netsOf` drops the `kind === "expense"` test and nets « Sans catégorie ».
- `packages/api/src/services/budgets.ts:218-410`, `services/goals.ts:163` -- callers; types follow.
- `packages/data/account-types.ts:21` -- add `TAX_ADVANTAGED_SUBTYPES`.
- `packages/app/src/components/CashFlowSection.tsx:42-88` -- drop `direction` from the uncategorised link; `alongSide` has nothing left to skip, remove it.
- `packages/api/src/mcp/reports.ts:167-214` -- `get_income_statement` reads the gross view's lines; shape untouched.
- Recurring and rules callers of `direction`: `domain/rules/matching.ts:230`, `domain/recurring/{identifier,series,matcher}.ts`, `services/recurring/{bills,series}.ts` -- rules keep calling `direction` and follow Sure; the recurring ones switch to a domain helper keeping today's rule, its comment naming Story 27.24.
- Tests: `domain/cash-flow.spec.ts`, `services/ledger/queries.spec.ts:550-730` (the l.693 dividend test flips), `services/ledger/filter.spec.ts` parity, `services/reports.spec.ts:200`, `routes/reports.spec.ts:270`, `mcp/reports.spec.ts:126`, `routes/budgets.spec.ts:332` (income from an investment account), `domain/budgets/{actuals,categories}.spec.ts`, `services/history-volume.spec.ts` plans; e2e `packages/app/e2e/dashboard.spec.ts:387-560`, `transfers.spec.ts:289,370`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/cash-flow.spec.ts` -- failing first: every matrix row but the last two, on both views.
- [x] `packages/api/src/domain/cash-flow.ts` -- gross and net views; `countsInCashFlow`; `direction` returns `transfer` for every side (the l.29 test flips); the recurring helper.
- [x] `packages/api/src/services/ledger/filter.ts`, `filter.spec.ts` -- the SQL twins; a loan payment outflow under « Transfert ».
- [x] `packages/api/src/domain/rules/matching.spec.ts` -- failing first: a « type = dépense » condition no longer matches a loan payment outflow.
- [x] `packages/api/src/domain/recurring/*`, `services/recurring/{bills,series}.ts` -- the helper; their specs unchanged and green.
- [x] `packages/data/account-types.ts` -- `TAX_ADVANTAGED_SUBTYPES`.
- [x] `packages/api/src/services/ledger/queries.spec.ts` -- failing first: a dividend and interest counted nowhere; a contribution outflow counted; then `queries.ts`.
- [x] `packages/api/src/services/reports.spec.ts`, `routes/reports.spec.ts`, `mcp/reports.spec.ts` -- failing first: a PEA line left out, a PEA in `accountIds` refused, the net dashboard lines, the gross statement; then `services/reports.ts`.
- [x] `packages/api/src/domain/budgets/actuals.spec.ts`, `categories.spec.ts`, `routes/budgets.spec.ts` -- failing first: the budget row of the matrix, an income-kind category's spend in total spending, uncategorised netted; then the two modules, `services/budgets.ts`, `services/goals.ts`.
- [x] `packages/api/src/services/ledger/queries.spec.ts` -- `sumTransactions` leaves a PEA out of income and expenses, keeps it in `count`.
- [x] `packages/api/src/services/history-volume.spec.ts` -- the cash-flow plans still pass; update only the names they assert.
- [x] `packages/app/src/components/CashFlowSection.tsx` -- the link and `alongSide`.
- [x] `packages/app/e2e/transfers.spec.ts:471` -- « Sens » lists a loan payment outflow under « Transfert ».
- [x] `packages/app/e2e/dashboard.spec.ts` -- one month holding a refund, a category with net income, a dividend, a PEA line and a loan payment: « Revenus », « Dépenses » and each line read Sure's net view.
- [x] `docs/architecture.md`, `docs/sure-parity.md` -- AD-9, AD-22, rows 62 and 234.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass and each consumer's spec names the figure this story changes in it.
- Given a month holding only a PEA's lines and a dividend, when the dashboard loads, then it shows no income and no expense.

## Implementation Notes

- `domain/cash-flow.ts` exports `grossCashFlow` and `netCashFlow` in place of `cashFlowBreakdown` and `subcategoryLines`; `recurringDirection` keeps the old rule for `domain/recurring/*` and `services/recurring/{bills,series}.ts`.
- `filter.ts` sides carry `is`, any transfer side, and `uncounted`, every side but the outflow of `EXPENSE_TRANSFER_KINDS`: `uncounted` drives « Sans catégorie », the bulk edit's `categoryHidden` and `countedInCashFlow`.
- Fixtures whose uncategorised income would now net an uncategorised expense away put that income in a category: `services/export.spec.ts`, `routes/budgets.spec.ts`, `e2e/budgets.spec.ts`.
- The budget's « Sans catégorie » sheet lists and links without `direction`, as Sure's `BudgetCategoriesController#show`, since its envelope nets both signs.
- `get_income_statement`'s description no longer says it counts « as the dashboard ».
- `e2e/viewer.spec.ts:58` fails on `main` at the baseline as well (CI run of 2026-10-10 on `e60e93e`): out of this story.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| AD-9 « Prevents » still says the list filter and reports agree on spending | low | Real: the filter now calls a loan outflow a transfer, reports an expense. | patch |
| `docs/sure-parity.md` « Type condition » row still Different, outflow an expense | medium | Real: the rule condition now follows Sure's `TransactionType`. | patch |
| `docs/sure-parity.md` « Budgets » row describes the old actuals | medium | Real: spending is net, income gross, « Sans catégorie » nets both signs. | patch |
| An income-kind category's net spend enters the budget's spending but no envelope | low | Real but rare: `budgetCategories` gives envelopes to expense-kind categories only, an Archant divergence; Sure has no kinds (#1160). | defer |
| Spec `in-review` while sprint status reads `in-progress` | false | Completion syncs both, as in Story 27.5. | rejected |
| Drill-down lists tax-advantaged rows the line leaves out; comment omits them | low | Real; same as excluded rows, already listed in the comment. | patch: comment |
| Rules and list totals change on upgrade without notice | medium | Real: a « type = dépense » rule stops matching loan outflows. | patch: `breaking-change` label and PR note |
| E2e comment's « before » figures wrong | low | Real: the old code gave +12,00 € and −555,00 €. | patch |
| `sumTransactions` runs one more query in series | low | One indexed read of a handful of accounts. | rejected |
| `CashFlowLine.share` stays nullable | low | Dead branches only; Story 27.12 reshapes the tool. | rejected |
| History computes `net.lines` and sub-categories nobody reads | low | Negligible cost; no unused export. | rejected |
| No test for `monthlyExpenses`, `assurance_vie`, `isTaxAdvantaged` | medium | Real for `assurance_vie`; `monthlyExpenses` only forwards `suggestions`, covered. | patch: `isTaxAdvantaged` test |
| A PEA leaves the dashboard without a notice | false | Sure shows none either; the PR note tells the self-hoster. | rejected |
| A month whose refunds cancel its spending enters the median at 0 | maybe-false | Sure's `median_expense` is gross; Story 27.7 rewrites the medians. | defer |
| No test of a PEA line in an earlier month of the history | medium | Real: reverting `getCashFlowHistory` to `reportedAccounts` fails no test. | patch |
| « Revenus » `toContainText(euros(0))` also matches +40,00 € | low | Real substring match. | patch |

## Design Notes

Two views, not one: Sure's `income_totals` and `expense_totals` are gross, `net_category_totals` derives from them, and the budget reads both (`actual_spending` net, `actual_income` gross). Deriving the net view from the gross one keeps them consistent by construction.

The owner's seed the epic names does not exist in the repository; each test builds its own month and asserts the figures before and after in its name.

Tax-advantaged accounts leave through the account list every cash-flow read already takes, so no query gains a join and the volume plans stay as they are.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean.
- `pnpm test` -- expected: both Vitest projects pass.
- `pnpm test:e2e` -- expected: green.

**Manual checks:**
- Screenshot the dashboard's « Flux » card on the e2e month, income and expense sides.
