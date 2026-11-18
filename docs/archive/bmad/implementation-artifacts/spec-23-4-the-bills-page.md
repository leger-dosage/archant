---
title: 'Story 23.4: The bills page'
type: 'feature'
created: '2026-10-06'
status: 'done'
baseline_commit: '16cadee2ec0b0b30cbb5b3e7f3ce208c5c627010'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-23-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 23.3 dates every bill and ties payments to it, but nothing shows what is overdue, due this month or paid, and the owner cannot mark a bill paid, skip it, postpone it, change its amount, or remove or review a payment.

**Approach:** Port Sure's `BillsController#index`, `bills_helper.rb` labels and the `recurring_occurrences` and `recurring_allocations` actions at `14638a701` as `/bills` and an occurrence sheet. Story 23.4 of `epics.md` is the acceptance contract; this spec adds what reading Archant and Sure settled. The owner authorised following Sure; each decision below is an assumption the pull request lists.

## Boundaries & Constraints

**Always:**
- `services/recurring/bills.ts` gains `billsOverview(deps)`, Sure's index on today in `APP_TIMEZONE`:
  - Series `active` or `inactive` with a negative amount (AD-5: outflow). Occurrences `due_on ≤ today + 90` and (`due_on ≥` first of the month or `scheduled`). Only confirmed payments count.
  - Open ones of an `inactive` series → `inactive`. Open active ones: `derivedState = overdue` → `attention`; `due_on ≤` end of month → `month`; else `later`, one per series, earliest. `month` also holds `paid` occurrences due this month, in place, by `due_on`. Skipped and missed are not listed.
  - `next`: `month` open and `later` with effective date `≥ today`, by effective date, first four.
  - Each row: occurrence id, series id, name, account, merchant, `dueOn`, `effectiveDueOn`, `snoozedUntil`, `days` (effective − today), state, expected, confirmed sum, remaining (`remainingOf`), currency, and its suggested payment if any.
  - Totals over rows in the reporting currency (`getReportingCurrency`), Sure's `compute_kpis`: `remaining` = Σ remaining of `attention` + open `month`; `overdue` = Σ remaining of `attention`; `dueSoon` = the first set with effective date `≤ today + 7`; `paid` = Σ confirmed of paid `month` rows. Rows in another currency stay listed, out of the totals, their series named once in `leftOut` as `goalsSummary` does.
  - `review`: suggested payments of listed occurrences, outgoing series only, by `match_confidence` desc then `created_at`: label, amount, date, series name, confidence, signals.
  - `hasSeries` (any series but `ended`) and `hasTransactions` (one ledger `exists` read in `services/ledger/recurring.ts`).
- `services/recurring/payments.ts`, Sure's `Allocator` and controllers:
  - `markPaid(id, paidOn = today)`: freeze expected; when something remains, a confirmed `user_created` payment for it with no entry; close `paid`/`user`.
  - `addPayment(id, { entryId?, amount?, paidOn? })`: with `entryId`, today's `attachEntry`, `amount` optional; without, `amount` and `paidOn` required, `user_created`, no entry. Then `refreshCloseState`.
  - `skipOccurrence`: freeze, close `skipped`/`user`. `reopenOccurrence`: only a closed one, back to `scheduled`, `closed_at` and `closed_source` null, amount and payments kept, no close refresh.
  - `editOccurrence(id, { snoozedUntil } | { expectedAmount })`: sets the snooze, or the expected amount, `null` clearing it; no close refresh.
  - `removePayment(id)`: delete, then `refreshCloseState`; no rejection row.
  - `paymentCandidates(occurrenceId)`: `matchableTransactions(windowOf(...))` scored by `explain`, without the series' rejected entries, entries already on this occurrence and entries with no capacity left; by score desc, first six.
