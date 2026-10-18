---
title: "Story 30.9: Reset with sample data"
type: 'feature'
created: '2026-10-18'
status: 'done'
baseline_commit: '847be70d8355f4700bcdba4042e42cfbde5d780c'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-30-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (at `00dd977fb`) offers, beside « Réinitialiser le compte », « Réinitialiser et précharger »: `DELETE /users/:id/reset_with_sample_data` behind `ensure_admin`, then `FamilyResetJob` runs `Family::FinancialDataReset` and `Demo::Generator#generate_new_user_data_for!`, which fills categories, accounts of every type, three years of salaries, bills, card cycles, transfers, loan payments from their schedules, trades, valuations, a budget filled from recent spending and goals. Archant's « Zone dangereuse » (Story 30.8) can only empty the household.

**Approach:** A pure, seeded generator ports `Demo::Generator` into the `SurePlan` the archive import already writes, plus Sure's goals; `DELETE /api/financial-data?sampleData=true` runs Story 30.8's reset and writes the plan and goals in the same immediate transaction; « Zone dangereuse » gains Sure's second row and dialog.

## Boundaries & Constraints

**Always:**
- Sure's generator order and content: `create_realistic_categories!` (3 income, 11 top-level expenses, 7 subcategories; Sure's comment says 13, its code makes 11), `create_realistic_accounts!` (every type Archant has: checking ×3, savings, credit card ×2, investment ×5, crypto, property, vehicle ×2, loan ×3 with Sure's terms, other liability, other asset), every `generate_*` method, `reconcile_balances!`, `generate_budget_auto_fill!`, `generate_goals!`; Sure's ranges, counts and dates relative to today in `APP_TIMEZONE`.
- Money is integer minor units in the reporting currency: every account, including Sure's EUR and GBP ones, since Archant converts no currency. A Sure dollar amount becomes the same number of euros.
- French names for accounts, categories, labels and goals.
- Deterministic: one fixed seed, Sure's `DEMO_DATA_SEED`, and the same day give the same rows, ids and creation times aside.
- Reset and load in one immediate transaction: a failure leaves the household as it was; a live sync lease refuses with `SYNC_IN_PROGRESS`, as Story 30.8.
- Texts from Sure's `fr.yml`: `reset_account_with_sample_data`, `reset_account_with_sample_data_warning`, `confirm_reset_with_sample_data.title` and `.body` (« Sure » becomes « Archant »); the toast adapts `users.reset_with_sample_data.success` to a load already finished.
- Admin only: `requireRole("admin")`, hidden for a viewer.

**Never:** no migration, no new dependency, no environment variable, no background job; nothing Archant lacks (Apple Wallet accounts, goal pledges, a monitoring API key); no amount or name in a log line.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sample load | filled household, `DELETE /api/financial-data?sampleData=true` as admin | old data gone, sample written, `200 { data: null }` | none |
| Twice | same seed, same day | same rows per table, same amounts and labels; goals aside, as the reset keeps goals and each load adds Sure's nine | none |
| Sync running | live lease | nothing deleted, nothing written | `409 SYNC_IN_PROGRESS` |
| Viewer | viewer session | nothing changes | `403 FORBIDDEN` |
| Bad query | `sampleData=yes` | nothing changes | `400 VALIDATION_ERROR` |

</frozen-after-approval>

## Code Map

- `~/github/sure` `00dd977fb:app/models/demo/generator.rb` -- the generator to port; `config/locales/views/settings/fr.yml`, `views/users/fr.yml` -- texts.
- `packages/api/src/services/sure-import.ts` -- `writeArchive(deps, tx, plan)` (export it) writes a `SurePlan` in Sure's order; `afterImport` (export) refreshes statistics and runs recurring detection after commit, so Sure's recurring bills appear as Sure's sync finds them.
- `packages/api/src/services/sure-import-plan.ts` -- `SurePlan`, `PlanAccount` (opening anchor), `PlanTransaction`, `PlanTransfer` (kind null → `transferKindOf`), `PlanTrade`, `PlanValuation`, `PlanBudget`, `PlanBudgetCategory`, `PlanSecurity`; `PlanRecurring` empty.
- `packages/api/src/services/ledger/reset.ts` -- `resetFinancialData`; called with a transaction as `db` it nests as a savepoint (`ServiceDeps` comment).
- `packages/api/src/domain/loans/amortization-schedule.ts` -- `amortizationSchedule` for Sure's `generate_loan_payments!`.
- `packages/api/src/domain/trades.ts` -- `tradeAmount`; `@archant/data/decimals` -- `formatQuantity`, `formatTradePrice`.
- `packages/data/schema/goals.ts` -- `goals`, `goalAccounts`; completed goal needs `completedAmount` and `completedAt`. `CATEGORY_COLORS` for goal colours.
- `packages/api/src/services/budgets.ts` -- a parent's amount is its own plus its children's.
- `packages/api/src/routes/financial-data.ts` + spec -- add the query.
- `packages/app/src/routes/_authed.settings.security.tsx` `DangerZoneSection`, `hooks/useResetFinancialData.ts`, `locales/fr.json` `dangerZone.*`.
- `packages/app/e2e/reset.spec.ts` -- `reset` project.
- Docs: `docs/sure-parity.md` « Onboarding, sample data, reset of all data », `docs/architecture.md` AD-2 if the reset row names it.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/services/sample-data.spec.ts` -- test first: counts per table after a load, accounts of every `ACCOUNT_TYPE_IDS` type, all in EUR, every amount an integer, salaries, budget for this month, nine goals, deterministic twice; loan balances follow their schedules.
- [x] `packages/api/src/services/sample-data-plan.ts` -- seeded PRNG and the generator: `samplePlan({ seed, today, currency })` returns `{ plan, goals }`.
- [x] `packages/api/src/services/sample-data.ts` -- `resetWithSampleData(deps)`: one immediate transaction (reset, `writeArchive`, goals), then `afterImport`.
- [x] Route, spec, hook, section, locale keys.
- [x] `packages/app/e2e/reset.spec.ts` -- reset with sample data, toast, dashboard shows sample accounts.
- [x] Docs, story and sprint status to done; epic 30 done.

**Acceptance Criteria:**
- Given an administrator on « Réglages › Sécurité », when « Zone dangereuse » shows, then a second row reads « Réinitialiser et précharger » with Sure's warning; its dialog asks « Réinitialiser le compte et charger des données d'exemple ? », focus on « Annuler ».
- Given the dialog confirmed, when the load ends, then a toast confirms and the dashboard lists the sample accounts without a reload.

## Implementation Notes

Decisions taken alone, the owner unavailable:

- `samplePlan({ seed, today, currency })` in `packages/api/src/services/sample-data-plan.ts` ports `Demo::Generator` method by method, in Sure's order, with Sure's ranges, counts, conditions and short-circuits. `SAMPLE_DATA_SEED` is 42: Sure has no default seed, and nothing asks for Ruby's sequence, which a Mersenne Twister port alone would give. The PRNG is Mulberry32.
- Sure's `pick` keys its walk by `object_id`, and every call site passes a literal built anew, so in Sure it nearly always returns the first item. The port walks each list per call site, as the method's comment intends.
- 20 accounts, Sure's less the Apple Wallet ones (`FinancekitGenerator`): 4 depository, 2 cards, 5 investments, 1 property, 2 vehicles, 1 crypto, 3 loans, 1 other liability, 1 other asset. Subtypes follow Sure's: `checking`/`savings`, none for investments, cards, vehicles and crypto; a property needs one in Archant, `single_family_home`. Loans take Sure's terms read through `parseAccountDetails`, as the archive import reads them.
- Openings, as an archive round trip of Sure's demo gives them: a loan on its start date at its principal (`open_demo_loan!`); a property, vehicle, other asset or other liability the day before its valuation at the valuation's amount (Sure's `current_anchor` and `reconciliation` both become Archant reconciliations); an investment account the day before its first line with the cash its buys spend (AD-22), including buys Sure dates later this month; any other account empty the day before its first line.
- The security is typed by hand, « Vanguard Total Stock Market ETF »: the plan names VTI, and the import stores no ticker for a security typed by hand: a Yahoo listing of VTI is quoted in dollars, and the sample is in the reporting currency. Holdings take their price from the trades.
- Transfers keep Sure's default status, `pending`, and their kind comes from `transferKindOf`, as for an archive transfer without one.
- Future-dated lines Sure writes (card payments five days after month end, trips' flights, this month's later trades) are kept: all fall within 366 days.
- Budget: Sure's lines rounded to 25 units of the average over the three months before; a parent's line holds its own plus its children's, created even when it spent nothing itself; the month's `budgetedSpending` sums the top-level lines; `expectedIncome` is 0, as Sure's.
- Goals: Sure's nine, primary the first checking account and secondary the second, as Sure's `created_at` order; colours drawn from `CATEGORY_COLORS`, Sure's `Goal::COLORS`; the completed one stores `completedAmount` as its allocation and `completedAt` as now. Pledges are left out, Archant has none, so the matched-pledge demo goes too. Goals the household had stay, losing the deleted accounts by their cascade.
- Sure's `collect_payroll_dates` steps 14 days, then keeps the even ISO weeks: the parity never changes, so on half the days the 401(k) gets no trade. The port starts on the first Friday of an even week, then steps 14 days, Sure's intended fortnight, which an even-week filter breaks across a 53-week year.
- `detailsOf` throws when `parseAccountDetails` reports an issue for a sample account, so a typo in the hard-coded terms never drops a loan's schedule silently.
- `writeArchive` now returns the new accounts by plan id, for the goals' links; it and `afterImport` are exported from `services/sure-import.ts`.
- Route: `requireRole("admin")` before the query's Zod check, so a viewer is refused `FORBIDDEN` whatever the query; `sampleData=false` is the plain reset. The log line adds `sampleData`, a boolean.
- Interface: `DangerZoneSection` renders both rows from one table, `DANGER_ACTIONS`, with one `ConfirmDialog` each; the toast reads « Votre compte a été réinitialisé et les données d'exemple sont chargées. », Sure's `users.reset_with_sample_data.success` for a load already finished.
- A load writes about 8 100 entries and runs in about half a second in the tests; Marcus savings ends negative, as in Sure, whose transfers out of it exceed what it receives.

## Spec Change Log

- Second review (Acceptance Auditor): the frozen matrix row « Twice » said « same rows per table » while Sure's reset keeps goals and its generator adds nine on each load, which the code follows; and Boundaries counted 13 top-level expense categories, Sure's comment, where Sure's code makes 11. Amended by the owner's standing rule (follow Sure, decide alone): the row names the goals aside, the count is Sure's code's. Avoids a test asserting a household Sure never produces. KEEP: goals kept by the reset, nine added per load.

## Review Triage Log

First pass, `bmad-build` review (Blind Hunter, Edge Case Hunter, Verification Gap), plus visual QA.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Payroll dates step 14 days then keep even ISO weeks: on about half of all days the 401k gets no trade (two layers) | high | patch | Reproduced for 2026-10-25; Sure's `collect_payroll_dates` has the same parity slip. Fridays of even weeks, stepping 7 days. |
| 2 | Spec loads with the real today, asserts with a fixed day: fails from 2027-09-22, flakes across midnight (two layers) | false | patch | `useSignedInApp()` already fakes `Date` at the fixed day for each test; `load()` now sets it explicitly. |
| 3 | Fixed seed listed as Parity; Sure's default is `Random.new_seed` | low | patch | Moved under Different in `docs/sure-parity.md`. |
| 4 | Spec says no ticker stored, plan names VTI | low | patch | The import stores none for a hand-typed security (`securityResolver`); note reworded. |
| 5 | Goals pile up on each load, the old ones without accounts | low | patch | Sure's reset keeps goals and its generator adds nine; said in the parity row. |
| 6 | Sprint status done while the spec is in review | false | reject | Step 5 sets both to done after the review; they agree in the pull request. |
| 7 | `parseAccountDetails` issues ignored for loan terms (two layers) | low | patch | Throws for a sample account. |
| 8 | No test of the card end balances | low | patch | Asserted within Sure's ±250 of 2 500 and 4 200. |
| 9 | No test of investment cash (two layers) | low | patch | Cash zero, balance the holdings' value. |
| 10 | `AGENTS.md` lists five projects | false | reject | It lists six, `reset` included, since Story 30.8. |
| 11 | The sample security survives later resets | low | reject | Sure's reset keeps securities, as the parity row already says. |
| 12 | Parity row omits budget parents, `pick`, Marcus negative | low | patch | Budget parents said; `pick` and the savings balance are Sure's own data, no screen difference to list. |
| 13 | Student loan found by a magic amount | low | patch | Found by subtype, `STUDENT_LOAN_EXTRA_PAYMENT` imported. |
| 14 | No duration or failure log for the load | low | reject | The route logs the outcome; an error reaches `app.onError`, which logs it. |
| 15 | `insertGoals` takes `currency: string` | low | patch | `CurrencyCode`. |
| 16 | E2e leaves the shared database filled; second dialog's pending state untested | low | patch | Header says the order is deliberate; pending state is the same `ConfirmDialog` path the first dialog's test covers. |
| 17 | `goal_accounts` never counted | low | patch | Exact count and a link to a loaded account. |
| 18 | Rollback after a failed load untested | medium | patch | A failing goals insert leaves the old household. |
| 19 | `afterImport` effect untested | low | patch | At least one recurring series after a load. |
| 20 | `sampleData=false` untested | low | patch | Route test added. |
| 21 | QA: net worth jumps in the last days, as the property and vehicles open at today's valuation | low | reject | Sure's `reconcile_balances!` dates them today too; its chart shows the same step. |

Second pass, `bmad-code-review` (Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor).

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Even-week Fridays leave a three-week gap across a 53-week year such as 2026 (two layers) | medium | patch | First Friday of an even week, then every 14 days; the test adds 2027-03-01 and checks every gap is 14 days. |
| 2 | `tradeAmount` null stored as 0 | low | patch | Throws: the sample's figures never reach the bound. |
| 3 | A goal link to an unknown sample account is dropped silently; an empty link list would throw (two layers) | low | patch | Throws on an unknown account, so the list is never empty. |
| 4 | Card balances miss their target on future-dated rows | low | reject | Sure's `generate_credit_card_cycles!` dates them the same way. |
| 5 | Student loan overpaid near the end of its term | false | reject | Payments stop at today, 37 months into a 120-month term. |
| 6 | Zero-amount budget lines | low | reject | Sure's `find_or_create_by!` keeps a line rounded to 0 too. |
| 7 | `AGENTS.md` does not say `reset` loads the sample last | low | patch | Sentence added. |
| 8 | `docs/security-model.md` names only « Réinitialiser le compte » | low | patch | Names both. |
| 9 | AD-21 does not mention the query | low | reject | The route and its guard are unchanged; the query is a parameter of the same route. |
| 10 | No test in another reporting currency | false | reject | `getReportingCurrency()` always returns `EUR`. |
| 11 | Integer test misses budget totals and goal amounts (two layers) | low | patch | Added. |
| 12 | The load blocks the event loop and holds the write lock | low | reject | Measured 0,8 s end to end through the interface on the QA server. |
| 13 | Goals accumulate, the frozen matrix says same rows (three layers) | low | bad_spec | Matrix amended, see the change log; Sure keeps goals. |
| 14 | `detailsOf` skips validation for crypto | low | reject | A constant `{ taxTreatment: "taxable" }`, the form's default. |
| 15 | `review_loop_iteration` 0 after a review | false | reject | It counts loopbacks; none happened. |
| 16 | The sample's day is never tested where UTC and `APP_TIMEZONE` differ | low | defer | Logged in `deferred-work.md`, as its layer filed it. |
| 17 | The payroll fix and `pick` walk are undocumented differences (two layers) | low | patch | Both listed under Different in `docs/sure-parity.md`. |
| 18 | Spec counts 13 top-level expense categories, the code 11 | low | bad_spec | Spec text corrected to Sure's code. |

## Design Notes

Assumptions taken alone, the owner unavailable, each settled by Sure or by Archant's model:

- Route: `DELETE /api/financial-data?sampleData=true`, Sure's `FamilyResetJob` taking `load_sample_data_for_email`, one guarded route rather than two.
- One transaction for reset and load, where Sure's job runs two: Archant runs inside the request, and a failed load must not leave an empty household.
- Investment cash: Sure's demo books a buy with a negative amount, so its accounts hold twice what they bought; Archant's trades follow AD-22, and each investment account opens three years ago with the cash its buys spend, so its balance is what it holds.
- Fixed seed constant, no `DEMO_DATA_SEED` variable: one household needs no other demo; the epic context fixes it.
- Budget parents hold their own average plus their children's, as Archant's budgets require; Sure sums each line flat.
- Goals are added, the existing ones kept, as Sure's reset keeps goals and the generator adds nine.
- Category icons: Sure's demo sets none (`shapes`); Archant has no such icon, so `newCategory().icon`, as the archive import reads a missing one.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.
