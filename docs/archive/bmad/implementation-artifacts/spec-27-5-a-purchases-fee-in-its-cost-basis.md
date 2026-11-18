---
title: "Story 27.5: A purchase's fee in its cost basis"
type: 'bugfix'
created: '2026-10-09'
status: 'done'
baseline_commit: '9b94c40eed791c94554d120a9145586a236deabd'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `apply` in `domain/holdings/forward.ts` averages a buy at its bare price, so `holdings.cost_basis` leaves the fee out and every gain built on it is overstated. Sure counts an acquisition fee since `56140319d` (`effective_trade_price`: `price + fee / qty` for a buy, the bare price otherwise). Separately, `liveCostBasisLocks` finds each lock's last zero-quantity day by scanning every holdings row of the account, or of every account for the export.

**Approach:** carry `fee` on `HoldingTrade` and add it to the running total cost of a buy; recompute every investment account's holdings once at startup through a `settings` claim, as `seedDefaults` does; serve the lock read with a partial index on zero-quantity holdings.

## Boundaries & Constraints

**Always:**
- A buy's total cost is `quantity × price + fee`, the fee scaled from minor units of the account's currency to millionths² (`10^(12 - minorUnitsOf(currency))`, two decimals outside ISO 4217, as `marketValue`). The new average is one `divideHalfEven` of the summed total over the summed quantity: Sure's `CostBasisTracker` keeps `total_cost` exact, so the fee is not rounded into a per-unit price first. A first buy with no fee still gives exactly its price.
- A sale's fee never enters the average; a sale leaves it, a full sale clears it, as today.
- The one-time recompute claims `settings` key `fee_cost_basis_recomputed_at` and, in the same immediate transaction, calls `recomputeBalances` from the opening anchor date for each `investment` account. A failure rolls the claim back, so the next start tries again. A second start recomputes nothing.
- No balance moves: `amount` and cash do not read `cost_basis` (AD-22). A cost basis lock is untouched; readers still prefer it.
- The lock read filters `quantity = 0` as a literal in SQL, never a bound parameter, so SQLite can prove the partial index applies.
- AD-22 in `docs/architecture.md`: « the weighted average of the buys, fees out » becomes « the weighted average of the buys, each buy's fee in its cost, a sale's fee out », as Sure. `docs/sure-parity.md` « Investment » (line 62): the cost basis reads Parity, Story 27.5.

**Never:** no change to a trade's cash amount, `marketValue`, `conversionFee` or the lock rules; no realised gain net of a sale's fee (Sure does not deduct it yet); no SQL migration that rewrites `holdings`; no recompute on every start.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Buy with fee | 10 at 612.40 €, fee 2.50 € | `costBasis` 612_650_000 | none |
| Two buys with fees | 10 at 100 € fee 1 €, then 10 at 110 € fee 3 € | `(1000 + 1 + 1100 + 3) / 20` = 105.20 € → 105_200_000 | none |
| Sale with fee | then sell 5, fee 4 € | average unchanged, 105_200_000 | none |
| Zero-decimal currency | JPY buy 3 at 1000 ¥, fee 10 ¥ | 1003.333333 ¥ → 1_003_333_333 | none |
| Existing account, first start | stored cost bases fee-free | rewritten with fees; `balances` rows identical | claim rolled back on error |
| Second start | claim present | nothing recomputed | none |

</frozen-after-approval>

## Code Map

- `packages/api/src/domain/holdings/forward.ts:11-17,46-87` -- `HoldingTrade` gains `fee: MinorUnits`; `apply` adds the scaled fee to the buy's numerator; it needs the account `currency` already on the input (l.37). Comments at l.48 and l.60-65 drop « fees out ».
- `packages/api/src/domain/trades.ts:60-72` -- `marketValue`, `MICROS_SQUARED`: reuse the minor-unit scale; do not change.
- `packages/data/micros.ts:40-56` -- `divideHalfEven`: reuse.
- `packages/api/src/services/ledger/balances.ts:202-220` -- `recomputeHoldings` selects `fee: trades.fee`. `recomputeBalances` (l.285) and `openingAnchorOf` (l.425) are the recompute entry; read the anchor through the transaction.
- `packages/data/schema/trades.ts:37-38` -- `fee`, minor units of the account's currency, `>= 0`; read only.
- `packages/api/src/services/seed.ts` -- `seedDefaults`: the claim pattern to copy for the one-time recompute. Put the new function in `services/ledger/holdings.ts` beside the other holdings services.
- `packages/api/src/index.ts:110` -- call it after `seedDefaults`; log the count recomputed when above zero, no amounts.
- `packages/api/src/services/ledger/holdings.ts:117-158` -- `liveCostBasisLocks`: replace `eq(holdings.quantity, toMicros(0))` with a literal `sql` term.
- `packages/data/schema/holdings.ts:37-47` -- comment drops « fees out »; add `index("holdings_zero_quantity").on(accountId, securityId, date).where(sql\`quantity = 0\`)`. Then `pnpm data generate` writes `packages/data/drizzle/0066_*.sql`.
- `packages/api/src/services/history-volume.spec.ts:185-289,355-390,686` -- `seedInvestments` (trades already carry a 1 € fee), `statementsOf`, `planOf`, `only`; seed one `cost_basis_locks` row for the plan test.
- `packages/api/src/domain/holdings/forward.spec.ts:14-19,45` -- `trade()` helper gains `fee`; the l.45 test « its fee out of the cost basis » flips.
- `packages/api/src/services/ledger/holdings.spec.ts:52-63,119-137` -- `buy()` has a 2.50 € fee; expected cost basis becomes 612650000. Other specs reading cost basis (`services/holdings.spec.ts`, `domain/holdings/positions.spec.ts`, `services/export.spec.ts`, `services/ledger/export.spec.ts`, `routes/accounts.spec.ts`, `mcp/server.spec.ts`) follow where their trades carry a fee.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/holdings/forward.spec.ts` -- failing first: every row of the matrix but the two start rows.
- [x] `packages/api/src/domain/holdings/forward.ts` -- `HoldingTrade.fee`, `apply`, comments.
- [x] `packages/api/src/services/ledger/balances.ts` -- select `fee`.
- [x] `packages/api/src/services/ledger/holdings.spec.ts` -- failing first: the one-time recompute on an account whose stored cost basis is fee-free rewrites it, leaves every `balances` row equal, and a second call returns 0; fix the l.119 expectation.
- [x] `packages/api/src/services/ledger/holdings.ts` -- the one-time recompute; the literal zero-quantity filter.
- [x] `packages/api/src/index.ts` -- call it at startup.
- [x] `packages/data/schema/holdings.ts` -- partial index and comment; `pnpm data generate`.
- [x] `packages/api/src/services/history-volume.spec.ts` -- failing first: `liveCostBasisLocks(deps, peaId)` and `liveCostBasisLocks(deps, null)` plans search `holdings` through `holdings_zero_quantity`, never `SCAN holdings`.
- [x] `docs/architecture.md`, `docs/sure-parity.md` -- AD-22 and the « Investment » row.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` runs, then both Vitest projects pass.
- Given a fresh database, when the server starts, then the claim is taken and nothing fails for want of an investment account.