- Routes, one service call each, mutating methods so `viewerReadOnly` refuses a viewer: `GET /api/recurring/bills`, `GET /api/recurring/occurrences/:id` (occurrence, payments, suggestion), `GET /api/recurring/occurrences/:id/candidates`, `POST …/occurrences/:id/paid` `{ paidOn? }`, `POST …/skip`, `POST …/reopen`, `PATCH /api/recurring/occurrences/:id`, `DELETE /api/recurring/payments/:id`. `POST …/occurrences/:id/payments` widens to `{ entryId?, amount?, paidOn? }`. Amounts are decimal text parsed by `parseAmount` in the occurrence's currency.
- `/bills` (`_authed.bills.tsx`), Sure's order: totals and « Prochaine », the `LeftOutNotice`, the review queue, « Nouvelles factures possibles » (moved out of `_authed.recurring.tsx` into a shared component), then « Requiert votre attention », « Ce mois-ci », « Après ce mois-ci », « Inactive ». Empty sections are not rendered. A link « Toutes les factures » leads to `/recurring`.
- Row labels, Sure's `occurrence_due_label` in `fr.json`: « Reportée au 12 octobre », « 3 jours de retard, échéance le 5 octobre » (« 1 jour »), « À payer aujourd'hui », « Échéance le 5 octobre » inside the grace, « À payer demain, 5 novembre », « À payer dans 4 jours, 5 novembre »; « Partiel · 120,00 € restant » when partial; a « Bientôt due » badge in state `due`; a paid row shows a check and « Payée ».
- Review line: « PRLV CREDIT AGRICOLE ressemble à un paiement de Prêt immobilier », amount, date, « 87 % », the signals (« Même marchand », « Libellé reconnu », « Montant exact » or « 0,07 € d'écart », « À la date prévue » or « 3 jours après l'échéance »), « Appliquer » and « Pas cette facture ».
- A row opens a sheet (`?occurrence=<id>`): its payments, and for an administrator « Marquer comme payée » with a date, « Ajouter un paiement » (amount, date, the candidates with percentage and signals), « Ignorer cette échéance », « Reporter » to a date, « Modifier le montant », each payment's removal; a closed occurrence offers only « Rouvrir ». Removing a payment asks through `ConfirmDialog`.
- Empty (`!hasSeries`): « Aucune facture pour l'instant », « Trouver les transactions récurrentes » (`useDetectRecurring`, toast with the count) and « Ajouter une facture » (`BillDialog`); without transactions, a sentence to connect a bank or import a file and « Ajouter une facture » alone. A viewer sees neither button.
- The rail's « Récurrent » becomes « Factures » at `/bills`. `EXPERIENCE.md` gains the `/bills` surface; `sure-parity.md` rows « Occurrences and payments » and « Bills page » say what Archant does.

