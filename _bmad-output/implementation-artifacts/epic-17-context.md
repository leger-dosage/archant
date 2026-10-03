# Epic 17 Context: Monthly budgets

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The owner plans each month's spending by category, as in Sure: a spending total and an expected income suggested from past months, an amount per expense category, a status per category, a copy from the latest month set up, money moved between categories, and an unspent amount carried over. Budgets come now because classification is reliable (rules, merchants, an assistant that classifies). The epic follows Sure's model (`budget.rb`, `budget_category.rb`, `budget/rollover_calculator.rb`, read at `14638a701`) as closely as possible, and departs only where an earlier Archant decision forces it: calendar months, integer minor units, one definition of cash flow, expense categories only, nothing written on read, one household.

## Stories

- Story 17.1: Set up a month's budget
- Story 17.2: Spread the budget over categories
- Story 17.3: Copy a budget and move money
- Story 17.4: Carry what is left to next month
- Story 17.5: Ask an assistant about my budget

## Requirements & Constraints

- Months are calendar months, `YYYY-MM` in the URL like the dashboard's `?month=`; Sure's `month_start_day` and its `oct-2026` form are not used. A month before both the month two years before the current one and the oldest entry's month, or more than two years after the current one, is refused, as Sure's `budget_date_valid?`.
- A month is set up when its `budgeted_spending` is not null, as Sure's `initialized?`. Reading any month writes nothing; rows are created on the first save, so a future read-only user sees any month without writing (Sure bootstraps on page open, Archant does not).
- Suggestions are the median of earlier months' totals that have counted lines, as Sure's `estimated_spending` and `estimated_income`; per-category medians feed the « /m avg » hint.
- Only expense categories carry a budget amount; Archant keeps the category kind Sure dropped. Expected income stays one figure per month.
- A subcategory without its own amount shares its parent's budget; one with its own amount is ring-fenced, and the parent becomes the sum of its children plus its own reserve. « Sans catégorie » holds what the total leaves unallocated and is never stored.
- Statuses: over budget, near the limit from 90 %, on track; the assistant also sees `unbudgeted` and `no_activity`.
- Copy takes the latest earlier month set up, skipping deleted categories, and is refused on a month already set up with `BUDGET_ALREADY_SET_UP`. Moving money changes both amounts in one transaction and is refused from « Sans catégorie », between a parent and its own child, or beyond what the source holds.
- Rollover carries `max(0, budgeted + carried in − actual)` per category into the next month set up, skipping months never set up; an overspent month carries nothing; the choice is inherited from the latest month set up. Carried money counts in what remains, not in the allocation total.
- One household: no `family_id`, no personal budgets, no budget shares. No bills and no « cash on hand » panel.
- Every acceptance criterion has a test: Playwright for what the interface shows, Vitest for the rest. The rollover function is covered to the branch: gaps, ring-fenced and shared subcategories, a deleted category, an overspent month.

## Technical Decisions

- Layering: code lives in `services/budgets.ts` and `domain/budgets/`. Routes and MCP tools call exactly one service function; only services touch the database; domain functions are pure and import no Drizzle or Hono. The rollover chain is computed by a pure function in `domain/budgets/rollover.ts` and written by the service in one transaction opened with `behavior: "immediate"`, replacing Sure's advisory lock.
- Money: amounts are integer minor units in `settings.reporting_currency`, read through the existing helper. No float, no `decimal(19,4)`, no 1:1 fallback for a missing exchange rate. Accounts in another currency are left out of actuals and named, as on the dashboard.
- Actuals come from `services/reports.ts` through `cashFlowByCategory` and `direction()`, never a second definition. Excluded, pending and transfer lines are out; the outflow side of a loan payment or investment contribution counts as an expense. A category's actual is the negated signed sum of its counted lines and its subcategories', floored at zero, so a refund lowers it.
- Schema: `budgets (id, month, currency, budgeted_spending, expected_income, created_at, updated_at)`, unique on `month`, nullable integer amounts. `budget_categories (id, budget_id, category_id, budgeted_spending, created_at, updated_at)`, unique on `(budget_id, category_id)`, deleted with its budget or its category; a category merge deletes the merged category's rows. Story 17.4 adds `rollover_enabled` (default false) and `rolled_over_amount` (integer, never negative). Text UUID ids, epoch-millisecond timestamps, snake_case columns.
- A transaction recategorised in a past month triggers that month's rollover recompute through the ledger's write; the ledger stays the single writer of money rows, and budgets never write to them.
- Errors are `AppError` codes in the closed union of `lib/errors.ts`; the interface translates them.
- MCP tools follow the assistant conventions already in place: a file in `mcp/`, a Zod input schema from `schemas/`, one service call, amounts as decimal strings with their currency, ids as references, annotations and an `outputSchema`, every call recorded in `assistant_calls`. `get_budget` needs the read scope, `update_budget` the write scope and refuses « Sans catégorie », as Sure's `UpdateBudget`.

## UX & Interaction Patterns

- « Budgets » sits in the rail between « Comptes » and « Récurrent ». `/budgets` redirects to `/budgets/<current month>`; the month page has previous and next arrows, a month picker by year and « Aujourd'hui ».
- A month not set up offers « Définir le budget » (form with « Dépenses prévues » and « Revenus attendus », both required, and « Suggérer »), or, once an earlier month exists, « Copier <mois> » and « Partir de zéro ».
- Set-up has two steps, Budget then Catégories. The categories step saves each amount on change, shows the median beside it and a progress bar of the share allocated; « Valider » stays disabled while the allocation exceeds the total. A shared subcategory reads « Partagé ».
- A set-up month shows Sure's donut of actual spending by top-level expense category, its centre « 1 234,56 € sur 2 000,00 € » with an edit link, and a summary card of income and spending against plan.
- Category cards show spent, budgeted and remaining or overflow, a status « Dépassé », « Bientôt atteint » or « Dans les clous », « +<montant> reporté » when money is carried in, and a filter « Toutes, Dépassées, Dans les clous ». Opening one shows a sheet with the month's spending, monthly average and median, the three latest transactions and a link to `/transactions` filtered on the category and month.
- Every visible string goes through i18next, French only; the page is usable with the keyboard alone at WCAG 2.2 AA contrast.

## Cross-Story Dependencies

- 17.1 comes first (table, month routing, totals, actuals, rail entry, `sure-parity.md` Budgets row). 17.2 follows (per-category table, statuses, sheet). 17.3, 17.4 and 17.5 then follow in any order.
- 17.5 relies on Epic 16's MCP endpoint, scopes and `assistant_calls`; it removes budgets from Epic 16's list of tools left out and names the two tools in `docs/deployment.md`.
- Later epics touch budgets: Epic 18's export must include the budget tables, Epic 19's split children count in actuals in place of their parent, and Epic 20's viewer role must read any month without writing.
