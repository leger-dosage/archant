# Epic 23 Context: Bills and recurring payments

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Port Sure's current recurring code and its bills feature, as read on Sure's `origin/main` at `14638a701` (2 October 2026), so that a payment whose amount moves by a few cents or whose day drifts is still followed. The trigger case is the owner's mortgage, debited 571,29 €, 571,36 €, 571,22 €, 571,29 € on 6 July, 10 August, 7 September and 5 October. It is not detected today, because Archant groups by exact amount with the identifier Sure had before 31 August 2026. Sure's new identifier still does not detect it, since the 10th is 3 days from the expected 7th, but once the mortgage is declared Sure's matcher follows it. Archant ports both and keeps Sure's day tolerance. The epic brings in Sure's identifier, statuses, schedules, bills declared by hand, dated occurrences, payment matching, history rebuilding, price changes, the bills pages, the « À venir » tab and the assistant tools for bills. Departures from Sure come only from decisions already taken: signed amounts, one currency per account, no jobs, stable entry ids, and nothing unused.

## Stories

- Story 23.1: Find recurring payments as Sure does today
- Story 23.2: Schedules, and bills declared by hand
- Story 23.3: Occurrences and the payments that settle them
- Story 23.4: The bills page
- Story 23.5: Every bill and its story
- Story 23.6: Ask an assistant about my bills

## Requirements & Constraints

- Detection covers the last three months. Rows are grouped by account, merchant or else normalised label, and currency. Within a group they are clustered by amount within 7.5 % of the cluster's running mean. A cluster is a pattern when it has at least three rows, the latest within 45 days, and every row's day within 2 of the expected day on a 31-day circle. Transfers stay out, except the outflow of a loan payment or an investment contribution. Investment accounts stay out. Split parents stay out, their children count.
- Statuses are `suggested`, `active`, `inactive` and `ended`. `paused` is never stored, and the interface's « En pause » means `inactive`. Detection never recreates an `ended` series. A series becomes inactive after two of its own cycles without payment: at least two months, six for a manual series. A suggestion never becomes inactive.
- A payment matches from 2 days before its due date to 7 days after, each side under half a cycle, within the larger of 7.5 % and a learned tolerance, never past 25 %. From a score of 0.85 the match is confirmed by itself, from 0.60 it is suggested, and an income is never confirmed by itself. A rejected transaction is never suggested again for that series.
- Recurring work runs after an import, a revert or a sync commits, and from « Détecter », in this order: detection, occurrence generation, matching, price changes. It runs in one immediate transaction. A failure is logged with its code only and never fails the request. The first signed-in request of the day in `APP_TIMEZONE` generates that day's occurrences. There is no job, debounce, queue or advisory lock.
- Money is integer minor units, never a float. Totals use the reporting currency, and a series in another currency is left out and named.
- Every visible string goes through i18next in French. Pages work with the keyboard alone and meet WCAG 2.2 AA contrast.
- A viewer sees every bills page without any action, and the server refuses each of their writes.
- Every acceptance criterion has an automated test: Playwright for what the interface shows, Vitest for the rest. `domain/recurring/identifier.ts`, `schedule.ts` and `matcher.ts` are covered to the branch.
- No family, no preview gate and no switch that turns bills off. The paycheck planner, recurring transfers between the household's own accounts, LLM bill suggestions and a transaction picker are out of scope.

## Technical Decisions