**Never:** no `/bills?view=all`, no `/bills/:id` drawer, no `/recurring` redirect, no « À venir » tab (23.5); no MCP tool (23.6); no notices, detected-review banner, pay-period markers, autopay dimming, payment-link button, calendar or AI prompts; no free transaction search; no exchange rate; no `missed` write, as Sure has none.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Overdue | due 1 Oct, today 6 Oct | `attention`, « 5 jours de retard, échéance le 1 octobre » |
| Inside grace | due 4 Oct, today 6 Oct | `month`, « Échéance le 4 octobre », « Bientôt due » |
| Snoozed | due 1 Oct, snoozed to 12 Oct | `month`, « Reportée au 12 octobre » |
| Paid this month | paid 571,29 € due 5 Oct | `month` with a check; `paid` total 571,29 € |
| Partial | expected 300 €, 180 € confirmed | « Partiel · 120,00 € restant »; remaining 120 € |
| Later | monthly, Nov and Dec open | one row, November |
| Paused | `inactive`, open occurrence | `inactive`, not in totals |
| USD series | reporting EUR | listed, out of totals, named in `leftOut` |
| Mark paid | 300 € expected, 180 € confirmed | 120 € payment with no entry; `paid`/`user` |
| Remove payment | auto-closed paid, its only payment | reopened |
| Remove after mark paid | `user` close | stays paid |
| Add without entry, no amount | `{ paidOn }` | `VALIDATION_ERROR` `amount` |
| Candidate rejected | rejected for this series | not listed |
| Viewer | any write route | refused by `viewerReadOnly` |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/recurring/bills.ts` -- add `billsOverview`; `payments.ts` -- `attachEntry` :390, `refreshCloseState` :152, `confirmPayment` :281, `rejectPayment` :305, private `occurrenceOf`, `freezeExpected`, `amountFor` to reuse; `occurrences.ts` `currentOccurrences` :337 as a read pattern.
- `packages/api/src/domain/recurring/occurrences.ts` -- `derivedState` :72, `effectiveDueOn` :59, `resolvedExpected` :51, `remainingOf` :110; `matcher.ts` -- `explain` :232, `windowOf` :114, `rejectionKey` :105; `services/ledger/recurring.ts` -- `matchableTransactions` :21.
- `packages/api/src/routes/recurring.ts` (routes :25-56), `schemas/recurring.ts` (`attachPaymentSchema` :11), `routes/middleware/roles.spec.ts` :180-186 (add each write).
- Reporting currency: `services/settings.ts:8` `getReportingCurrency`; `domain/goals.ts:323` `goalsSummary` (left-out pattern); `packages/data/money.ts:238` `parseAmount`.
- Interface: `components/AppShell.tsx:72` (rail entry), `routes/_authed.recurring.tsx` (`Suggestions` :170 to extract, `EmptyState` :374, `BillDialog` use :478), `hooks/useRecurring.ts` (add bills, occurrence, candidates and action hooks; invalidate helper :47), `lib/query-keys.ts:88`, `components/{Money,LeftOutNotice,ConfirmDialog,DateField}.tsx`, `components/ui/sheet.tsx` (pattern `BudgetCategorySheet.tsx`), `hooks/useIsAdmin.ts`, `locales/fr.json` `recurring` :1368, `nav.recurring` :30.
- E2E: `e2e/recurring.spec.ts` helpers (`monthly` :51, `addMonthly` :66, `detect` :100), `e2e/fixtures.ts` (`addTransaction` :175, `setMerchant` :360, `declareBill` :507, `detectRecurring` :521), `e2e/viewer.spec.ts` :365-385 (`expectNone`).
- Docs: `docs/sure-parity.md` :208 and :213; `_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/EXPERIENCE.md` :34.
- Sure, `git -C ~/github/sure show 14638a701:<path>`: `app/controllers/bills_controller.rb` :21-109, :436-502, :606-643; `app/helpers/bills_helper.rb` :258-324; `app/controllers/recurring_occurrences_controller.rb`, `recurring_allocations_controller.rb`; `app/models/recurring_transaction/allocator.rb` :141-219; `app/views/bills/index.html.erb`, `config/locales/views/bills/en.yml` :111-139.

## Tasks & Acceptance

**Execution:**
- [x] `services/recurring/bills.spec.ts` -- every matrix row on sections, labels' inputs, `next`, totals, `leftOut`, review order, `hasSeries`/`hasTransactions` -- then `billsOverview` and the ledger `exists` read.
- [x] `services/recurring/payments.spec.ts` -- mark paid with and without remainder, add with and without entry, skip, reopen, snooze, amount set and cleared, removal reopening only an `auto` close, candidates filtered and ranked -- then the service functions.
- [x] `routes/recurring.spec.ts`, `roles.spec.ts` -- each new route, `NOT_FOUND`, `VALIDATION_ERROR`, viewer refused -- then routes and schemas.
- [x] `packages/app/e2e/bills.spec.ts` -- the rail link, sections and labels, totals and the left-out notice, the review queue's « Appliquer » and « Pas cette facture », each sheet action, both empty states, viewer read-only -- then hooks, `_authed.bills.tsx`, the sheet, the rail, `fr.json`.
- [x] `docs/sure-parity.md`, `EXPERIENCE.md` -- the rows and the surface.

**Acceptance Criteria:**
- Given a viewer, when they open `/bills` and a row, then no action shows and no candidates read is sent.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then every criterion of Story 23.4 in `epics.md`, as settled here, has a test.

## Implementation Notes

- `loadSeries` moved from `occurrences.ts` to `rules.ts` as `seriesWithSchedules`: `payments.ts` needs it, and `occurrences.ts` already imports `payments.ts`, so leaving it would make an import cycle.
- `attachEntry` is private now, reached through `addPayment`; with a transaction, `amount` and `paidOn` are optional, `paidOn` defaulting to the transaction's date.
- Marking paid or skipping a closed occurrence, or reopening an open one, answers `VALIDATION_ERROR` on `status`.
- `lib/settle.ts` awaits `mutateAsync`: a sheet action that closes its occurrence unmounts the buttons that sent it, and `mutate`'s per-call callbacks, toast included, never ran.
- End-to-end totals are compared with the response the page received, as the e2e database is shared; Vitest pins the sums.

## Spec Change Log

- Review found that a household with only an income series saw a blank `/bills`: `hasSeries` counted every series but ended ones. Sure's `bills#index` shows the empty card when no row is listed and no series is suggested, so the page follows Sure and `hasSeries` is gone. KEEP: `hasTransactions` and both empty-state wordings.

## Review Triage Log

| # | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| 1 | Candidates read lacks `requireRole("admin")` | low | A viewer reads every transaction already; nothing in the candidates is kept from them. The interface skips the read only because a viewer cannot act on it. | reject |
| 2 | `expectedAmount` error reported under `amount` | low | `amountOf` hard-coded the path; the API contract names the field sent. | patch |
| 3 | Add-payment rules live in the service, not Zod | low | Parsing the amount needs the occurrence's currency, which only the service knows; the body is still Zod-parsed. | reject |
| 4 | A payment can be added to a closed occurrence | low | Sure's `RecurringAllocationsController#create` has no such guard. | reject |
| 5 | `DELETE /payments/:id` removes a suggestion without a rejection | low | The sheet offers removal for confirmed payments only; Sure's `destroy` has no state check. | reject |
| 6 | Only an income series leaves `/bills` blank | medium | `hasSeries` counted incomes, `listed` was false, so neither totals nor empty state showed. | patch |
| 7 | Bills of inactive accounts still listed | false | Sure's `payable_series_ids` filters status, sign and access, not a disabled account. | reject |
| 8 | A snooze past the month stays in « Ce mois-ci » | false | Sure's `this_month` buckets by `due_on`, as here. | reject |
| 9 | `dueLabel` branches untested | low | Only e2e covers a few labels. | patch |
| 10 | Candidates sort has no tie-break | low | Equal scores ordered by read order; six-row cut unstable. | patch |
| 11 | Default payment date from the browser's clock | low | Visible, editable date; off only around midnight across time zones. | reject |
| 12 | `usePaymentCandidates`'s `enabled` always `true` | low | Dead parameter. | patch |
| 13 | Closed-status test written three times in the interface | low | Three one-line checks; no caller diverges today. | reject |
| 14 | Fixed HTML ids collide between two sheets | false | Changing `shown` re-keys and unmounts the previous sheet; two never coexist. | reject |
| 15 | Typed input lost when the actions block re-keys after « Reporter » | low | Only while another form is half-filled; rare. | reject |
| 16 | `sure-parity.md` « Payment matching » row stale | low | Still says the buttons come later. | patch |
| 17 | Sprint status and spec status disagree | false | The completion step syncs both. | reject |
| 18 | « Inactive » above a list of bills | low | French plural is « Inactives ». | patch |
| 19 | « Règle les 0,00 € restants » on a settled open occurrence | low | Only after a reopen of a fully paid occurrence. | reject |
| 20 | Viewer spec checks 403 without its code; totals e2e compares with the API | low | Vitest pins the sums; `viewerReadOnly`'s code is tested in `roles.spec.ts`. | reject |
| 21 | A snooze on or before the due date is stored but ignored | low | Sure's `snooze` has no check; `effectiveDueOn` takes the later date. | reject |
| 22 | Snooze or amount edit on a closed occurrence | low | Sure's `snooze` and `override_amount` have no guard. | reject |
| 23 | Manual payment on a skipped occurrence | low | Same as row 4. | reject |
| 24 | Future `paidOn` accepted | low | Sure parses any date. | reject |
| 25 | `settle`'s `onSuccess` throwing becomes an unhandled rejection | low | The callbacks only toast. | reject |
| 26 | A refused `paidOn` shows as a generic toast | low | `DateField` sends ISO dates only; the server's refusal is unreachable from the sheet. | reject |
| 27 | `markPaid`'s freeze untested | gap | Pre-verified: the fixture froze the amount already. | patch |
| 28 | The 90-day horizon untested | gap | Pre-verified: every overview test uses monthly bills. | patch |
| 29 | A settled occurrence's label names `dueOn` | low | Sure's `occurrence_due_label` names `effective_due_on` in every branch. | patch |
| 30 | Closed-status test written three times; review buttons written twice | low | `isPartial`, `dueLabel`, the sheet's `isClosed`; `ReviewQueue` and the sheet's `Suggestion`. | patch |
| 31 | `spent` holds money as a bare `number` | low | `AGENTS.md`: money is never a bare number. | patch |
| 32 | The review queue's comment says listed occurrences, the code takes every payable one | low | Sure's `suggested_allocations(payable_occurrences)`; the comment now says so. | patch |
| 33 | `seriesWithSchedules` lives in `rules.ts` | low | Forced by the `occurrences.ts` ↔ `payments.ts` cycle; `rules.ts` already loads every series' rules. | reject |
| 34 | `LeftOutNotice`'s prop is named `accounts` but receives series | low | Goals already pass goals; the notice's sentence names no kind. | reject |
| 35 | Header « Ajouter une facture » beside « Toutes les factures » | low | `/recurring` offered it in its header, and the page would otherwise offer it only when empty. | reject |

## Design Notes

`epics.md` places the sections « above the totals »; Sure's index draws the month's totals and « Prochaine » first, so Sure's order wins. Sure's sheet only offers « Snooze a week » and has no amount field; the story asks for a date and an amount, and Sure's routes take both, so the sheet exposes them. The epic rules a transaction picker out, so « Ajouter un paiement » offers only `explain`'s candidates, not Sure's free search.

`/recurring` leaves the rail but stays reachable from « Toutes les factures » and the transaction sheet until 23.5 redirects it, as Sure's view switcher links its overview to all bills.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint:code && pnpm lint:format` -- expected: clean.
- `pnpm test` -- expected: green.
- `pnpm test:e2e` -- expected: green.
