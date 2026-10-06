---
title: 'Story 23.5: Every bill and its story'
type: 'feature'
created: '2026-10-06'
status: 'done'
baseline_commit: '88ba8b77be5532c529a4660e7e3dccb31cb825dd'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-23-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `/bills` shows the month, but no screen lists every bill with what it costs a month, opens one bill with its payments and price changes, or shows what is due in the next days; `/recurring` still carries detection, cleanup and the series table under an old name.

**Approach:** Port Sure's `bills/all`, `bills#show`, `transactions/_upcoming` and `recurring_transactions#index` at `14638a701` as `/bills?view=all`, a `/bills/:id` drawer, an « À venir » tab on `/transactions` and `/settings/recurring`, then redirect `/recurring`. Story 23.5 of `epics.md` is the acceptance contract; this spec adds what reading Archant and Sure settled. Each decision below is an assumption the pull request lists.

## Boundaries & Constraints

**Always:**
- `services/recurring/bills.ts` gains `allBills(deps, query)`, Sure's `load_all_series`: every series but `suggested`, ended included. Each row is the `RecurringRecord` plus `monthlyEquivalent`, and the current occurrence's `confirmed` and `remaining`. Query, Zod-parsed: `q`, `status` (`overdue`, `due`, `partial`, `paid`, `paused`, `ended`), `type` (`BILL_TYPES`), `sort` (`due`, `name`, `amount`).
  - `q`: case-insensitive substring of the name, the merchant's name or the label.
  - With `type = subscription`, the response adds `subscriptions`, Sure's `load_subscription_rollup`, decided by the owner over the epic's « Engagement récurrent »: over the rows left after search and status, the `active` ones: their count, `monthly` = Σ monthly equivalent in the reporting currency (`getReportingCurrency`), `annual` = `monthly × 12`, both `null` when none, series in another currency left out and named as `goalsSummary` does; and `priceChanges`, the ten latest of any series with `effective_on` within a year of today, each with its series name and `percent`.
  - `paused` is `inactive`, `ended` is `ended`. The payment filters read `currentOccurrences`: `overdue` and `due` its derived state, `partial` open with `0 < confirmed < expected`, `paid` its status `paid`. A series with no occurrence fails every payment filter.
  - `due`, the default: active, then inactive, then ended, each by next expected date, none last, then id. `name`: displayed name (`recurringName`), `fr` collation, then amount. `amount`: Sure's sign, so the largest outflow first and incomes last.
- `monthlyEquivalent`: `|amount| × occurrencesPerYear / 12`, computed as an exact `BigInt` fraction (weekly `1461 / (28 × interval)`, monthly `12 / interval`, yearly `1 / interval`, summed over the rules) and rounded half up to the minor unit, as Sure's `number_to_currency` shows it. The float `occurrencesPerYear` never touches money.
- `GET /api/recurring/:id`, registered after the static routes, calls `billDetail(deps, id)`:
  - `record`, its current occurrence with `confirmed` and `remaining`.
  - `averagePaid`: per `paid` occurrence, its confirmed sum; their mean rounded half up, with min and max; `null` when none is paid.
  - `priceChanges`: the five latest by `effective_on`, each previous, new and `percent`.
  - `installment`: `{ paid, total }` when `billType = installment` and `endAfterCount` is set.
  - `lastAccount`: the account of the newest confirmed payment with an entry, by `paid_on` then `created_at`.
  - `months`: Sure's sparkline data, decided by the owner over the epic's strip of states: twelve `{ month, paid }` from the first of the month eleven months ago, `paid` the confirmed payments of occurrences of any status whose `due_on` falls in that month, `0` when none.
