---
title: 'Story 23.3: Occurrences and the payments that settle them'
type: 'feature'
created: '2026-10-06'
status: 'done'
baseline_commit: 'f5d2dda3f889c6db5eede589f9b01c99e31404ea'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-23-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A series has dates but no due dates of its own, so nothing says whether this month's mortgage is paid, and a payment a few days late or a few cents off is never tied to the bill it settles.

**Approach:** Port Sure's `OccurrenceGenerator`, `Matcher`, `Allocator`, `HistoryBackfiller`, `PriceChangeDetector` and `Pipeline` at `14638a701` into `domain/recurring/` and `services/recurring/`. Story 23.3 of `epics.md` is the acceptance contract; this spec adds what reading Archant and Sure settled, and corrects two of its claims against Sure's code (Design Notes). The owner authorised following Sure; each decision below is an assumption the pull request lists.

## Boundaries & Constraints

**Always:**
- Migration `0057`, four tables with `created_at`/`updated_at`, enumerations as `const` arrays in `packages/data/recurring.ts` checked with `inList`:
  - `recurring_occurrences`: `id`, `recurring_transaction_id` (cascade), `original_due_on`, `due_on`, `currency`, `expected_amount` (integer ≥ 0, nullable: read as the series' magnitude until frozen), `status` in `OCCURRENCE_STATUSES` = `scheduled`, `paid`, `skipped`, `missed` (default `scheduled`), `snoozed_until`, `closed_at`, `closed_source` in `auto`, `user`, `notes`; check `(status = 'scheduled') = (closed_at is null)`; unique (series, `original_due_on`); index (`status`, `due_on`).
  - `recurring_allocations`: `id`, `recurring_occurrence_id` (cascade), `entry_id` (`ON DELETE SET NULL`, indexed), `allocated_amount` > 0, `state` `suggested`|`confirmed`, `source` `auto_matched`|`user_confirmed`|`user_created`, `match_confidence` (integer ten-thousandths, nullable), `match_signals` (JSON text, Zod-parsed), `paid_on`; unique (occurrence, entry) where entry is not null. No `currency`, `source_amount` or `source_currency` (AD-6).
  - `recurring_match_rejections`: `id`, series (cascade), `entry_id` (cascade), unique pair.
  - `recurring_price_changes`: `id`, series (cascade), `effective_on`, `previous_amount`, `new_amount` (positive magnitudes), `currency`, `entry_id` (set null); unique (series, `effective_on`). No `source` column: only detection writes one.
  - `recurring_transactions` gains `name_aliases` (JSON text array, default `[]`, Zod-parsed) and `learned_tolerance` (integer per mille, nullable), Sure's `matcher_hints` keys as columns beside 23.2's `schedule_pinned_at`.
- `domain/recurring/matcher.ts`, pure, Sure's `Matcher` verbatim in integers:
  - Identity: series currency and account, same sign, the series' merchant if it has one, else normalised label in {series label key, normalised name, aliases}; not excluded, not a split parent (AD-20), `direction() !== "transfer"` as detection (loan payment and investment contribution outflows stay), not rejected for the series, not in a confirmed allocation.
  - Window: `cycle = floor(365.25 / occurrencesPerYear)`, `half = max(floor((cycle − 1) / 2), 1)`, from `effective − min(2, half)` to `effective + min(7, half)`, `effective = max(due_on, snoozed_until)`; an occurrence overdue (`today > effective + 3`) stays open to today. Live runs read entries up to today; backfill does not clamp.
  - Score in ten-thousandths: merchant 4000 or label 3500; amount 3000 when equal, else `2500 − 1000·d/band` with `band = |expected| × max(75, learned) / 1000` per mille, capped at 250, nothing (score 0) when `d > band`; date `2000 − 1500·min(dist, span)/span`, `span` the window's length in days, at least 1; account 1000. Each term rounded half up, as Sure's `round(4)`.
  - Candidates below 6000 are dropped; per (entry, series) only the nearest occurrence stays, first on a tie. Sorted by score desc, occurrence id, entry id; each entry and occurrence taken once per run. Tier `confirmed` from 8500 when the entry is not pending and no other series' candidate for it is within 1500; else `suggested` from 6000 unless the series is `income`; backfill writes `confirmed` only.
  - `explain(series, occurrence, entry, today)` returns the score and signals or null, for 23.4.
- `domain/recurring/occurrences.ts`, pure: resolved expected amount (`expected_amount ?? |series amount|`), derived state (`overdue` past grace 3, `due` from 3 days before, else `upcoming`), close-worthy (one confirmed payment within 75 ‰ of expected, else total ≥ expected − 1 minor unit), price-change rule, horizon.
- `services/recurring/occurrences.ts`: `generate` (active only, from `cycleFor(today).start` else today, a manual series not before its anchor, to `max(today + 90, firstOccurrenceAfter(today))`, an installment to its last payment; insert or ignore on the unique key); `regenerateFuture` (delete scheduled, `due_on ≥ today`, no allocation, then `generate`), called on create of an active series, on a status change, on a cadence, day, anchor, end count or account currency change, and when detection moves a rule's day; `pinAmountsAlreadyDue` on a series amount change (open, due, `expected_amount` null take the old magnitude); `backfill(seriesIds | all active, months 6)` = insert from six months ago without the anchor clamp, backfill match, delete scheduled occurrences before `cycleFor(today).start` with no allocation.
- `services/recurring/payments.ts`, Sure's `Allocator`: amount = min(entry capacity, occurrence remaining), or the capacity when nothing remains, never 0; capacity = `|entry amount| −` its allocations of any state; `paid_on` = entry date. A confirmed write freezes `expected_amount` and refreshes close state: closes `paid`/`auto` when close-worthy, reopens only an `auto` close. `confirmPayment(id)` → `user_confirmed`. `rejectPayment(id)` → rejection row, allocation deleted. `attachEntry(occurrenceId, entryId)` → confirmed `user_confirmed`, then Sure's `learn_from_manual_attach!`: alias added when the series has no merchant and the label is new; learned tolerance = deviation per mille when it is the occurrence's only confirmed payment, it closes it, and the deviation exceeds 75 and the current one and is ≤ 250 (above 250, nothing learned).
- `services/recurring/price-changes.ts`: outflow series only; the two latest `paid` occurrences, each with exactly one confirmed allocation, amounts within 1 minor unit of each other and more than 1 from the series' magnitude; `effective_on` = latest `due_on`; skip an existing row on that date or a latest change already at that amount. A detected series takes the new amount (signed), then `pinAmountsAlreadyDue`; a manual one keeps its own.
- `services/recurring/pipeline.ts` `runRecurring(deps, { backfill })`: one immediate transaction: detection (today's body of `detectRecurring`, taking the transaction), generation for every active series, live match, price changes, then backfill when asked. Import, revert and sync call it without backfill inside their existing try/catch (code-only log); `POST /api/recurring/detect` calls it with backfill. `setRecurringStatus` from `suggested` to `active` runs that series' backfill, as Sure's confirm.
- Daily: `routes/middleware/daily-recurring.ts`, mounted beside `dailyPrices`, generates every active series' occurrences once per day in `APP_TIMEZONE`, claimed through a settings row as `services/prices.ts` `takeLease`, after the response.
- `absorbEntry` (`ledger/duplicates.ts`) moves allocations and rejections to the survivor, dropping one that would duplicate a unique pair. Every other deletion relies on the foreign keys (`PRAGMA foreign_keys = ON`).
- Routes, admin by `viewerReadOnly`, one service call each: `POST /api/recurring/payments/:id/confirm`, `POST /api/recurring/payments/:id/reject`, `POST /api/recurring/occurrences/:id/payments` `{ entryId }`. A transaction whose capacity is spent answers `409 PAYMENT_EXCEEDS_TRANSACTION`; a missing id answers `NOT_FOUND`.
- `RecurringRecord` gains `currentOccurrence` (earliest open, else latest: `dueOn`, effective date, status, derived state). `/recurring` shows it as « Payée », « À payer le 5 novembre » or « 3 jours de retard ». `GET /api/recurring/by-entry/:entryId` gains the confirmed payment's occurrence, and the sheet's « Récurrence » block reads « Paie l'échéance du 5 octobre de Prêt immobilier ».
- Export: `RecurringOccurrence`, `RecurringAllocation`, `RecurringPriceChange` and `RecurringMatchRejection` lines in Sure's shape, after `Transaction`; `name_aliases` and `learned_tolerance` go into `matcher_hints` (`learned_tolerance_pct` = per mille / 10).

**Never:** no occurrence sheet, mark paid, skip, reopen, snooze, amount override or payment removal (23.4); no `/bills` page or totals (23.4); no drawer (23.5); no MCP tool (23.6); no orphan repair (AD-17); no job, debounce or lock; no loan principal written from a matched payment.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Mortgage live, no merchant | due 5 Aug, 571,29 €; sync on 10 Aug brings 571,36 € | 8165 → suggested |
| Same, with merchant | as above | 8665 → confirmed, occurrence paid |
| Mortgage « Détecter » on 6 Oct, with or without merchant | rows 6 Jul, 10 Aug, 7 Sep, 5 Oct | 5 Jul to 5 Oct paid; 5 May and 5 Jun deleted; second run changes nothing |
| Rejected | reject the 10 Aug suggestion, run again | no suggestion for that pair |
| Two series | one entry, scores 8700 and 8000 | suggested only |
| Pending | score 9000, pending | suggested; backfill writes nothing |
| Income | score 7000 | nothing; 9000 → confirmed |
| Weekly bill | cycle 7 | window −2/+3 (half cycle 3) |
| Price change | two paid at 15,99 €, series 13,99 € | change on latest due date; detected series 15,99 €, older open due occurrence keeps 13,99 € |
| Manual attach | label new, 8 % above | alias added, learned tolerance 80 ‰ |
| Absorb | duplicate carries a payment | payment on the survivor |
| Deleted entry | confirmed payment | payment kept, entry null, occurrence still paid |

</frozen-after-approval>

## Code Map

- `packages/data/schema/recurring-transactions.ts` (columns :32-80, `RECURRING_STATUSES` :18), `recurrence-rules.ts` (pattern), `recurring.ts` (enums :8-23), `schema/check.ts:10` `inList`. JSON column as `transactions.lockedFields` (`text(..., { mode: "json" }).$type<T>()`); Zod parse on read as `services/imports.ts:172`. `pnpm data generate` → `0057`. `data/migrate.spec.ts` recurring block :1257, 0056 tests :1398 to copy.
- `packages/api/src/domain/recurring/schedule.ts` -- `cycleFor` :220, `occurrencesBetween` :175, `firstOccurrenceAfter` :192, `occurrencesPerYear` :237; `series.ts` `scheduleOf` :42, `syncMonthlyRuleDay` :77; `domain/normalize-label.ts`; `domain/cash-flow.ts:31` `direction`; `domain/dates.ts` `today`, `addDays`, `daysBetween`.
- `packages/api/src/services/recurring/series.ts` -- `detectRecurring` :248 (its immediate transaction :251-461 becomes a step of `runRecurring`), `loadCandidates` :175, `RecurringRecord` :52, `getRecord` :555, `listRecurring` :585, `setRecurringStatus` :618, `recurringOfEntry` :760, `addRecurringFromEntry` :781. `bills.ts` `declareBill` :138, `editBill` :233 (regenerate hooks). Callers: `services/imports.ts:429,459,541`, `services/sync.ts:288-294`.
- Ledger -- `ledger/duplicates.ts:47` `absorbEntry` (move after the tags/attachments step), `ledger/shared.ts:101-113` split helpers, `transactions.pending` and `.excluded`.
- Daily -- `routes/middleware/daily-prices.ts`, `services/prices.ts` `runState` :62, `startedToday` :93, `takeLease` :151; mount at `app.ts:451-452`.
- `lib/errors.ts` (`PAYMENT_EXCEEDS_TRANSACTION`, `fr.json` `errors`), `routes/recurring.ts`, `schemas/recurring.ts`, `routes/middleware/roles.spec.ts`.
- Export -- `ledger/export.ts` `EXPORTED_COLUMNS` :40, `LEFT_OUT` :287, readers :454-462; `services/export.ts` lines :722-782; `export.spec.ts` `TYPE_ORDER` :48. Sure's shape: `app/models/family/data_exporter.rb`.
- Interface -- `components/TransactionLinks.tsx:276` `RecurringBlock`; `routes/_authed.recurring.tsx` rows :394-440; `hooks/useRecurring.ts`; `locales/fr.json` `recurring` :1367, `transactions.recurring` :382. E2E: `e2e/recurring.spec.ts` helpers :33-100, `e2e/fixtures.ts` `addTransaction` :175, `setMerchant` :360, `declareBill` :507, `detectRecurring` :521.
- Sure, `git -C ~/github/sure show 14638a701:<path>`: `app/models/recurring_transaction/{matcher,allocator,occurrence_generator,history_backfiller,price_change_detector,pipeline}.rb`, `app/models/recurring_occurrence.rb`, `db/migrate/20260819165021_create_bills_subsystem.rb`.
- `docs/sure-parity.md` rows Occurrences :208, Payment matching :209, History rebuild :210, Price changes :212.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/migrate.spec.ts` -- each check and unique index refuses, existing series get `[]` and null -- then schema files and `0057`.
- [x] `domain/recurring/matcher.spec.ts` -- the matrix scores, identity filters, window edges and overdue extension, half-cycle cap of a weekly bill, nearest-occurrence pruning, ambiguity, pending, income, rejection, rounding; 100 % branches -- then `matcher.ts`.
- [x] `domain/recurring/occurrences.spec.ts` -- derived states, close-worthy both ways, price-change rule -- then the module.
- [x] `services/recurring/occurrences.spec.ts`, `payments.spec.ts`, `price-changes.spec.ts`, `pipeline.spec.ts` -- generation (manual anchor, installment, inactive), regeneration keeps paid and allocated rows, mortgage live and backfill twice, confirm, reject, attach learning, capacity, absorb, deletion, daily claim once -- then the services, `absorbEntry`, middleware.
- [x] `routes/recurring.spec.ts`, `roles.spec.ts` -- three routes, `409`, viewer refused -- then routes and errors.
- [x] `services/export.spec.ts` -- the three lines and `matcher_hints` -- then export.
- [x] `packages/app/e2e/recurring.spec.ts` -- a paid transaction's sheet names its occurrence; `/recurring` shows « Payée », « À payer le … » and « … jours de retard » -- then hooks, page, block, locale.
- [x] `docs/sure-parity.md` -- the four rows say what Archant does.

**Acceptance Criteria:**
- Given an import, a revert or a sync whose recurring step throws, when it commits, then the request succeeds and the log carries the code only.
- Given a viewer, when they call the three payment routes, then `viewerReadOnly` refuses them.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then every criterion of Story 23.3 in `epics.md`, as corrected here, has a test.

## Implementation Notes

- Transaction reads for `services/recurring/` live in `services/ledger/recurring.ts`: AD-2's lint rule keeps `entries` and `transactions` inside the ledger.
- `detectRecurring`'s body became `detectWithin`, run inside the caller's transaction by `runRecurring`.
- Attaching an entry in another currency answers `VALIDATION_ERROR` (`currency_mismatch`), attaching it twice to one occurrence `already_attached`.
- Rejecting a payment refreshes the occurrence's close state, so rejecting a confirmed one reopens an `auto` close.
- A detected series keeps its amount on a price change when another series of its account and key already holds the new amount: Archant's unique index includes the amount, Sure's does not.
- Kept from Sure: a series added from a transaction shows its current occurrence overdue until the next run matches it; a paused series keeps its past occurrences; an auto-matched payment above the expected amount is capped to what remains, so a price rise is recorded only through a manual attach.
- `/recurring` shows the current occurrence in « Prochaine échéance » rather than a column of its own, its days late computed by the server in `APP_TIMEZONE`.
- `roles.spec.ts`'s « a read writes nothing » reads once before its snapshot, since the day's generation writes a `settings` row.

## Spec Change Log

- Implementation found two errors of the planning read, both settled by Sure as the owner rules. The weekly matrix row said −2/+2; the spec's own formula and Sure's `window_for` give a half cycle of 3, so −2/+3. Rejections were left out of the export on the claim that Sure has no line for them; Sure's `data_exporter.rb:380` writes `RecurringMatchRejection` (`id`, `recurring_transaction_id`, `transaction_id`), so it is exported. KEEP: the code already followed the formula.

## Review Triage Log

| # | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| 1 | `allNdjson`'s doc comment now sits above `matcherHints` | low | `services/export.ts:620`: two doc blocks in a row, the first describing the function three helpers below. | patch |
| 2 | Absorb drops a confirmed payment when the survivor holds a suggestion for the same occurrence, and never refreshes close state | medium | `ledger/duplicates.ts` `moveRecurringPayments` keeps the survivor's row on a unique conflict whatever its state; no `refreshCloseState` follows. | patch |
| 3 | Absorb can leave the survivor paying more than its amount | low | Both entries are one bank line with one amount; only two payments to different occurrences could exceed it. | reject |
| 4 | A pending transaction's suggestion never becomes confirmed once booked | medium | `allocateMatched` returns when the pair is held; Archant books a pending line under the same entry id (AD-17), so the next run's confirmed decision is dropped and the bill stays open. Sure's repost gets a new entry. | patch |
| 5 | An overpayment is capped, so an automatic price rise is never recorded | false | Sure's `allocate_matched!` caps at the occurrence's remainder the same way; recorded as kept from Sure. | reject |
| 6 | A suggestion on one series uses the capacity a confirmed match on another needs | low | Sure's capacity counts suggested allocations too. | reject |
| 7 | Confirming an already confirmed payment rewrites its source | low | Only a suggestion is offered for confirmation; Sure's `confirm_suggestion!` has no guard either. | reject |
| 8 | Attaching a split parent pays twice with one transaction's money | medium | `attachEntry` checks the currency only; AD-20 keeps a split parent's money in its lines, and the matcher refuses it. | patch |
| 9 | Attaching another account's, an excluded or an opposite-sign transaction, or to a closed occurrence | low | Sure's `allocate!` accepts them; the owner chooses the transaction. | reject |
| 10 | Past open occurrences of a paused or ended series keep matching, and the read window grows | low | Sure's `open_occurrences` filters no status; one household's transactions since the oldest unpaid due date. | reject |
| 11 | A cadence change rebuilds from the cycle start, adding a past open occurrence | false | Sure's `regenerate_future!` then `generate!` start at `cycle_for(today).begin` the same way. | reject |
| 12 | Past open occurrences keep the old currency after a move | low | Moving a bill to an account in another currency is rare; future ones are rebuilt. | reject |
| 13 | `roundHalfUp`'s comment says `BigInt` protects a product already computed as a number | low | `occurrences.ts:37`; the products stay exact below 2^53, beyond any household amount. | patch |
| 14 | `detectRecurring` is only called by tests | medium | `services/recurring/series.ts:258`; production runs `runRecurring`, so three spec files test a path nothing takes (`AGENTS.md`, nothing unused). | patch |
| 15 | Days late computed with the browser's date | low | Off by one only around midnight across time zones. | reject |
| 16 | Sprint status `in-progress` while the spec is in review | false | The completion step syncs both; process, not code. | reject |
| 17 | A finished installment's backfilled unpaid occurrences are never pruned | false | Sure's `prune_uncovered_past!` also skips a series with no cycle. | reject |
| 18 | Re-key deletes a series with its payment history | medium | `detectWithin` applies `rekey`'s delete when another stored series holds the new key; occurrences cascade. Archant-only (Spec 11.8); moving history needs conflict handling on `original_due_on`. | defer |
| 19 | A failed daily run keeps the day claimed | low | Same lease as `services/prices.ts`; every import, sync and « Détecter » generates too. | reject |
| 20 | A zero-amount line passes the sign test of an income series | false | Its amount falls outside any band, so `amountScore` is null and the score 0. | reject |
| 21 | `clean()`'s rebuild of an inactive series' occurrences is untested | gap | Pre-verified. | patch |
| 22 | Detection's rebuild when a rule's day moves is untested | gap | Pre-verified. | patch |
| 23 | `editBill`'s rebuild on a currency move is untested | gap | Pre-verified. | patch |
| 24 | Import and sync could pass `backfill: true` unnoticed | gap | Pre-verified: the spies never read the argument. | patch |
| 25 | Rejection cascades and price change sets null on `entries`, against AD-2's `RESTRICT` | low | Sure's foreign keys; neither row carries money. AD-24 and AD-2 now name the exception. | patch |
| 26 | Bare `number` for money in matcher and allocator signatures | medium | `AGENTS.md` money rule; `amountScore`, `capacityOf`, `amountFor`, `allocateMatched`, `learnFromAttach`, `freezeExpected`. | patch |
| 27 | New French strings say « transaction » where the interface says « opération » | low | `fr.json`: « opération » throughout. | patch |
| 28 | `price-changes.ts` copies `bills.ts`'s `taken()`; `learnFromAttach` rebuilds `knownNames` | low | Two copies of one rule diverge on the next change. | patch |
| 29 | `listRecurring` passes today as `from` | low | Misleading name. | patch |
| 30 | `horizonOf` computes an installment's end date outside `schedule.ts` | medium | AD-24: `schedule.ts` is the only date engine. | patch |
| 31 | Days late counted from the browser's date | low | Architecture « Dates »: today is computed in `APP_TIMEZONE`; the server now returns it. Supersedes row 15. | patch |
| 32 | `dailyRecurring` typed with `BankConnectionDeps` | low | It touches no bank. | patch |
| 33 | Schema comment says only `services/recurring/` writes payments | low | `absorbEntry` moves them (AD-17). | patch |
| 34 | `services/ledger/duplicates.ts` imports `refreshCloseState` from `services/recurring/` | low | AD-24 hands `absorb` the payments; one call, no cycle. | reject |
| 35 | « Payée » shows only once no occurrence is open, so never for an active series | false | Sure's `current_occurrence` is the earliest open, else the latest, the spec's rule; 23.4's `/bills` shows the month's paid ones in place. | reject |
| 36 | `previous_amount` checked `>= 0`, not `> 0` | low | A series' magnitude is never zero in practice. | reject |
| 37 | `daily-recurring.ts` duplicates `daily-prices.ts`; `attachPaymentSchema` equals `addRecurringSchema` | low | Ten-line middlewares and a one-field schema; a shared factory is more than the copy. | reject |
| 38 | QA at 1280 px: a separate « Échéance en cours » column overflowed the card and contradicted « Prochaine échéance » (1 November beside an unpaid 1 October) | medium | Seen in Chromium on a scratch instance. The current occurrence now fills « Prochaine échéance », as Sure's `next_due_date` reads the next open occurrence; the fallback is the old date. « Statut » and « Actions » still overflow at 1280 px with the accounts column open, as on `main`. | patch |

## Design Notes

Two claims of `epics.md` disagree with Sure's code; Sure wins, as the owner rules. First, the mortgage without a merchant: 10 August scores 0.8165 only in a live run on 10 to 12 August. In « Détecter » every past occurrence is overdue, so its window runs to today; on 6 October 10 August scores 0.8881 and is paid. The live criterion (matrix row 1) keeps 0.8165. Second, `epic-23-context.md` says an income is never confirmed by itself; Sure's `tier_for` confirms an income at the exact tier and only refuses to suggest one, as the story's own criterion says.

The date term reaches 0.05 only at the end of an extended window: Sure divides by the whole window, so 7 days late in a 2+7 window scores 0.0833.

Aliases and learned tolerance are columns, not a JSON `matcher_hints`, because 23.2 already made `schedule_pinned_at` a column and the export assembles the hash.

The three payment routes come here, without a screen, so confirm, reject and attach have a caller and an API test; 23.4 puts buttons on them.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint:code && pnpm lint:format` -- expected: clean.
- `pnpm test` -- expected: green, `domain/recurring/matcher.ts` at 100 % branches.
- `pnpm test:e2e` -- expected: green.
