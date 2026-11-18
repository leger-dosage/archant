---
title: 'Story 27.24: Recurring transfers as Sure follows them'
type: 'feature'
created: '2026-10-12'
status: 'done'
baseline_commit: '0b3c247cd7a9a66e3d2d2ce4e3555c179808c574'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Archant's recurring detection and matching read `recurringDirection`, which keeps the outflow of a `loan_payment` or `investment_contribution` transfer as an ordinary expense, so a mortgage payment is followed as a bill; Sure skips every transfer kind for an ordinary series and follows a standing transfer as a recurring transfer with a `destination_account_id`, paid by the transfers into that account (`origin/main` `00dd977fb`, #3932).

**Approach:** No transfer side is ever a candidate of an ordinary series; a series with a destination account is a recurring transfer, created from a transfer's outflow by « Marquer comme récurrent » and paid by the outflows of transfers from its account into its destination, identity scored 4000 « Virement vers le même compte ».

## Boundaries & Constraints

**Always:**
- Exclusion: detection, matching, the manual pass, `rekey`, `addRecurringFromEntry`, the income candidates and a hand attach to an ordinary series read `direction` from `domain/cash-flow.ts`; `recurringDirection` is deleted. Sure's `identity_matches?` `return false if entry.entryable.transfer?`, `identifier.rb` `.where.not(kind: TRANSFER_KINDS)`.
- Schema, migration 0072 by `pnpm data generate` (table rebuild): `destination_account_id` nullable, `ON DELETE CASCADE`, as Sure's; checks as Sure's `chk_recurring_txns_transfer_requires_source` and `_distinct_accounts`; `key_check` lets a series with a destination carry neither merchant nor label; `BILL_TYPES` gains `transfer`, which a destination forces and nothing else may take (Sure's `derive_transfer_bill_type`, `bill_type_matches_shape`); a partial unique index `(account_id, destination_account_id, amount, currency, dedup_scope) WHERE destination_account_id IS NOT NULL`.
- Existing data, in the same migration: an active or inactive series whose every payment is the outflow of a `loan_payment` or `investment_contribution` transfer into one account becomes a recurring transfer into that account, its name, occurrences and payments kept, merchant and label cleared, `bill_type` `transfer`. Any other series is left as it is.
- Creation, as `RecurringTransaction.create_from_transfer`: `POST /api/transfers/:id/recurring`; account the outflow's, destination the inflow's, amount and currency the outflow's (AD-5 sign), monthly on the outflow's day, `last_occurrence_date` its date, `active`, `manual`, `occurrence_count` 1, rules and occurrences as `declareBill` writes them. Name « Remboursement vers {compte} » into a liability, « Virement vers {compte} » otherwise, Sure's `Transfer#name` in French. A series already on the same account, destination, amount and currency, whatever its status, answers `RECURRING_TRANSFER_ALREADY_EXISTS` 409, « Un transfert récurrent existe déjà pour cette paire de comptes ».
- Matching, live, backfill, cleaner and the picker's explanation: a transaction is a candidate of a recurring transfer only when it is the outflow of a transfer from the series' account into its destination; signal `transfer` 4000 replaces merchant or name; amount, date and account scores and tolerances unchanged. Detection's refresh and `rekey` skip a recurring transfer, as Sure's `update_manual_recurring_transactions`; the cleaner counts its matched outflows, as Sure's `matching_transactions` since #1590.
- Interface: `TransferBlock` offers Sure's « Marquer comme récurrent » on either side to an administrator, never hidden when one exists (Sure), toast « Transfert marqué comme récurrent »; `RecurringBlock` hidden on every transfer side. « Factures » lists a recurring transfer only into a `credit_card` or `loan` account (Sure's `payable_series_ids`), « Toutes les factures » lists every one, type « Virement »; its row's subline reads « Remboursement de dette » (Sure's `bills.debt_payment`). Match reason `bills.match.transfer` « Virement vers le même compte ».
- Assistant, as Sure's: `get_recurring_transactions` `is_transfer` true for one and `destination_account`, totals leaving transfers out; bill outputs carry `destination_account`, `bill_type` `transfer`. Inputs unchanged.
- Export: `destination_account_id` in the table list and the Sure line; `testing/sure-preflight.ts` follows Sure's shape after `00dd977fb`.