- `percent` everywhere: `(new − previous) / previous` in tenths of a percent, rounded half up, `0` when previous is `0`.
- `GET /api/recurring/upcoming` → `upcomingRecurring(deps)`: active series, both signs, next expected date from today to today + 10 in `APP_TIMEZONE`, by date then id.
- Interface:
  - `_authed.bills.tsx` validates `view: "all"`. With it, the page renders the table: name, type, frequency (`FrequencyPreset` label), amount or band (`RecurringAmount`) with « 45,00 €/mois » under it when the monthly equivalent differs, next due date as `CurrentOccurrence` shows it today, status pill. Filters, type, search and sort live in the URL. Header: « Ajouter une facture » and « Ajouter un revenu ». Each row's menu: « Modifier », « Mettre en pause » or « Reprendre », « Supprimer », moved from `_authed.recurring.tsx`. No match: « Aucun résultat ». With the type « Abonnement », above the table: « Par mois », « Par an » (« – » when null), « Actifs » and the count, the `LeftOutNotice`, and « Changements de prix cette année », each line « Netflix · 13,49 € → 15,99 € (+18,5 %) », a rise in the warning tone and a fall in the success tone.
  - `_authed.bills.$billId.tsx`, a child of `/bills` whose search is kept: a sheet with the next payment, « Moyenne payée » and its range, « 12 derniers mois », one dot per month, full when `paid > 0` and hollow at `0`, the month's short name under every other one and each month's amount in its accessible name, price changes as « 13,49 € → 15,99 € (+18,5 %) », « Paiement 3 sur 12 », « Dernier compte utilisé », notes, the payment link (`target="_blank"`, `rel="noopener noreferrer"`), and for an administrator edit, pause or resume and delete. Closing goes back to `/bills` with the same search; deleting does too.
  - `_authed.recurring.tsx` becomes `beforeLoad` `redirect` to `/bills?view=all`, `replace: true`. `TransactionLinks.tsx` links to `/bills/$billId`.
  - `/transactions?tab=upcoming`, an « À venir » tab beside « Transactions », as `accounts.$accountId.tsx` does tabs: rows grouped by date (« 12 octobre · 2 »), name, « Attendue aujourd'hui » or « Attendue dans 3 jours », signed amount or band. Empty: « Aucun paiement récurrent attendu dans les dix prochains jours ». The filters card is hidden on that tab.
  - `/settings/recurring`, « Transactions récurrentes » in `SETTINGS_SECTIONS`: Sure's info text, in French, naming when detection runs (after an import, a revert or a sync, and from the button; occurrences each first signed-in request of the day); `RecurringSuggestions`; « Identifier les modèles » (`useDetectRecurring`, toast with the count) and « Nettoyer les obsolètes » (`useCleanupRecurring`, toast with the count); a link « Ouvrir toutes les factures ».
- A viewer sees the table, the drawer and the tab without any action; the settings layout already keeps them off `/settings/recurring`.
- `EXPERIENCE.md`: Bills row gains `?view=all` and `/bills/:id`, Recurring row becomes the redirect, Transactions row gains the tab, Settings row gains the page. `sure-parity.md` rows 198-213 stop naming `/recurring` and say what Archant does.

