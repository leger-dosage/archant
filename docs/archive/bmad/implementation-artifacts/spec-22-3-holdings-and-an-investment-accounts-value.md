---
title: "Story 22.3: Holdings and an investment account's value"
type: 'feature'
created: '2026-10-04'
status: 'done'
baseline_commit: '211d722ba23f1ae25fbfdf5fbfd2a53e23817e52'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-22-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Since Story 22.2, a buy lowers an investment account's balance by its whole cost, since nothing values what it bought: net worth drops with every purchase and never follows the markets.

**Approach:** Derive one holding per account, security and day from the trades and `security_prices`, as Sure's `Holding::ForwardCalculator` and `CostBasisTracker`, inside the ledger's balance recompute, and store an investment account's balance as `cash + holdings value`, `balances.cash` the first term, as Sure's `Balance::ForwardCalculator`. A price import recomputes the accounts holding that security. Story 22.3 of `epics.md` is the acceptance contract; this spec adds what reading the code and Sure settled. The owner authorised every decision below; each is an assumption the pull request lists.

## Boundaries & Constraints

**Always:**
- `holdings (account_id, security_id, date, quantity, price, amount, cost_basis)`: primary key `(account_id, date, security_id)`; `account_id` and `security_id` `ON DELETE RESTRICT`; `quantity` and `price` millionths, `amount` minor units of the account's currency, `cost_basis` millionths per unit or null; checks `quantity >= 0`, `price >= 0`, `amount >= 0`. Written by `services/ledger/` only (AD-2, oxlint list); `deleteAccount` deletes them before the account.
- `balances.cash`, not null, for every account: `balance = cash + holdings value`, so an account without holdings, every non-investment and every bank-linked one included, has `cash = balance`. The migration fills `cash` from `balance`; no released database holds a trade (22.2 is unreleased), so nothing is recomputed there.
- `domain/holdings/forward.ts` (pure): from the account's trades in recording order and stored prices, one holding per security and day from that security's first trade to the last balance day, zero-quantity days after a full sale included, as Sure writes them. A day's price is the `security_prices` row of that day (provider or typed), else that day's last trade price, else the previous day's, carried. `amount` = `quantity × price` in `BigInt`, half to even to the minor unit. `cost_basis`: weighted average of buys, fees out, rounded half to even to millionths at each buy; a sale leaves it; null at zero quantity, so a rebuy starts over (Sure's `reset`).
- Incremental: `recomputeBalances` computes holdings from its own `from`; the state before it comes from replaying every trade of the account dated before `from` and, per security, the last stored price before `from` (a later trade price wins, a same-day stored price wins over a trade). Holdings rows from `from`, and past the last balance day, are rewritten; earlier ones are untouched. Only `investment` accounts compute holdings.
- Balances (Sure's `base_calculator.rb`): a day without valuation has `cash = previous cash + movements`, a valuation day `cash = valuation − holdings value`; `balance = cash + holdings value`. `forwardBalances` takes `previousCash` instead of `previous` and a per-day holdings value; the backward path writes `cash = balance`.
- Price import: `services/ledger/holdings.ts` exports `revalueHoldings(tx, securityId, from, timeZone, { origin })`, which recomputes each account holding a trade in that security from `max(from, its first trade there)`. `priceSecurity` in `services/prices.ts` calls it inside its immediate transaction, from the earliest row it wrote, so prices and the values derived from them commit together. Story 22.4's « Saisir un cours » calls the same function.
- Snapshot gap: `computed` = the previous day's `cash` + the day's movements + the day's holdings value.
- Export, as Sure's `data_exporter.rb`: `Holding` lines after `Trade` lines and before `Valuation` lines, read a page at a time along the primary key, dated from `sureFrom` on, with `account_id`, `security_id`, `ticker` (`sureTicker`), `security_name`, `exchange_operating_mic`, `date`, `qty`, `price`, `amount` (positive), `currency` (the account's), `cost_basis` (or null), `cost_basis_source` (`calculated`, null when `cost_basis` is), `cost_basis_locked: false`, `security_locked: false`, and `archant: { isin }`; no `id`, a derived row having none. `Balance` lines gain `cash_balance`. `holdings` and `balances.cash` join `EXPORTED_COLUMNS`.
- Every reader of balances keeps `balanceOn` or `balancesBetween`; net worth, the balance sheet, the accounts list, goals and the export's balances then include holdings with no change.

**Never:** no holdings interface, no cost basis set by hand or locked, no typed price form (22.4); no dividend or interest (22.5); no backward holdings, no currency conversion; no full-history recompute after a price import or a write.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Buy, no stored price | opening 25 000, buy 10 at 612.40, fee 2.50, on d | holding 10 × 612.40 = 6 124.00, cost basis 612.40; cash 18 873.50; balance 24 997.50 |
| Provider price | 650 stored on d+1 | holding 6 500.00; balance 25 373.50 |
| Gap | nothing stored on d+2 | 650 carried |
| Same day | stored 640 and a trade at 612.40 on d | 640 |
| Average | buy 10 at 100, then 30 at 200 | cost basis 175 |
| Sale | hold 10 at 612.40, sell 4 at 650 | quantity 6, cost basis 612.40 |
| Sold out, rebought | sell all, then buy 5 at 700 | zero rows with cost basis null, then 700 |
| Snapshot | 30 000 on a day holdings are worth 6 500 | balance 30 000, cash 23 500 |
| No trade | PEA with snapshots only | cash = balance, no holding row, balances unchanged |
| Price import | provider rows from d for a held security | its holders recomputed from `max(d, first trade)`; other accounts untouched |

