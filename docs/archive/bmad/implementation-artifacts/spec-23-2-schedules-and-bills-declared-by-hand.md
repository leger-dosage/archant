---
title: 'Story 23.2: Schedules, and bills declared by hand'
type: 'feature'
created: '2026-10-05'
status: 'done'
baseline_commit: 'df01b668968750149c3d78f575a8021e8240bc84'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-23-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every series is monthly and comes only from detection, so a quarterly water bill, a yearly insurance or a mortgage detection misses cannot be followed, and a series carries no name, type or category of its own.

**Approach:** Port Sure's `Schedule`, `RecurrenceRule`, `FrequencyPreset`, `DeclaredBill`, `Classifier` and the bill fields at `14638a701` into `domain/recurring/` and `services/recurring/`, and give `/recurring` Sure's declare and edit dialog. Story 23.2 of `epics.md` is the acceptance contract; this spec adds what reading Archant and Sure settled. The owner authorised every decision below; each is an assumption the pull request lists.

## Boundaries & Constraints

**Always:**
- Migration `0056`: table `recurrence_rules` (`id`, `recurring_transaction_id` cascade, `frequency` in `RECURRENCE_FREQUENCIES` = `weekly`, `monthly`, `yearly`, `interval` > 0 default 1, `day_of_month` 1–31 or −1, `weekday` 0–6, `month_of_year` 1–12, `position` ≥ 0, unique on series and position). Checks, as Sure's `day_spec_coherent` without the nth weekday: never a day and a weekday; weekly has a weekday and no day or month; monthly has a day and no month; yearly has a day and a month. `recurring_transactions` gains `name`, `anchor_date`, `end_after_count` (1–600), `bill_type` in `BILL_TYPES` = `bill`, `subscription`, `installment`, `income`, `other` (not null, default `bill`), `category_id` (`ON DELETE SET NULL`, so a merged or deleted category leaves the series uncategorised, as Sure's `replace_and_destroy!`), `autopay` (not null, default false), `notes`, `payment_url`, `schedule_pinned_at`. Backfill, as Sure's `create_bills_subsystem`: one monthly rule per series on `expected_day_of_month`, `anchor_date` = `last_occurrence_date`, `bill_type` `income` when `amount > 0` else `bill`.
- Every series has at least one rule: detection and « Ajouter aux récurrences » write one monthly rule on the series' day, where Sure builds the same rule implicitly. A schedule's anchor is `anchor_date ?? last_occurrence_date`.
- `domain/recurring/schedule.ts` ports `Schedule` with weekend adjustment `none`, no end date and no nth weekday: `occurrencesBetween`, `firstOccurrenceAfter` (search capped at 3,660 days), `cycleFor`, `occurrencesPerYear`, `matchesDay` (±2, a weekly rule on its exact weekday), `endAfterCount` as Sure's `after_count`, and Sure's legacy shims `nextOccurrenceAfter` and `nextOccurrenceFromToday` for a plain monthly series (one monthly rule, interval 1, day ≠ −1). Modulo is never negative. It is the only code that computes a series' dates (AD-24): `series.ts`'s `nextExpectedDate`, `nextDateFrom`, `currentNextDate` and `staleBefore` delegate to it, and the manual pass, re-key and refresh test a row's day with `matchesDay`. The identifier's cluster test keeps its 31-day circle.
- `domain/recurring/frequency.ts` ports `FrequencyPreset`: presets `monthly`, `weekly`, `biweekly`, `semimonthly`, `quarterly`, `semiannual`, `annual`, and `interval` with a unit `weekly`, `monthly` or `yearly` and N 1–99; `detect` reads rules back to a preset, else `custom`; `apply` writes the rules, the day (−1 stored as 31, the reference's day for a weekly cadence) and `anchor_date ??=` reference for biweekly, quarterly, semiannual and interval, and says whether the cadence changed. Labels are Sure's `fr.yml`: « Mensuelle », « Hebdomadaire », « Toutes les 2 semaines », « Deux fois par mois », « Trimestrielle », « Tous les 6 mois », « Annuelle », « Intervalle personnalisé », « Échéancier personnalisé ».
- Staleness: `min(today − 2 months (6 manual), today − ceil(2 × 365.25 / occurrencesPerYear) days)`. Next date: a plain monthly series keeps Spec 9.2's; any other is `firstOccurrenceAfter(last date)`.
- Detection: refresh of an unpinned plain monthly series moves its rule's day with the detected day, as `sync_monthly_rule_day`; a pinned series (`schedule_pinned_at` set) never has its day or rules changed. A new suggestion goes through `domain/recurring/classifier.ts`, Sure's keyword lists and order verbatim, matched on `merchantName ?? label`, the credit-card test on `credit_card` accounts; category = most frequent non-null `categoryId` of its rows, first seen on a tie, in cluster order; autopay unless `bill`. An inflow pattern is `income`, no category, no autopay. A manual series with no row in six months keeps its dates, as Sure's `next if matching_entries.empty?`.
- `POST /api/recurring/declare` `{ kind: bill|income, name, amount, accountId, firstDueOn, frequency: { preset, interval?, unit? }, autopay?, notes?, paymentUrl?, entryId? }`: amount a positive decimal in the account's currency, stored negative for a bill and positive for an income (AD-5); `active`, `manual`, count 0, day, anchor, last and next date = `firstDueOn`; rules from `apply` with the due date's day, weekday and month; `dedup_scope` = the signed amount; key = `entryId`'s merchant or label key when given, else the normalised name; a unique-index conflict answers `409 RECURRING_ALREADY_EXISTS`.
- `PATCH /api/recurring/:id` takes `status` as today, or the edit fields: name, amount (sign kept), account (currency follows it), `billType` (not `income`, not for an income series), category, frequency with Sure's day fields (day of month or last, second day, weekday, month), `endAfterCount` 1–600 for an installment, cleared otherwise, autopay, notes, payment link. A changed cadence sets `schedule_pinned_at`. A link is trimmed, a bare host gets `https://`, and anything but `http` or `https` with a host answers `VALIDATION_ERROR` on `paymentUrl`.
- `GET /api/recurring/candidates?kind=bill|income`, at most eight: bill, Sure's `candidate_patterns` (identifier with 2 rows, outflows, mean ≥ one major unit, no series of the account, key and currency within 7.5 %, latest first); income, `income_source_candidates` (inflows of 90 days by account, key and currency, ≥ 2 rows, mean ≥ one major unit, no `income` series of that account and key, largest total first). Each gives name, magnitude, count, last date and latest entry id.
- Interface: « Ajouter une facture » and « Ajouter un revenu » on `/recurring`, « Modifier » in each row's menu, administrator only. The declare dialog lists the candidates; choosing one, or « Créer une facture » in a transaction's « Récurrence » block beside « Ajouter aux récurrences », fills the form from that entry: merchant name else label, magnitude, account, income for a positive amount, `nextOccurrenceFromToday` on its day. Names show as `name ?? merchantName ?? label` everywhere. Income hides type, category, link and autopay, as Sure's form.
- Export: `RecurrenceRule` lines as Sure's (`weekday_ordinal` null); the new columns in `EXPORTED_COLUMNS`, `end_mode` `after_count` or `never`, `schedule_pinned_at` inside `matcher_hints`.

**Never:** no occurrence, payment, alias or tolerance (23.3); no `/bills` page or cadence summary (23.4, 23.5); no renewal, trial or cancellation date, sibling link, transaction picker, smart fill, paycheck planner or account-less bill; no new MCP field (23.6).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Month end | monthly day 31, from 15 Jan | 31 Jan, 28 Feb, 31 Mar |
| Quarterly | anchor 10 Feb, interval 3 | 10 May, 10 Aug; not 10 Mar |
| Weekly day | weekly Monday, row on Tuesday | `matchesDay` false |
| Installment | 3 payments from 5 Jan | none after 5 Mar; `firstOccurrenceAfter` null |
| Semimonthly | rules 1 and 15 | reads « Deux fois par mois » |
| Custom | monthly interval 4 | reads « Intervalle personnalisé », 4 mois |
| Declare twice | same account, name, amount | `409 RECURRING_ALREADY_EXISTS` |
| Link | `banque.fr/payer` / `ftp://x` | `https://banque.fr/payer` / `VALIDATION_ERROR` |
| Pinned | quarterly set by hand, detection sees day 8 | day and rules unchanged |
| Classifier | « NETFLIX.COM », three rows | `subscription`, autopay |

</frozen-after-approval>

## Code Map

- `packages/data/schema/recurring-transactions.ts` -- columns :24-57, checks :59-74; enums with `inList` from `schema/check.ts`. New `schema/recurrence-rules.ts`. `pnpm data generate`, then hand-edit the backfill with a why-comment, as `drizzle/0055`. `data/migrate.spec.ts`: recurring block :1241, pre-0055 insert helper :1238, 0055 test :1354 to copy.
- `packages/api/src/domain/recurring/series.ts` -- `nextExpectedDate` :28, `nextDateFrom` :42, `currentNextDate` :49, `occurrencesOf` :110, `rekey` :140, `refreshSeries` :245, `staleBefore` :287 (constants :13-21). `identifier.ts` -- `onExpectedDay` :120, `detectRecurring` :190 (minimum rows becomes a parameter), `claimOf` :270. Dates from `domain/dates.ts` (`addDays`, `addMonths`, `withDay`); no date library.
- `packages/api/src/services/recurring/series.ts` -- `detectRecurring` :207, suggestion built :282-299 and inserted :334-336 (classifier, rule), `setRecurringStatus` :491, `addRecurringFromEntry` :658 (rule, `bill_type`), `listRecurring` :458, `RecurringRecord` :44. Rows from `ruleCandidates` (`ledger/rule-plans.ts:244`) carry `categoryId`. New `services/recurring/bills.ts` for declare, edit and candidates.
- `packages/api/src/lib/errors.ts` (409 codes :42-146) -- `RECURRING_ALREADY_EXISTS`; `fr.json` `errors` :1918.
- `packages/api/src/routes/recurring.ts`, `schemas/recurring.ts` -- amounts with `amountIn(currency)` (`schemas/budgets.ts:29`), lengths with `LABEL_MAX_LENGTH`, `NOTES_MAX_LENGTH` (`schemas/transactions.ts`).
- `services/ledger/export.ts:81-99,267`, `services/export.ts:721-748` -- columns and Sure lines; Sure's shape in `app/models/family/data_exporter.rb:347,630-682`.
- `packages/api/src/mcp/recurring.ts:16` -- description no longer says « same day of every month ».
- `packages/app/src/routes/_authed.recurring.tsx` (`RecurringActions` :97, buttons :280-285), `hooks/useRecurring.ts`, `components/TransactionLinks.tsx:271-320` (`RecurringBlock`, rendered at `TransactionForm.tsx:306`, which already excludes split parents and transfer sides). New `components/BillDialog.tsx`: react-hook-form with `zodResolver(schema, undefined, { raw: true })` and `applyFieldErrors`, as `SnapshotDialog.tsx:62`; `CategoryCombobox`, `DateField`, account `Select` as `TradeFields.tsx:177`. `locales/fr.json` `recurring.*` :1366-1420 (description no longer « chaque mois »), `transactions.recurring.*` :382-390.
- `packages/app/e2e/recurring.spec.ts` (helpers :37-98, sheet tests :311, :371), `e2e/fixtures.ts` (`addTransaction` :175, `addRecurring` :502).
- `docs/sure-parity.md` rows Inactive :200, Next date :201, Manual pass :202, Schedules :205, Bills declared by hand :206, Bill type :207.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/migrate.spec.ts` -- backfilled rule, anchor and type per existing row; each rule check refuses -- then schema and `0056`.
- [x] `domain/recurring/schedule.spec.ts` -- the matrix rows on dates, weekly backward from the anchor, yearly interval, `cycleFor`, both shims, 100 % branches -- then `schedule.ts`; `series.ts` delegates to it.
- [x] `domain/recurring/frequency.spec.ts`, `classifier.spec.ts` -- every preset both ways, `custom`, interval bounds; each keyword list, wildcard stems, ACH markers, credit-card rule, category tie -- then the modules.
- [x] `services/recurring/series.spec.ts` -- classified suggestion, pinned and unpinned day, staleness of a quarterly series, declared bill kept by the manual pass.
- [x] `services/recurring/bills.spec.ts`, `routes/recurring.spec.ts` -- declare (signs, key from entry, conflict), edit (pin only on a change, installment count, link), candidates (both kinds, claimed left out, eight), viewer refused -- then service, routes, errors, MCP, export.
- [x] `packages/app/e2e/recurring.spec.ts` -- declare a bill and an income, from a candidate, « Créer une facture » from a sheet, edit to quarterly and back to its preset, invalid link -- then dialog, hooks, page, locale.
- [x] `docs/sure-parity.md` -- the rows above become parity or name the departure.

**Acceptance Criteria:**
- Given a viewer, when they open `/recurring` or a sheet, then no declare, edit or « Créer une facture » control shows and `viewerReadOnly` refuses `POST /declare` and `PATCH`.
- Given an existing database, when `0056` runs, then every series lists and detects as before.

## Implementation Notes

- An edit that changes a followed series' cadence dates it from today on its new schedule; a suggestion from its last payment; a declared bill with no payment yet from its first due date.
- Moving a series to an account in another currency clears its amount band, which was in the old currency.
- An installment past its last payment keeps its last date as next date: the column is not null.
- A weekly rule with no weekday given takes the reference date's, since the database requires one where Sure leaves it null.
- Autopay, link and notes always show in the dialog; Sure's « Plus d'options » disclosure is not ported. Sure's hint that a new amount applies to future payments waits for 23.3's occurrences.
- Constants shared with the interface live in `packages/data/recurring.ts`, so the interface does not bundle Drizzle.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| 1 | A manual series with no row in its window keeps a past next date and its old count | medium | `refreshSeries` returns `keep` for every manual series; before, `currentNextDate` moved the next date on. Sure keeps the row but reads its next date from today. | patch |
| 2 | `rekey` moves a declared bill with no payment onto an unrelated purchase made on its due date | medium | `rekey` tries any series whose last date holds no row of its key; a declared bill's last date is its due date, so one same-day row in the half-to-twice band takes it. | patch |
| 3 | `PATCH` drops edit fields sent with `status`, and accepts an empty body | low | `recurringPatchSchema` extends the edit schema with `status`; the route calls only `setRecurringStatus` when it is present. | patch |
| 4 | Candidates on an inactive account leave the dialog's account blank | medium | `loadCandidates` reads every account; the page offers active accounts only, so the chosen id is missing from the select. | patch |
| 5 | `RECURRING_ALREADY_EXISTS` message says « même nom » where the key is the merchant or label | low | `fr.json` `errors`; the name is the key only for a bill declared from nothing. | patch |
| 6 | No test on `firstDueFrom`, the prefilled first due date | low | Pre-verified gap: the e2e test only checks the field is not empty. | patch |
| 7 | No e2e test shows a typed name over the label | low | Pre-verified gap: every e2e series has its name equal to its label. | patch |
| 8 | Detection's classifier input (merchant name, credit-card account) is untested in the service | low | Pre-verified gap: the service test uses rows with no merchant on a depository account. | patch |
| 9 | Band clearing on a currency move is untested | low | Pre-verified gap: the only move test starts from a declared bill with no band. | patch |
| 10 | A bill declared from nothing goes inactive six months after its due date though paid | low | Its key is the normalised name, which bank labels rarely carry; Sure's `DeclaredBill` has the same key until 23.3's payments date it. | reject |
| 11 | Semimonthly declared on the 15th becomes monthly; second day defaults to 15 | false | Sure's `DeclaredBill` passes no second day and `FrequencyPreset` defaults it to 15. | reject |
| 12 | `entryId` on another account than `accountId` is accepted by the API | low | The interface never sends it; a guard for an unreachable case. | reject |
| 13 | A bill declared from a tracked transaction through the API duplicates a detected series | false | Sure's `DeclaredBill` sets `dedup_scope` to the amount where detection leaves it blank: same behaviour. | reject |
| 14 | Declare or edit accepts an investment or inactive account | low | Server-side only; Sure accepts any writable account. | reject |
| 15 | Implementation note says any account move clears the band | low | Note corrected to the currency move the code implements. | reject |
| 16 | Anchor of pre-0056 series is fixed while new ones follow their last date | false | Sure's backfill anchors existing rows and leaves new ones null, falling back to the last date. | reject |
| 17 | Keyword lists are English | false | Spec: « Sure's keyword lists and order verbatim ». | reject |
| 18 | Autopay hint describes later behaviour | low | Sure's own hint text. | reject |
| 19 | No index on `category_id` | low | One household's series; a category delete scans a few dozen rows. | reject |
| 20 | Last-day rule diverges from `expected_day_of_month` after detection | maybe-false | `syncMonthlyRuleDay` skips −1 as Sure's; would need Sure's after-commit to settle; low at most. | reject |
| 21 | A currency move without `amount` relabels minor units | low | The dialog always sends the amount. | reject |
| 22 | `firstDueOn` in the past is accepted | false | Sure parses any date. | reject |
| 23 | Edited amount leaves `dedup_scope` at the old amount | false | Sure does not rewrite `dedup_scope` on edit either. | reject |
| 24 | Dialog opened before accounts load has an empty account | low | Accounts load with the page; unlikely in use. | reject |
| 25 | `cycleFor` before an installment's anchor returns a cycle after the date | false | Sure's `cycle_for` falls back to `first_occurrence_after` the same way. | reject |
| 26 | Empty `rules` gives invalid dates | false | Every series has a rule (migration, detection, declare); the type says so. | reject |
| 27 | ASCII `\b` differs from Ruby's | maybe-false | Ruby's `\b` on UTF-8 depends on Onigmo's word class; low at most. | reject |
| 28 | `matchesDay` clamps, so day 2 matches 28 February | false | Sure's `Schedule#matches_day?` and `day_window_sql` clamp the same way (AD-24). | reject |
| 29 | `PATCH /:id` calls two service functions (AD-1) | medium | The route chose between `editBill` and `setRecurringStatus`; now `patchRecurring` does. | patch |
| 30 | Candidate `total` typed as a bare `number` | low | AGENTS.md money rule; now `MinorUnits`. | patch |
| 31 | `DAYS_PER_YEAR` declared in `schedule.ts` and `series.ts` | low | `series.ts` imports it from `schedule.ts`. | patch |
| 32 | `dayOf`/`monthOf` slices repeated across modules, repeated `switch` on frequency, `weekday` as a bare number | low | Judgement calls with no named caller at risk. | reject |
| 33 | A declared non-monthly bill's `expected_day_of_month` follows a claimed pattern while its rules stay | low | No date reads the column outside a plain monthly series. | reject |

## Design Notes

Key of a declared bill: the epic says a typed name is shown while matching keeps the merchant or label. A bill declared from a candidate or a sheet takes that entry's merchant or label key, so 23.3's matcher scores the mortgage's merchant at 0.40; one declared from nothing keys on its normalised name. Sure's `DeclaredBill` drops the merchant; Archant keeps it because 23.3's mortgage criterion relies on it.

Account required: Archant's `account_id` is not null and a series takes its currency from its account (AD-6), so Sure's « N'importe quel compte » is not offered.

Preset labels: the epic's wording is replaced by Sure's `config/locales/views/recurring_transactions/fr.yml`.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint:code && pnpm lint:format` -- expected: clean.
- `pnpm test` -- expected: green, `domain/recurring/schedule.ts` at 100 % branches.
- `pnpm test:e2e` -- expected: green.