**Never:** no recurring transfer from the declare dialog or `create_bill` (Sure's neither); the edit dialog changes neither account nor destination; no un-mark action (Sure has none, deletion stays); no change to `countsInCashFlow` or `direction`; no detection of transfer patterns.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Loan outflow | three monthly loan payments, same amount | no ordinary series detected | none |
| Mark | transfer checking → loan, −800,00 € on the 5th | active series, destination loan, on « Factures » | none |
| Paid | next transfer checking → loan, −800,00 € on the 5th | occurrence paid, reason « Virement vers le même compte » | none |
| Other destination | transfer checking → savings, −800,00 € | not a candidate | none |
| Savings order | marked transfer checking → savings | on « Toutes les factures » only | none |
| Again | mark a second transfer of the same pair and amount | nothing written | `RECURRING_TRANSFER_ALREADY_EXISTS` |
| Migrated | bill paid only by loan payment outflows into one loan | recurring transfer into that loan, payments kept | none |

</frozen-after-approval>

## Code Map

- `packages/api/src/domain/cash-flow.ts:43-55` -- delete `recurringDirection`; callers use `direction`.
- `packages/api/src/domain/recurring/identifier.ts:200`, `matcher.ts:23-44,141-163,200-249,316,386`, `series.ts:141,188` -- exclusion, `transfer` identity and score, `explain`.
- `packages/data/schema/recurring-transactions.ts:29-117`, `packages/data/recurring.ts:16` (`BILL_TYPES`), `packages/data/schema/recurring-occurrences.ts:74-80` (`MatchSignals.transfer`) -- schema; migration `packages/data/drizzle/0072_*.sql`, data step hand-edited after the rebuild as `0055` was; `packages/data/migrate.spec.ts` pins it.
- `packages/api/src/services/ledger/recurring.ts:28-90` -- `matchableTransactions` and `paymentTransaction` carry the outflow flag and the counterpart account (`transferColumns`, `services/ledger/shared.ts:274-290`).
- `packages/api/src/services/recurring/series.ts:185-202,262-470,477,490-522,891-894` -- candidates, refresh, `clean`, `recordColumns` gain `destinationAccountId` and its name, `addRecurringFromEntry`.
- `packages/api/src/services/recurring/bills.ts:214-300,567,745,911-920,1330` -- creation beside `declareBill` (`monthlyOn`, `insertRules`, `regenerateFuture`), income candidates, `loadBills` left join on the destination, overview filter, `allBills` type.
- `packages/api/src/services/recurring/payments.ts:406,930-1010` -- `attachEntry` refusals, `paymentCandidates` for a transfer series.
- `packages/api/src/routes/transfers.ts:17-28`, `lib/errors.ts:139` -- route and code.
- `packages/api/src/mcp/recurring.ts:52-56,104-142`, `mcp/bills.ts:188-212` -- outputs.
- `packages/api/src/services/ledger/export.ts:88-117`, `services/export.ts:876-911`, `testing/sure-preflight.ts:297-330,589-593` -- export.
- `packages/app/src/components/TransactionLinks.tsx:37-162,275-371`, `TransactionForm.tsx:324-329`, `components/BillLabels.tsx:77-140`, `routes/_authed.bills.tsx:110`, `hooks/` (new mutation beside `useRecurring.ts`), `locales/fr.json:385,1568-1579,2459`.
- Tests: `testing/ledger.ts` (`insertTransfer`, `pairOf`, `openLoan`), `testing/recurring.ts`; `e2e/fixtures.ts` (`openAccount` `kind: "mortgage"`, `matchTransfer`, `detectRecurring`).

## Tasks & Acceptance

**Execution:**
- [x] Failing tests first: flip `identifier.spec.ts:334`, `matcher.spec.ts:223`, `series.spec.ts:135,274`, `services/recurring/series.spec.ts:1229` to refusals; `matcher.spec.ts` transfer identity, other destination refused, `explain` signal; `services/recurring/bills.spec.ts` creation, duplicate, overview filter; `payments.spec.ts` attach and candidates; `occurrences.spec.ts` paid by the next transfer; `routes/transfers.spec.ts`; `mcp` outputs; `export.spec.ts`; `migrate.spec.ts` conversion.
- [x] Schema, `BILL_TYPES`, migration 0072 with its data step.
- [x] Domain, ledger reads, services, route, error code, MCP, export, preflight.
- [x] `TransferBlock` action, `RecurringBlock` condition, bill row subline, match reason, locale.
- [x] `packages/app/e2e/recurring.spec.ts` -- mark a checking → mortgage transfer as recurring, add next month's pair, « Trouver les transactions récurrentes », see the occurrence paid on « Factures »; screenshots of the sheet and the bills page.
- [x] `docs/architecture.md` AD-9 sentence on `recurringDirection` replaced, AD-24 gains recurring transfers; `epics.md:4095` Epic 23 departure marked revised by Story 27.24; `docs/sure-parity.md:203,224,226,252` to Parity; `sprint-status.yaml`.

**Acceptance Criteria:**
- Given an existing database with a mortgage bill paid by loan payments, when migration 0072 runs after its backup, then the bill is a recurring transfer into the loan and keeps its payments.
- Given `pnpm test` and `pnpm test:e2e`, when they run, then they pass.

## Implementation Notes

- A transfer side carries `intoAccountId`, the account its transfer pays into when it is the outflow (`TransferSide` in `domain/recurring/identifier.ts`): `matchableTransactions` and `paymentTransaction` join the inflow's entry, and `loadCandidates` reads `transferDestinations` beside `ruleCandidates`, so the rules engine is untouched.
- Migration 0072's data step converts only an active or inactive series whose every payment with a transaction is the outflow of a `loan_payment` or `investment_contribution` transfer, all from one account (the series' own when it has one) into one other; of several that would share the new unique index, the oldest converts. `label` stays (NOT NULL, display fallback); `label_key` and `merchant_id` are cleared.
- Sure-format line: Sure's exporter at `00dd977fb` writes no `destination_account_id` and its importer reads none, so a line typed `transfer` would fail `bill_type_matches_shape` and abort its import. The line is typed `bill`, Sure's importer fallback, and a recurring transfer's line carries `archant: { destination_account_id, bill_type: "transfer" }`.
- Migration 0072 makes every converted series manual, as Sure's recurring transfers are.
- The edit dialog hides the account and type fields of a recurring transfer; the API refuses an `accountId` change or any `billType` on one.
- A hand attach of a transfer side to an ordinary series answers `VALIDATION_ERROR` `entryId` `transfer_side`.
- Playwright runs detection from « Identifier les modèles »: « Trouver les transactions récurrentes » shows only on an empty bills page, which the shared e2e database never is.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---------|---------|----------|-------|
| Detection never refreshes a recurring transfer, so its stored dates freeze (blind, verification-gap) | false | Sure's `update_manual_recurring_transactions` skips `destination_account_id` rows the same way and `get_recurring_transactions` returns the stored `next_expected_date`. | rejected |
| « Marquer comme récurrent » leaves the marked outflow's own occurrence open (blind) | low | Sure's `create_from_transfer` attaches nothing either; the next matching run pays it. | rejected |
| Migration keeps `manual = 0` on a converted detected series (blind) | medium | Sure's recurring transfer is always manual; with 0 the interface offers « Ce n'est pas une facture » and deletion ends it. | patch |
| Migration test misses mixed payments and two series on one pair (blind, verification-gap) | medium | Removing `HAVING count(*) = count(ie.id)` or `rank = 1` fails no test; a duplicate would fail the unique index at start. | patch |
| Sure line loses the destination, against the `archant` key convention (blind) | medium | `docs/deployment.md` puts what Sure has no field for under `archant`; Sure's own exporter writes no destination. | patch |
| A hand attach to a recurring transfer accepts any transaction (blind, edge) | false | Sure's picker returns the whole scope for a transfer series (`return scope if series.transfer?`) and its allocation adds no check. | rejected |
| `get_bills` totals count recurring transfers (blind) | medium | Sure's `get_bills` totals exclude income and transfers. | patch |
| AD-24 says « Marquer comme récurrent » alone creates a recurring transfer (blind) | low | Migration 0072 creates them too. | patch |
| Epic 23 bullet keeps the old rule beside « Revised by Story 27.24 » (blind) | false | The story asks that departure be marked revised, not rewritten; `epics.md` is a planning record. | rejected |
| « Transfert » in the toast and the duplicate message, no final period (blind) | low | Archant says « virement » everywhere else; Sure's French is a source, not a rule. | patch |
| No screen shows the destination account (blind) | false | Sure shows none apart from the name and « Remboursement de dette »; the name carries it. | rejected |
| Editing a converted installment clears its payment count (edge) | medium | `BillDialog` sends `endAfterCount: ""` for any type but installment. | patch |
| A liability other than a card or a loan is named « Remboursement vers » but left off « Factures » (edge) | false | Sure's `Transfer#name` and `payable_series_ids` behave the same. | rejected |
| A mortgage bill with no payment yet, or duplicates, are not converted (edge) | false | The spec's decision; such a series has no destination to read. | rejected |
| Cleaner on a real recurring transfer untested through `loadCandidates` (verification-gap) | medium | Domain tests pass pre-filled `intoAccountId`. | patch |
| `taken`'s destination condition untested (verification-gap) | medium | Dropping it fails no test. | patch |
| `credit_card` case of the « Factures » filter untested (verification-gap) | low | Narrowing `DEBT_ACCOUNT_TYPES` to `loan` fails no test. | patch |
| Recurring transfer's edit dialog never exercised (verification-gap) | medium | Only ordinary bills are edited in e2e. | patch |

## Design Notes

Sure's matcher requires an actual `Transfer` record: a transfer side never paired is no candidate. A `pending` transfer counts as a confirmed one (AD-11). The series' sign stays AD-5's, negative, so the overview's `amount < 0` filter keeps it; Sure stores the outflow positive. Sure's French has no `bills.match.same_transfer` key; « Virement vers le même compte » is the French wording.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean.
- `pnpm test` and `pnpm test:e2e` -- expected: green.

**Manual checks:**
- Screenshots: the transfer sheet with « Marquer comme récurrent », « Factures » with the recurring transfer and its subline, the payment picker's reason.
