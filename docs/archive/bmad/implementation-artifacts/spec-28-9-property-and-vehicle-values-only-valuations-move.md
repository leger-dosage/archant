---
title: 'Story 28.9: Property and vehicle values only valuations move'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_commit: '1e35da438ba9c73e91b55effb2608ed428c4b01a'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-28-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `forwardBalances` in `packages/api/src/domain/balances/forward.ts` adds every booked transaction to every manual account, so paying a builder from a property account lowers the home's value. Sure `00dd977fb` files `Property` and `Vehicle` as `:non_cash` in `Account#balance_type` (`app/models/account.rb:716`), and `Balance::BaseCalculator` (`flows_for_date`, `derive_cash_balance`, `derive_non_cash_balance`) moves a non-cash account's value only through valuations, a `Loan` alone excepted.

**Approach:** Give each type Sure's balance type in `ACCOUNT_TYPES`, make the forward pass and the snapshot gap ignore movements on a non-cash type other than a loan, recompute existing property and vehicle accounts once at start, and edit AD-8.

## Boundaries & Constraints

**Always:**
- `ACCOUNT_TYPES` carries `balanceType`, Sure's values: `depository` and `credit_card` `cash`, `investment` `investment`, `loan`, `property` and `vehicle` `non_cash`. One reader, `transactionsMoveBalance(type)` in `packages/data/account-types.ts`: false for `non_cash` but `loan`, as Sure's `accountable_type == "Loan"` branch. Story 28.10 adds its types to the same table.
- On such an account each day's balance is its valuation if one is dated that day, else the previous day's; transactions, trades and excluded rows alike move nothing. Valuations keep AD-8's rules: opening anchor, reconciliations, zero before the oldest entry.
- The snapshot gap, `computed` and `gap` in `services/ledger/snapshots.ts`, follows the same rule, so « Soldes » shows no gap from a builder's payment.
- Existing accounts: `recomputeNonCashBalances` claims `non_cash_balances_recomputed_at` in `settings` and recomputes every property and vehicle account from its history start in that one transaction, as `recomputeFeeCostBases` (AD-12). A failure rolls the claim back and stops the start.
- The stored `cash` stays equal to `balance` on these accounts, as AD-8 says of every account but an investment.
- AD-8 and AD-12 in `docs/architecture.md` say the new rule and the new key; `docs/sure-parity.md` « Property and vehicle » row becomes Parity, Story 28.9.

**Never:** no change to a loan, a depository, a card or an investment account's balances; no SQL migration and no schema change; no screen, text or route change; no change to `reverseBalances`, since `LINKABLE_TYPES` in `domain/bank-accounts.ts` never links a property or a vehicle; no change to transfer matching or cash-flow reports, where these rows already count as before.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Builder paid | property opened at 300 000 on 1 May, −5 000 on 10 May | 300 000 every day | none |
| Valuation | then a snapshot of 320 000 on 20 May | 300 000 to 19 May, 320 000 from 20 May | none |
| Line before the opening | vehicle line on 1 April, opening on 1 May | 0 from 1 April to 30 April, then the opening value | none |
| Future line | property line dated next month | balances run to it, value unchanged | none |
| Snapshot gap | snapshot of 320 000 after the −5 000 line | `computed` 300 000, `gap` 20 000 | none |
| Loan | payment of −1 000 on a loan | debt falls by 1 000, as today | none |
| Start, existing data | property stored with the line counted | rows recomputed once, key written | failure: start stops, key absent |
| Second start | key present | nothing recomputed, 0 returned | none |

</frozen-after-approval>

## Code Map