**Never:** no suggestions in the table (they have their own block on `/bills` and in Réglages); no switch that turns detection off; no « Engagement récurrent » total; no « Comment cette facture est reconnue », « Par année », « À venir » list, « Paiements récents » or « Historique » in the drawer; no « Payer » button beside the link, no « Let AI configure »; no calendar; no exchange rate; no MCP change (23.6).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Weekly | 10,00 €, every week | 43,48 € (10 × 1461 / 336 = 43,482…) |
| Quarterly | 90,00 €, every 3 months | 30,00 €/mois |
| Twice a month | 50,00 €, the 1st and 15th | 100,00 €/mois |
| Exact half | 0,06 €, every year | 0,5 cent → 0,01 € |
| Partial filter | open, 180 of 300 € confirmed | listed under « Partiellement payée » |
| Paid filter | open occurrence after a paid one | not « Payée »: the open one is current |
| No occurrence | ended series | only « Terminée » and no filter list it |
| Price change | 13,49 → 15,99 € | `percent` 185, « (+18,5 %) » |
| Price fall | 15,99 → 13,49 € | « (−15,6 %) » |
| No paid occurrence | new bill | no « Moyenne payée » block |
| Upcoming bounds | due today, today + 10, today + 11 | first two listed |
| Inactive | next date tomorrow | not in « À venir » |
| Months | paid 571,29 € on 5 Oct for an occurrence due 30 Sep | September holds 571,29 €, October 0 |
| Rollup | type subscription, active 9,99 € and 15,99 € monthly, one paused | `monthly` 25,98 €, `annual` 311,76 €, count 2 |
| Rollup, none active | type subscription, search matches nothing | `monthly` and `annual` null, « – » |
| Rollup, other currency | an active USD subscription, reporting EUR | out of `monthly`, named in `leftOut` |
| Unknown id | `GET /api/recurring/nope` | `NOT_FOUND` |
| `/recurring` | old link | lands on `/bills?view=all` |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/recurring/series.ts` -- `RecurringRecord` :58, `selectRecords`/`toRecords`, `getRecord` :564, `listRecurring` :594 (excludes ended; `withinDays` :577 for the upcoming window), `setRecurringStatus` :629, `deleteRecurring` :670.
- `packages/api/src/services/recurring/occurrences.ts` -- `currentOccurrences` :278 (Sure's `current_occurrence`), `CurrentOccurrence` :263; `domain/recurring/occurrences.ts` -- `derivedState` :72, `roundHalfUp` :41, `remainingOf`.
- `packages/api/src/domain/recurring/schedule.ts` -- `occurrencesPerYear` :237 (float; add the exact fraction beside it), `DAYS_PER_YEAR`; tests `schedule.spec.ts:193`.
- `packages/data/schema/recurring-occurrences.ts` -- `recurring_price_changes` :161 (positive magnitudes, read by nothing but `price-changes.ts` and the export), allocations and their `paid_on`, `entry_id`.
- `packages/api/src/routes/recurring.ts`, `schemas/recurring.ts`, `routes/middleware/roles.spec.ts` (reads stay open to a viewer).
- Interface: `routes/_authed.bills.tsx` (`searchSchema` :43, sheet pattern with `shown` :253 and :367-378, « Toutes les factures » :302 → `?view=all`), `routes/_authed.recurring.tsx` (`RecurringActions` :93, delete `ConfirmDialog` :365, `BillDialog` :355, `CurrentOccurrence` :72 to move), `components/RecurringSuggestions.tsx` (`RecurringAmount` :32), `components/BillLabels.tsx`, `components/TransactionLinks.tsx:333`, `routes/_authed.transactions.tsx` (`operationsSearchSchema` from `lib/transaction-filters.ts:24`, `clear` :214), tabs pattern `routes/_authed.accounts.$accountId.tsx:75-81, 465-469, 548-570`, redirect pattern `routes/_authed.budgets.index.tsx:8`, `components/SettingsNav.tsx:20`, `routes/_authed.settings.tsx:9` (admin gate), `hooks/useRecurring.ts`, `lib/query-keys.ts:88`, `locales/fr.json` (`recurring`, `bills`, `transactions.recurring` :388, `settings.sections`).
- E2E to move off `/recurring`: `e2e/recurring.spec.ts` (`PAGE` :10, `visit` :106, :391), `bills.spec.ts:84`, `brand.spec.ts:107`, `empty-states.spec.ts:31`, `proportions.spec.ts:63, 600-613`, `viewer.spec.ts:366`.
- Docs: `docs/sure-parity.md` :188-220; `EXPERIENCE.md` :31-38.
- Sure, `git -C ~/github/sure show 14638a701:<path>`: `app/controllers/bills_controller.rb` :7-12, :140-198, :245-335; `app/views/bills/all.html.erb` (rollup :42-66, :188-210), `bills_controller.rb` :340-378 (rollup), `app/components/DS/sparkline.rb`, `show.html.erb`, `_detail.html.erb`; `app/models/recurring_transaction.rb` :293-315, :348; `app/models/recurring_transaction/schedule.rb` :160; `app/views/transactions/_upcoming.html.erb`, `transactions_controller.rb` :84-99; `app/views/recurring_transactions/index.html.erb`; `config/locales/views/{bills,recurring_transactions,transactions}/fr.yml`.

## Tasks & Acceptance

**Execution:**
- [x] `domain/recurring/schedule.spec.ts` -- the matrix's monthly equivalents and the tie -- then `monthlyEquivalent` beside `occurrencesPerYear`.
- [x] `services/recurring/bills.spec.ts` -- `allBills` filters, search, sorts, ended listed, suggestions out, the subscription rollup and its price changes; `billDetail` average, price changes and percent, installment, last account, months; `upcomingRecurring` bounds and statuses -- then the three functions.
- [x] `routes/recurring.spec.ts`, `roles.spec.ts` -- the three reads, query validation, `NOT_FOUND`, a viewer reads -- then routes and schemas.
- [x] `packages/app/e2e/bills.spec.ts` (all bills, drawer), `transactions` e2e (« À venir »), a settings e2e, `viewer.spec.ts` -- then hooks, the table, `_authed.bills.$billId.tsx`, the tab, `_authed.settings.recurring.tsx`, the redirect, `TransactionLinks.tsx`, `fr.json`.
- [x] Move every `/recurring` e2e onto the table and `/settings/recurring`; delete `_authed.recurring.tsx`'s page code.
- [x] `docs/sure-parity.md`, `EXPERIENCE.md` -- the rows and surfaces.

**Acceptance Criteria:**
- Given a viewer, when they open the table, a bill and « À venir », then no action shows and no write is sent.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then every criterion of Story 23.5 in `epics.md`, as settled here, has a test.

## Implementation Notes

- `allBillsQuerySchema`, `BILL_STATUS_FILTERS` and `BILL_SORTS` live in `schemas/bills.ts`, not `schemas/recurring.ts`: the interface imports them at runtime, and `schemas/recurring.ts` pulls Drizzle into the bundle through `RECURRING_STATUSES`.
- `allBills` is served at `GET /api/recurring/bills/all`; `GET /api/recurring/:id` is registered last.
- The current occurrence of `allBills` and `billDetail` carries `expected` beside `confirmed` and `remaining`, which the `partial` filter compares.
- `paymentEntries` returns the entry's `accountId`, which `lastAccount` reads.
- `useBillActions` and `BillMenu` in `components/BillActions.tsx` hold the edit, pause or resume and delete flow that the table and the drawer share; `CurrentOccurrence` moved to `components/BillLabels.tsx`.
- The tab beside « À venir » reads « Opérations », the page's own name, rather than « Transactions ».
- The « inactive » status badge reads « En pause », as the filter and the menu say, and `ended` gained « Terminée ».
- The drawer opens the bill dialog for « Modifier », as the transaction sheet's « Créer une facture » already does.
- For a `suggested` series, which the transaction sheet links to, the drawer offers « Ajouter la facture » and « Ce n'est pas une facture » instead of edit, pause or resume and delete, so « Reprendre » never accepts a suggestion unnoticed (review row 17).
- `?view=all`'s header carries a « Vue d'ensemble » link back to `/bills`, as the overview's « Toutes les factures » leads here.
- `daysFrom` lives in `lib/dates.ts`, shared by `BillLabels.tsx` and `UpcomingRecurring.tsx`; the route's sort enum derives from `BILL_SORTS`.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| 1 | The table with no bill reads « Aucun résultat » and suggests clearing a filter | low | Sure's `bills/all` shows its no-match card in the same case; the header still offers « Ajouter une facture ». | reject |
| 2 | « Supprimer » on a detected `ended` series does nothing but toast | medium | `deleteRecurring` sets `ended` again on a non-manual series; the table now lists ended ones. | patch |
| 3 | The rollup's « Actifs » counts subscriptions its sums leave out | false | Sure's count is every active subscription; the sums leave out other currencies and name them, as the spec says. | reject |
| 4 | « Changements de prix cette année » is a rolling year over every series | false | Sure's rollup reads `effective_on >= 1.year.ago` across the family's series. | reject |
| 5 | A rising income shows in the warning tone | low | Sure tones every rise as a warning. | reject |
| 6 | « Attendue dans N jours » counts from the browser's day | low | Off only near midnight across time zones; 23.4 row 11 settled the same. | reject |
| 7 | « À venir » reads the next expected date, not a snoozed or paid occurrence | false | Sure's `_upcoming` reads `next_expected_date`, as the spec says. | reject |
| 8 | « À venir » rows link nowhere | low | Not asked by the story; Sure's projected rows carry a pay action, not a link. | reject |
| 9 | The bulk bar stays on the « À venir » tab | medium | `BulkBar` renders outside the tabs with the selection kept. | patch |
| 10 | Réglages lost the explanation of « Nettoyer les obsolètes » | low | The old page's sentence is gone; a one-line restore. | patch |
| 11 | Toasts still say « Récurrence » | low | The strings stay true; renaming them is beyond the story. | reject |
| 12 | `docs/architecture.md` AD-24 names « Détecter » | low | The button no longer exists; AGENTS.md keeps the spine current. | patch |
| 13 | « Paiement 12 sur 12 » once every payment is made | low | Sure's `done_plus_one` is `min(paid + 1, total)`. | reject |
| 14 | A search over 200 characters turns the table into an error | low | `allBillsQuerySchema` caps `q` at 200 and the input had no `maxLength`. | patch |
| 15 | The status filter and the status column mean two things | low | Sure's filter and pill do the same. | reject |
| 16 | Spec and sprint status disagree | false | The completion step syncs both. | reject |
| 17 | The drawer's « Reprendre » accepts a suggestion opened from a transaction | medium | `TransactionLinks` links every series; `setRecurringStatus` allows suggested → active. | patch |
| 18 | Amount sort compares minor units across currencies | low | A household's bills share a currency nearly always; Sure sorts the same. | reject |
| 19 | The search debounce restarts on a re-render | low | Only delays a query while typing. | reject |
| 20 | `{ tab, ...search }` gives the filters a new identity each render | low | Query keys compare by value; nothing refetches. | reject |
| 21 | A future-dated price change shows in the rollup | low | An occurrence paid ahead dates its change at its own due date, after today; Sure's rollup reads `effective_on >= 1.year.ago` with no upper bound too. | reject |
| 22 | The drawer flashes an error while closing after a delete | low | `notFoundInline` keeps it inline and the sheet is closing. | reject |
| 23 | A viewer loses the suggestions read | false | `/bills` still shows « Nouvelles factures possibles » to a viewer. | reject |
| 24 | The account column is gone | false | Sure's `bills/all` has none; the spec lists the columns. | reject |
| 25 | Rollup lines are not one « Netflix · … » line | low | Same content, laid out in two columns. | reject |
| 26 | `changePercent` rounds a fall away from zero | false | Ruby's `round(1)` rounds half away from zero, as Sure's percent. | reject |
| 27 | A numeric `?q=` is untested | gap | Pre-verified: every e2e search is non-numeric. | patch |
| 28 | No assertion that deleting from the drawer shows no NOT_FOUND toast | gap | Pre-verified: the test checks only the success toast. | patch |
| 29 | `upcomingRecurring` repeats `listRecurring`'s window | low | `listRecurring`'s `current` view includes suggestions; both are tested. | reject |
| 30 | `daysFrom` copied in `UpcomingRecurring.tsx` | low | Same helper as `BillLabels.tsx`. | patch |
| 31 | The route's sort enum written by hand beside `BILL_SORTS` | low | A new sort would be dropped by the URL schema. | patch |
| 32 | Other duplications (`withAmounts` vs the overview, `displayName`, the overview's own dialog state) and the inline price-change type | low | Judgement calls with no caller diverging today. | reject |
| 33 | The rollup shows 0,00 € when every active subscription is in another currency | false | Sure's `total_of_series` skips unconvertible series and sums the rest, so its figure is 0 beside the unconvertible notice. | reject |
| 34 | « À venir » still loads the transactions list | low | Two reads already cached for the other tab. | reject |

## Design Notes

`epics.md` says the monthly equivalent rounds half to even « as Sure's »; Sure keeps it unrounded and `number_to_currency` rounds it half up when shown, which `roundHalfUp` in `domain/recurring/occurrences.ts` already ports, so half up wins. A cent differs only on an exact half.

Sure shows no band in `bills/all` nor in `_upcoming`; Story 23.1 made « varie de 571,22 € à 571,36 € » Archant's way to show a moving amount, so both keep it. Sure's default sort orders statuses alphabetically (`active`, `ended`, `inactive`), an accident of a string enum; the table puts paused before ended.

Two criteria of `epics.md` read Sure wrongly, and the owner chose Sure on 2026-10-06: the drawer's twelve months are Sure's sparkline of amounts, not a strip of states, and the table's totals are Sure's subscription rollup, not an « Engagement récurrent » over every outgoing series, whose strings Sure ships but never renders.

`/bills/:id` is a child route so the table, or the month view, stays behind the sheet and closing keeps the filters, where Sure renders a full page or a turbo-frame drawer.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint:code && pnpm lint:format` -- expected: clean.
- `pnpm test` -- expected: green.
- `pnpm test:e2e` -- expected: green.