## Design Notes

The epic's criterion names Sure's effective price « rounded half to even » in millionths. Rounding `price + fee / qty` first and then averaging rounds twice; adding the fee to the numerator rounds once and matches Sure's exact `total_cost`. Results differ by at most one millionth per unit.

A settings claim, not a migration: the computation lives in TypeScript, and the claim is the repository's existing once-per-instance primitive (AD-12). A migration cannot replay trades.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean.
- `pnpm test` -- expected: both Vitest projects pass.

## Implementation Notes

- `liveCostBasisLocks` reads each lock's last zero-quantity day through a correlated subquery rather than a grouped one: for every account the grouped form still planned `SCAN holdings USING COVERING INDEX holdings_zero_quantity`, the correlated one seeks the partial index by `(account_id, security_id)` in both cases.
- `minorUnitsPerMajor` in `domain/trades.ts` now holds the minor-unit scale `marketValue` used, so `forwardHoldings` shares it; `MICROS_SQUARED` is exported for the fee scale.
- The migration is `packages/data/drizzle/0066_holdings_zero_quantity.sql`, renamed from drizzle-kit's generated name.
- The assistant's `average_cost` description in `mcp/holdings.ts` said « fees out »; it now says each buy's fee is in it.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| `fr.json` `costBasis.description` still says « frais exclus » | medium | Real: the position sheet shows it under the PRU field. | patch |
| Entrypoint call to `recomputeFeeCostBases` untested; fresh-database criterion untested | medium | Real: `index.spec.ts` starts the entrypoint but reads no `settings` row. | patch: entrypoint test |
| `apply` comment claims Sure's exact `total_cost` | low | Real: the total is rebuilt from the average rounded at each buy. | patch: comment |
| AD-12 names only `defaults_seeded_at` while the new claim cites it | low | Real. | patch: one sentence |
| AD-22 does not name the partial index or the literal zero | low | The schema and `liveCostBasisLocks` comments carry both; AD-22 states rules, not indexes. | rejected |
| `docs/deployment.md` « Upgrading » silent on the first-start recompute | low | One household's trades replay in well under a second per account; the PR description states the PRU change. | rejected |
| « No balance moves » overstated: the recompute extends rows to today | low | Existing rows are unchanged, as the test asserts; extending to today is what every write does. | rejected |
| No timing of the recompute on ten years of history | low | `seedInvestments` already runs the same full recompute on that volume. | rejected |
| Accounts without an opening anchor skipped | false | `createAccount` always inserts one; `accountWithOpeningDate` makes the same inner join. | rejected |
| Batch query repeats `accountWithOpeningDate`'s join | low | That helper reads one account and throws on a missing one. | rejected |
| `held = 0n` for a short position untested | low | Same result as before for a null cost basis; the ledger refuses a short sale. | rejected |
| No non-ISO currency fee test | low | `minorUnitsPerMajor` is `marketValue`'s scale, already tested. | rejected |
| Rollback test does not check holdings unchanged | low | A rolled-back transaction; the claim row stands for it. | rejected |
| Sprint status `in-progress` while the spec is `in-review` | false | Completion syncs both. | rejected |
| Parity row reads Different; table realigned | false | Other gaps remain in the row; `pnpm format` realigns the table. | rejected |
| Snapshot JSON left out of the reviewed diff | low | Generated by drizzle-kit; it holds `"where": "quantity = 0"`. | rejected |
| `securityIds[0] ?? ""` in the volume seed | low | The seed always creates 20 securities. | rejected |