- `domain/recurring/` holds Sure's identifier, schedule engine, classifier and matcher as pure functions. `domain/recurring/schedule.ts` is the only code that computes a series' dates. Every component asks it whether a date lies within 2 days of an occurrence (AD-24).
- Tolerances and scores are integers. An amount is within 7.5 % when `1000 × |a − r| ≤ 75 × |r|`. Scores count ten-thousandths, so 0.85 is 8500.
- Signs: a series' amount is signed as its transactions, negative for money leaving the account (AD-5). Clustering sorts by the negated amount to form Sure's clusters. An occurrence's expected amount and a payment's amount are positive magnitudes in the series' currency.
- Payments have no `source_amount` and no `source_currency`, because each account has one currency and there is no exchange rate (AD-6).
- Writes: `services/recurring/` writes series, occurrences, payments, rejections and price changes. Routes and MCP tools each call one service function (AD-1, AD-19).
- Schema, in order across stories: statuses renamed in place by a migration, the amount band and `dedup_scope` on `recurring_transactions` in 23.1; `recurring_rules` and the bill fields in 23.2; `recurring_occurrences`, `recurring_allocations`, `recurring_match_rejections` and `recurring_price_changes` in 23.3. Enumerations are `text` with check constraints from `const` arrays in `@archant/data`. JSON columns are parsed by Zod.
- Sure fields that no Sure screen or tool sets become constants in `domain/recurring/`, not columns: weekend adjustment, end date, nth weekday, holiday calendar, amount strategy `fixed`, notice and grace days of 3, match window of 2 days early and 7 late, `upcoming_window_days`.
- Entry identity (AD-17): `absorb` moves payments and rejections onto the surviving entry, so Sure's orphan repair has no port. A payment references its entry with `ON DELETE SET NULL` and survives the transaction's deletion.
- Labels are compared normalised. Story 11.8's re-key and refresh and Spec 9.2's next date for a plain monthly series stay, with Sure's amount and day tests applied inside them.
- Export (AD-23): every new table goes into the export as Sure's `RecurrenceRule`, `RecurringOccurrence`, `RecurringAllocation` and `RecurringPriceChange` lines. Each new column goes into `EXPORTED_COLUMNS` or `LEFT_OUT`, or the export spec fails.
- Roles (AD-21): every write uses a mutating method, so `viewerReadOnly` refuses it for a viewer. No `GET` writes, « Détecter » and « Nettoyer les obsolètes » included.
- Errors are new `AppError` codes in the closed union, for example `RECURRING_ALREADY_EXISTS`. Any other status transition answers `VALIDATION_ERROR`.

## UX & Interaction Patterns

- `/recurring` gains « Nouvelles factures possibles » in 23.1. Story 23.4 replaces the rail's « Récurrences » with « Factures » at `/bills`. Story 23.5 redirects `/recurring` to `/bills?view=all`.
- The bills page groups occurrences under « Requiert votre attention », « Ce mois-ci », « Après ce mois-ci », « Inactive » and « Prochaine », above the totals. Due labels follow Sure's `due_label`, for example « 3 jours de retard, échéance le 5 octobre ».
- An occurrence opens a sheet with Sure's actions: mark as paid, add a payment, skip, reopen, postpone, change the amount, remove a payment. A sheet opens no dialog except a confirmation.
- A bill opens at `/bills/:id` as a drawer: twelve months of history, price changes, installment progress, the payment link in a new tab.
- The transaction sheet's « Récurrence » block offers « Ajouter aux récurrences » and « Créer une facture ». It names the occurrence the transaction pays.
- `/transactions` gains an « À venir » tab covering ten days. « Réglages » gains « Transactions récurrentes » at `/settings/recurring`.
- Money renders through `<Money>`, and a varying amount reads « varie de 571,22 € à 571,36 € ». Tables use header cells. `EXPERIENCE.md` and `sure-parity.md`'s Recurring transactions rows are updated when the surface changes.

## Cross-Story Dependencies

- Order: 23.1, then 23.2, then 23.3. Stories 23.4 and 23.5 follow 23.3 in any order. Story 23.6 comes last, because its tools call the services of the stories before it.
- 23.2's schedule engine replaces the monthly-only date math of 23.1. 23.3's generator and matcher read 23.2's rules and bill fields.
- The mortgage case appears in three places: 23.1 checks that it is not detected, 23.2 lets the owner declare it, 23.3 checks that its occurrences get paid.
- Outside the epic, the work builds on these earlier pieces: Epic 9 and Specs 9.1, 9.2 and 11.8 for detection, the first-visit daily sync for occurrence generation, `absorb` and splits in the ledger, Epic 18's export, and Epic 16's MCP server. Story 23.6 removes bills from Epic 16's list of tools left out. `get_paycheck_plan` stays out, and `docs/deployment.md` names the six new tools.