</frozen-after-approval>

## Code Map

- `packages/data/schema/balances.ts` (add `cash`), new `schema/holdings.ts`, `types.ts` (`Holding`, `NewHolding`), `package.json` `exports`; `pnpm data generate --name add_holdings` (`0051`), checked by hand: SQLite cannot add a not-null column without a default, so rebuild or fill `cash` from `balance`; `data/migrate.spec.ts` tests it on existing rows, as `0050`.
- `.oxlintrc.json` -- every block naming `@archant/data/schema/trades` gains `@archant/data/schema/holdings` with the same message shape.
- `packages/api/src/domain/balances/forward.ts`, `forward.spec.ts` -- `previousCash`, holdings values, `cash` out; `micros.ts` `divideHalfEven`; `domain/trades.ts` `tradeAmount` for the rounding pattern.
- `packages/api/src/services/ledger/balances.ts:167` `recomputeBalances`, `:36` `lastBalanceOnOrBefore` (read `cash`), `:101` `recomputeBackward` (`cash = balance`); `ledger/trades.ts` (trade reads, `tradedSecurities`); `ledger/accounts.ts:153` `deleteAccount`; `ledger/snapshots.ts:243` `gapReader`, `domain/balances/snapshot.ts` `snapshotGap`.
- `packages/api/src/services/prices.ts` `priceSecurity` transaction -- call `revalueHoldings`; `services/prices.spec.ts`, `testing/prices.ts` `insertSecurity`/`holdSecurity`, `testing/yahoo.ts`.
- `services/ledger/trades.spec.ts:147`, `:571` and every balance expectation that assumed cash only; `testing/ledger.ts:111` `history`.
- `services/ledger/export.ts:34` `EXPORTED_COLUMNS`, `:338` `balancePages` (keyset pattern for a `holdingPages`), `:519` `exportedTrades`; `services/export.ts:488` `sureTicker`, `:647` `Balance` lines, `:823` `Trade` lines, `decimal`, `formatMicros`; `export.spec.ts`, `services/export.spec.ts`, `testing/sure-preflight.ts`.
- `services/reports.spec.ts` (net worth with a holding), `services/goals.ts`, `services/accounts.ts:74` -- readers, unchanged.
- `services/history-volume.spec.ts` -- seed an investment account with twenty securities, monthly trades and ten years of daily prices to today, direct inserts as the seed does, then one ledger recompute; time `revalueHoldings` for the twenty after a day's prices, from today − 7 as the daily run starts, under `1000 * MARGIN`; the export test keeps its limit with the `Holding` lines.
- `packages/app/e2e/trades.spec.ts:33`, `:127`, `viewer.spec.ts:118` -- balances now `cash + holdings value`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/holdings/forward.spec.ts`, `forward.ts` -- the matrix's holding rows, every branch.
- [x] `packages/api/src/domain/balances/forward.spec.ts`, `forward.ts`, `snapshot.ts` -- cash and valuation rows.
- [x] `packages/data` schema, types, exports, migration, `migrate.spec.ts`; `.oxlintrc.json`.
- [x] `services/ledger/holdings.spec.ts`, `holdings.ts`, `balances.ts`, `accounts.ts`, `snapshots.ts`; fix `trades.spec.ts` and other ledger specs to the new balances.
- [x] `services/prices.ts`, `prices.spec.ts` -- a fetch revalues its holders.
- [x] `services/ledger/export.ts`, `services/export.ts`, specs -- `Holding` lines, `cash_balance`.
- [x] `services/reports.spec.ts` -- net worth includes holdings.
- [x] `services/history-volume.spec.ts` -- NFR10 timing.
- [x] `packages/app/e2e/trades.spec.ts`, `viewer.spec.ts` -- expected balances.
- [x] `docs/architecture.md` AD-2 table list, AD-8, AD-22, AD-23; `docs/sure-parity.md`.

**Acceptance Criteria:**
- Given Story 22.3 of `epics.md`, when the story ships, then each of its criteria holds, with the revisions this spec records.
- Given a PEA with a buy and a provider price that rose, when net worth is read, then it counts the holding at that price.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green, `domain/**` and `services/ledger/**` at 100%, the volume project timing the recompute
- `pnpm test:e2e` -- expected: green

## Implementation Notes

- `recomputeHoldings` lives in `services/ledger/balances.ts`, beside `recomputeBalances` that calls it; `services/ledger/holdings.ts` holds `revalueHoldings` alone, since the two files importing each other is an `import/no-cycle` error.
- A bank-linked account's backward recompute deletes its holdings and writes `cash = balance`. No investment account can be linked today (`isLinkCandidate`, `LINKABLE_TYPES`), so this only keeps `balance = cash + holdings value` true at the ledger's level.
- `domain/trades.ts` exports `marketValue`, the rounded `quantity × price` that `tradeAmount` and the holdings share.
- The edit test of `e2e/trades.spec.ts` now changes the fee too: with a trade priced as its own holding, the balance moves by the fee only. `viewer.spec.ts` needed no change: it asserts no balance of its PEA.
- Prices written by a fetch are revalued from the first row written, which `fillPrices` returns oldest first.
- A day's trades apply in recording order, so a sale recorded before the buy that covers it empties the position and resets the cost basis, as Sure's `CostBasisTracker` resets when a sale relieves all it tracks.
- The migration fills `cash` from `balance` and recomputes nothing: `origin/main` holds no trade, and Story 22.2's pull request asks not to release it without this story. A database that recorded trades under 22.2 alone keeps cash-only balances before its next write's first day.

## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| blind | `revalueHoldings` recomputes a bank-linked holder backward, whole, on every price import | false | No investment account can be linked: `isLinkCandidate` (`LINKABLE_TYPES`) refuses it in `services/bank-connections.ts:658`, and no bank type maps to one | rejected |
| blind, edge | The migration recomputes no stored trade, and the real instance runs `main` | low | `origin/main` is at #118 and holds no trade; 22.2's pull request asks not to release it without 22.3 | rejected; noted in Implementation Notes and the pull request |
| blind, edge, standards | `tradeAmount`'s comment names `valueOf`, which does not exist | low | The extracted function is `marketValue` | patched |
| blind | `sure-parity.md` and `project-overview.md` still describe investment accounts as snapshots only, and « Forward and backward computation » as « Same » | low | Investment row, line 77, overview line 17 | patched |
| blind | « Full data export » row omits `Holding` lines | false | The row lists files, not `all.ndjson`'s line types; `Trade` lines are not listed either | rejected |
| blind, edge | Unlinking an investment account would change its history; doc promises it does not | false | No investment account is ever linked | rejected |
| blind | No query-plan assertion for the new queries | low | `trades_security`, the `security_prices` primary key and `entries_account_date` serve them; the volume project times the path | rejected |
| blind, spec | The volume timing writes no price, and the `Holding` line count is loose | medium | It timed a recompute with no day's prices written | patched: each run upserts the day's price first and the result is checked; exact count |
| blind | Revalue once per account and run rather than per security | low | Twenty securities revalue in about 200 ms, under the one-second target | rejected |
| blind | « written by the balance recompute only » while `deleteAccount` deletes holdings; « a day after a full sale » reads as one day | low | AD-22, `schema/holdings.ts`, `domain/holdings/forward.ts` | patched |
| blind | `sprint-status.yaml` says `in-progress` while the spec says `in-review` | false | Workflow state; both reach `done` at finalisation | rejected |
| blind, standards | `revalueHoldings` ignores its `origin` | false | Every ledger function takes it, `recordTrade` ignores it as well (AD-2) | rejected |
| blind, edge | A holding's value has no `MAX_MINOR_UNITS` bound | low | `MAX_MINOR_UNITS` is 10^13 minor units; a holding past it needs an absurd price, and `toMinorUnits` then throws, rolling the write back | rejected |
| blind | No test for a sold-out holder revalued, nor for rows past the last day | low | The holders query has no quantity filter; « deletes the rows past the last balance day » covers the second | rejected |
| blind | `const [earliest] = rows` assumes ascending rows | false | `fillPrices` builds rows from `window.start` day by day | rejected |
| blind, standards | `balances.balance` is not typed `MinorUnits` where `cash` is | low | Money columns are already mixed (`entries.amount` bare, `trades.fee` typed) | rejected |
| blind | The intraday comment of the holdings spec misleads | low | The cost basis follows recording order | patched |
| edge, spec | A same-day sale recorded before its covering buy resets the cost basis | low | Sure's `CostBasisTracker` resets when a sale relieves all it tracks, in trade order; recorded in Implementation Notes | rejected |
| edge, spec | `viewer.spec.ts` is ticked but unchanged | low | It asserts no balance of its PEA | rejected; noted in Implementation Notes |
| verification-gap | No test of a snapshot's gap when the day before holds securities | medium | Reading `known.balance` instead of `known.cash` failed nothing | patched: test |
| verification-gap | No service test reads the last stored price before `from` | medium | Every test had a price stored on `from` itself | patched: test |
| verification-gap | No `Holding` line at quantity zero is checked for null cost basis and source | low | The export household sells nothing in full | deferred |
| standards | `sumByDay` takes and returns a bare `number` for money, with a mechanism comment | low | AGENTS.md: a bare `number` meaning money is a bug | patched |
| standards | `apply` and `applyTo` read alike | low | Judgement call; each has a docstring | rejected |
| standards | `snapshotGap` repeats the day formula of `forwardBalances` | low | Pre-existing, its comment says so | rejected |
| standards | `account.type === "investment"` tested twice | low | One check per module, each reading its own account row | rejected |
| standards | `reports.spec.ts` revalues in a transaction without `behavior: "immediate"` | low | AD-2 asks it of every ledger write | patched |