- `packages/data/account-types.ts:13-70` -- `ACCOUNT_TYPES`; add `balanceType` to each entry and to the `satisfies` shape; `classificationOf` at `:94` is the pattern for `balanceTypeOf` and `transactionsMoveBalance`.
- `packages/api/src/domain/balances/forward.ts:20-77` -- `ForwardInput`, `forwardBalances`; a new input field, set from `transactionsMoveBalance`, skips `sums` when false. Investments untouched.
- `packages/api/src/domain/balances/snapshot.ts:33-55` -- `SnapshotGapInput`, `snapshotGap`; same field. Leave `snapshotGapBackward`.
- `packages/api/src/services/ledger/balances.ts:307-400` -- `recomputeBalances` passes the field from `account.type`; may skip `bookedMovements` when false. New `recomputeNonCashBalances` beside it.
- `packages/api/src/services/ledger/snapshots.ts:303-375` -- `gapReader` passes the field from `type`.
- `packages/api/src/services/ledger/holdings.ts:80-130` -- `recomputeFeeCostBases`, the pattern to copy: claim with `onConflictDoNothing().returning`, `behavior: "immediate"`, accounts by id.
- `packages/api/src/index.ts:115-121` -- call it after `recomputeFeeCostBases`, log the count above zero; `index.spec.ts:166` checks the fee key, add the new one.
- Tests to extend: `domain/balances/forward.spec.ts`, `domain/balances/snapshot.spec.ts`, `services/ledger/balances.spec.ts`, `packages/data/account-types.spec.ts`.
- Unchanged readers, all through `balances`: `balanceOn`, the dashboard, net worth, the overview's « Valeur marchande » and « Tendance » (`services/account-overview.ts`), `get_accounts`, the export.
- `docs/architecture.md:135` AD-8, `:159` AD-12; `docs/sure-parity.md:82`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/account-types.spec.ts`, `domain/balances/forward.spec.ts`, `domain/balances/snapshot.spec.ts`, `services/ledger/balances.spec.ts`, its start test modelled on `holdings.spec.ts:301-355`, `index.spec.ts` -- every matrix row, failing first.
- [x] `packages/data/account-types.ts` -- `balanceType`, `balanceTypeOf`, `transactionsMoveBalance`.
- [x] `domain/balances/forward.ts`, `domain/balances/snapshot.ts` -- the flag.
- [x] `services/ledger/balances.ts`, `services/ledger/snapshots.ts` -- pass it; `recomputeNonCashBalances`.
- [x] `packages/api/src/index.ts` -- run it at start.
- [x] `docs/architecture.md`, `docs/sure-parity.md` -- AD-8, AD-12, the parity row.

**Acceptance Criteria:**
- Given a property with a transaction, when a ledger write recomputes from a day after the oldest entry, then the incremental pass gives the same rows as a full one.
- Given the finished story, when `pnpm test:e2e` runs, then no Playwright file changed.

## Implementation Notes

- `reverseBalances` passes `transactionsMoveBalance: true`, the field being required so no caller forgets it; no linked account is non-cash.
- `routes/transfers.spec.ts`: a move into a home or a car leaves its value as it was, as Sure's.
- `recomputeNonCashBalances` takes every type `transactionsMoveBalance` refuses, so a type Story 28.10 adds needs no second list.

## Spec Change Log

## Review Triage Log

| Source | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| blind, edge, verification-gap | `recomputeNonCashBalances` lists `property` and `vehicle` by hand beside `transactionsMoveBalance` | low | two sources of one rule; Story 28.10 adds types to `ACCOUNT_TYPES` | patch: filter `ACCOUNT_TYPE_IDS` on `transactionsMoveBalance` |
| blind | Spec says `in-review`, `sprint-status.yaml` says `in-progress` | false | the workflow syncs the story to `review` in its next step | rejected |
| blind | The rollback test fails before any account is rewritten | low | one SQLite transaction holds every rewrite; a second account adds a case for the database's own guarantee | rejected |
| blind, verification-gap | « still lowers a loan's debt » in `forward.spec.ts` tests a plain liability under the property block | low | `forwardBalances` never sees the type; the loan rule is covered in `account-types.spec.ts` and `balances.spec.ts` | patch: deleted |
| blind | `gapReader` still reads movements it then ignores | low | one grouped read of at most two days per snapshot | rejected |
| blind | No test of an excluded row or a trade on a property | false | `recomputeBalances` reads no movement at all for these types, excluded or not; trades exist only on investment accounts | rejected |
| blind | The start test checks the checking account alone stays untouched | low | the recompute selects by type, and the count assertion pins which accounts it took | rejected |
| blind | Self-hosters see property and vehicle history change without notice | medium | net worth history moves on upgrade, no action needed | patch: said in the pull request description |
| blind | `index.spec.ts` has no failed-start case | low | the failure path is the service's, tested in `balances.spec.ts` | rejected |
| blind | No screenshot of the property page | low | the visible value changes | patch: QA capture in the pull request |
| blind | `index.ts` comment reads unclearly | low | « the same way » names nothing | patch: reworded |
| blind | `transactionsMoveBalance` out of alphabetical order in an import | false | `pnpm lint:format` passes; the formatter owns the order | rejected |
| edge | A property whose anchor a pre-27.21 import shifted keeps that shift once lines stop counting | low | needs a bank file imported into a property before 27.21 with lines before its opening; Sure has no such shift to undo | rejected |
| edge | `reverse.ts` changes though the spec says « no change to `reverseBalances` » | low | one required argument set to `true`; behaviour unchanged, recorded in Implementation Notes | rejected |
| standards | `recomputeNonCashBalances` repeats `recomputeFeeCostBases`' claim and loop | low | two copies of AD-12's pattern in two modules; a shared helper is a third abstraction for two callers | rejected |
| standards | `moves` reads as a list beside `movements` | low | `balances.ts` | patch: `transactionsMove` |
| standards | The `ACCOUNT_TYPES` comment lacks a verb after the insertion | low | « its balance type what moves its balance » | patch |
| standards | `BALANCE_TYPES` and `balanceTypeOf` serve one reader | low | mirrors Sure's `Account#balance_type`, which Story 28.10 extends | rejected |
| standards | Test title « a loan's included » is ambiguous | low | `account-types.spec.ts` | patch |
| spec | The matrix's « payment of −1 000 on a loan » has the sign AD-5 gives a new debt | low | the test pays `+100_000` into the loan, which AD-5 makes a repayment; the frozen row's wording, not the code | rejected |

## Design Notes

Sure stores `cash_balance` 0 on a non-cash account. Archant keeps `cash` equal to `balance` there: only the forward pass's seed and the export's `cash_balance`, a field Sure's `Family::DataExporter` does not write, read it, so following Sure would change one line of Archant's own export for nothing a user sees.

The epic says « migration »; a migration cannot replay entries, so the recompute runs once at start, the primitive Story 27.5 used for cost bases.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.

**Manual checks (if no CLI):**
- On a local instance holding a property with a transaction, the first start logs the recompute and the property page shows the last valuation; a second start logs nothing.
