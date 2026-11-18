---
title: 'Story 22.4: See my holdings'
type: 'feature'
created: '2026-10-04'
status: 'done'
baseline_commit: '3f12f360ab65bede84e4df64b0344ffbd018cc54'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-22-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Since Story 22.3, an investment account's balance counts what it holds, but nothing shows the positions, their average cost or their gain, a security with no provider can only be priced by a trade, and an assistant cannot read them.

**Approach:** One read service, `listPositions` in `services/holdings.ts`, serves a « Positions » tab, as Sure's holdings table, and the read tool `get_holdings`. A sheet per position, as Sure's holding drawer, shows its price, its trades, « Saisir un cours » for a security priced by hand, and a cost basis the owner sets and locks. Story 22.4 of `epics.md` is the acceptance contract; this spec adds what reading the code and Sure settled. The owner authorised every decision below; each is an assumption the pull request lists.

## Boundaries & Constraints

**Always:**
- Positions are read for today in `APP_TIMEZONE`: each security's holding on the account's last `holdings` day on or before today, quantity above zero, by value then name, and the cash of the last `balances` row on or before today. `total = cash + Σ amount`, the account's balance. An account with no holding answers `date: null`, no position and its balance as cash; any account answers, so the tool and the roles walk need no special case.
- Per position (`domain/holdings/positions.ts`, pure): `weight = amount / total` and the cash's likewise, null when `total ≤ 0`; book value = `marketValue(quantity, costBasis)`; gain = `amount − book value`; gain percent = gain / book value, null when the cost basis is null or the book value zero. Percents are millionths of a percent (`Micros`), half to even, and leave as decimal strings.
- `priceDate` = the later of the security's last `security_prices` day and its last trade day on this account, both on or before the holdings day: the day the price shown was set.
- The locked cost basis lives in `cost_basis_locks (account_id, security_id, cost_basis, locked_at)`, primary key `(account_id, security_id)`, `account_id` cascade, `security_id` restrict, `cost_basis >= 0` millionths per unit. Holdings stay derived and keep the calculated cost basis; every reader (positions, `Holding` lines) takes the lock's value instead on a day with quantity above zero, as Sure's `cost_basis_source` priority manual > calculated, without a recompute, since a cost basis moves no balance. Setting locks it, as Sure's `set_manual_cost_basis!`; unlocking deletes the row, so the calculated one returns, as Sure's next sync replaces an unlocked manual one.
- `PUT /api/accounts/:id/holdings/:securityId/cost-basis` `{ costBasis }` (per unit, typed the French or English way, `readMicros`, `>= 0`, else `invalid_price` on `costBasis`), `DELETE` the same path to unlock; both answer the position. A security the account does not hold today answers `NOT_FOUND`; a non-investment account `NOT_AN_INVESTMENT_ACCOUNT`.
- « Saisir un cours »: `POST /api/securities/:id/prices` `{ date, price }`, for a security with no provider or `offline`, else `409 PRICE_FROM_PROVIDER`. The date is not after today (`date_in_future`), the price above zero (`invalid_price`). One immediate transaction upserts the `manual`, non-provisional row in the security's currency and calls `revalueHoldings(tx, id, date, timeZone, { origin: "user" })`, as `priceSecurity` does. A second price on the same day replaces the first.
- `GET /api/accounts/:id/trades` takes an optional `securityId`, for the sheet's trades.
- `get_holdings` (`archant:read`, `READ_ONLY`) takes `{ accountId }` and calls `listPositions`; quantities, prices, amounts and percents are decimal strings with the account's currency (AD-19).
- Writes are hidden from a viewer and refused by `viewerReadOnly`; the tab and the sheet's figures are theirs to read.
- Export: `prices.ndjson`, beside `all.ndjson` and after `goals.ndjson`, holds one `SecurityPrice` line per typed price, naming its security as a `Trade` line does (`security_id`, `ticker` from `sureTicker`, `security_name`, `exchange_operating_mic`, `archant: { isin }`) with `date`, `price`, `currency`, `source: "manual"`. `security_prices` moves to `EXPORTED_COLUMNS` with `provisional` left out; `cost_basis_locks` joins it with `lockedAt` left out. A `Holding` line on a locked day writes the lock's value, `cost_basis_source: "manual"` and `cost_basis_locked: true`.

**Never:** no dividend, interest or conversion (22.5); no deletion of a typed price, no holding deletion or security remapping (Sure's drawer has them; out of this story); no typed price for a security its provider prices; no chart of a position; no recompute on a lock or an unlock.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Two lines | cash 4 000, A worth 6 000 at cost basis 50 × 100, B worth 0 | A weight 60 %, gain 1 000 (+20 %); B weight 0; cash 40 % |
| Sold out | a security sold in full | not listed; its trades remain in « Ordres » |
| No cost basis | cost basis 0 | gain = amount, percent null |
| Non-positive total | cash −7 000, holdings 6 000 | every weight null |
| Lock | lock 40 on A | cost basis 40, locked; holdings rows unchanged; export line manual, locked |
| Unlock | after the lock | calculated cost basis back |
| Typed price | offline fund, price 105 typed today | its row `manual`; its holders' value and balance follow at once |
| Provider security | typed price on a Yahoo security not offline | `409 PRICE_FROM_PROVIDER`, nothing written |
| Never traded | PEA with snapshots only | `date: null`, cash = balance; no « Positions » tab |

</frozen-after-approval>

## Code Map

- `packages/data/schema/holdings.ts` -- add `costBasisLocks` here, so the oxlint fence on `schema/holdings` keeps its reads in `services/ledger/`; `types.ts`; migration `0052` via `pnpm data generate --name add_cost_basis_locks`; `data/migrate.spec.ts` if it pins tables.
- `packages/api/src/domain/trades.ts` `marketValue`; `packages/data/micros.ts` `divideHalfEven`, `formatMicros`, `readMicros` -- reuse.
- `packages/api/src/services/ledger/holdings.ts` -- beside `revalueHoldings`: `currentHoldings(deps, accountId, day)` (rows with security, lock and `priceDate`, plus cash) and `lockCostBasis` / `unlockCostBasis` writes (immediate transaction, `origin`, no recompute).
- `packages/api/src/services/ledger/balances.ts:36` `lastBalanceOnOrBefore` -- reads `cash`.
- `packages/api/src/services/trades.ts` `investmentCurrency`, `listAccountTrades`; `ledger/trades.ts:456` `listTrades` -- `securityId` filter; `schemas/trades.ts` query schema extending `pageQuerySchema` (`schemas/transactions.ts:221`).
- `packages/api/src/services/prices.ts:226` `priceSecurity` -- the transaction shape for `typePrice`; `routes/securities.ts` gains the `POST`; `schemas/prices.ts` its body.
- `packages/api/src/routes/accounts.ts` -- `GET /:id/holdings`, cost-basis `PUT`/`DELETE`; `lib/errors.ts` `PRICE_FROM_PROVIDER` 409.
- `packages/api/src/mcp/holdings.ts` (new, pattern `mcp/recurring.ts`), `mcp/server.ts:70` `TOOLS`, `schemas/assistants.ts`, `mcp/server.spec.ts:58` `READ_TOOLS`, `app/e2e/assistants.spec.ts:22`.
- `packages/api/src/routes/middleware/roles.spec.ts:158` writes list, `:255` viewer reads.
- `packages/api/src/services/ledger/export.ts:132` `EXPORTED_COLUMNS`, `:290` `LEFT_OUT`, `:371` `holdingPages` (left join the lock); `services/export.ts:855` `Holding` lines, `:1029` `goalsNdjson` and `:1115` `partsOf` for `prices.ndjson`; `services/export.spec.ts:35`, `routes/export.spec.ts:38` file lists.
- App: `routes/_authed.accounts.$accountId.tsx:57` `ACCOUNT_TABS`, `:369` tab fallback, `:493` tabs; new `components/PositionList.tsx` (pattern `TradeList.tsx`), `components/PositionSheet.tsx` (frame and `Figure` of `BudgetCategorySheet.tsx`, fields of `TradeDialog.tsx`), `hooks/useHoldings.ts`, `lib/query-keys.ts` `accounts.holdings(id)` under `detail(id)`; `lib/trade-format.ts`, `lib/balance-change.ts` `formatSignedPercent`, `formatSignedMoney`; `locales/fr.json` `accountDetail.tabs.positions`, `positions.*`, `errors.PRICE_FROM_PROVIDER`.
- e2e: `packages/app/e2e/fixtures.ts:183` `openAccount`, `:260` `recordTrade`; new `e2e/positions.spec.ts`; `viewer.spec.ts:172`.
- Docs: `docs/architecture.md` AD-21 (writes), AD-22 (lock, typed price), AD-23 (`prices.ndjson`, lock in `Holding` lines); `docs/deployment.md:319` tool list; `docs/sure-parity.md`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/holdings/positions.spec.ts`, `positions.ts` -- the matrix's weight, gain and percent rows, every branch.
- [x] `packages/data` schema, types, migration -- `cost_basis_locks`.
- [x] `services/ledger/holdings.spec.ts`, `ledger/holdings.ts`; `services/holdings.spec.ts`, `services/holdings.ts` -- positions read, lock, unlock, refusals.
- [x] `services/prices.spec.ts`, `services/prices.ts` `typePrice` -- revalues in its transaction, refusals.
- [x] `ledger/trades.ts`, `services/trades.ts`, `schemas/trades.ts` -- `securityId` filter.
- [x] Routes, `lib/errors.ts`, route specs, `roles.spec.ts`.
- [x] `mcp/holdings.ts`, `server.ts`, `server.spec.ts` -- `get_holdings` matches the route.
- [x] Export: ledger and service, specs, `prices.ndjson`, locked `Holding` lines, and a full sale in the export household (deferred from 22.3: a `Holding` line at quantity zero writes `cost_basis` and its source null).
- [x] App: hook, query key, `PositionList`, `PositionSheet`, tab, locales.
- [x] `e2e/positions.spec.ts`, `viewer.spec.ts`, `assistants.spec.ts`.
- [x] Docs.

**Acceptance Criteria:**
- Given Story 22.4 of `epics.md`, when the story ships, then each of its criteria holds, with the revisions this spec records.
- Given a locked cost basis, when a trade or a price recomputes the account, then the position still shows the locked value.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green, `domain/**` and `services/ledger/**` at 100%
- `until mkdir /tmp/archant-e2e.lock 2>/dev/null; do sleep 10; done; pnpm test:e2e; rmdir /tmp/archant-e2e.lock` -- expected: green; port 8788 is shared with other worktrees, so never run it without the lock, and never leave a server running

## Implementation Notes

- `costBasisLocks` sits in `schema/holdings.ts`, under the oxlint fence of `holdings`: `lockCostBasis`, `unlockCostBasis` and `currentHoldings` live in `services/ledger/holdings.ts`, `listPositions`, `setCostBasis` and `unlockCostBasis` in `services/holdings.ts`. A lock moves no balance, so neither write recomputes; both refuse a security the account does not hold today, an unlock of what is not locked succeeding.
- A lock stands on the position held the day it was set: `cost_basis_locks.locked_on`, and `liveCostBasisLocks` reads a lock only while no day at quantity zero falls on or after it, so a full sale ends it and a rebuy is priced from its own buys, as Sure's tracker starts over. Read, not purged: a first version deleted locks in `recomputeHoldings`, which a recompute starting past its end (a future-dated transaction deleted) turned into deleting every lock of the account. A `Holding` line takes the lock on the days after the position's last day at zero. The frozen rule names only the unlock; this adds the full sale.
- A cost basis whose book value passes `MAX_MINOR_UNITS` is refused on `costBasis` with `too_big`, and `positionFigures` gives no book value, gain or percentage past it, nor a percentage past a safe integer, so a later buy never turns the positions into a 500.
- `priceDate` is computed in the positions query by two correlated subqueries, one statement whatever the number of positions.
- Without a cost basis, the book value and the gain are null too, not only the percentage.
- « Positions » sits before « Ordres », shows once the account has a holdings day, and is read only for an investment account; a link to it on another account, or before a first trade, opens « Opérations ».
- The gain renders with `Money plusSign`, uncoloured: DESIGN.md never colours a trend's amount.
- The typed price form carries its own `invalid_price` message: the shared one says « zero or more », true of a trade's price, not of a stored one, which is above zero.
- `listTrades` counts through `trades` joined to `entries`, so the `securityId` filter applies to the total too.

## Spec Change Log

- Review, iteration 0. Finding: a lock left after a full sale came back on a rebuy, and the purge added against it wiped every lock when a recompute started past its end; the export also stamped a later lock on an earlier, closed position. Amended (Implementation Notes, outside the frozen block): a lock is scoped to the position it was set on, read through `locked_on` instead of purged. Known-bad state avoided: a lock silently lost after an unrelated write, or written on days it never covered. KEEP: holdings stay derived with the calculated cost basis; no recompute on a lock or an unlock.
- Owner rule of 2026-10-07, settled for the field names: every assistant tool names its input and output fields in snake case, Sure's names where Sure's function has the field, the snake case of Archant's own otherwise, so the server uses one style throughout; a refusal names the tool's field. The HTTP API keeps camel case. KEEP: amounts as decimal strings (money). Here: `get_holdings` takes `account_id` and answers Sure's `holdings`, each with Sure's `average_cost` for the « PRU », `average_cost_locked`, `book_value`, `gain_percent`, `price_date`, `exchange_mic`, then `cash_weight`.
- Owner rule of 2026-10-08, the missing functions: `get_holdings` reads every active investment account through `listHoldings`, which calls `listPositions` for each, as Sure's function reads its investment accounts; see Spec 16.3's change log.

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| edge, verification | The lock purge in `recomputeHoldings` deletes every lock when `from > until` | high | `notInArray(col, [])` is `true` in drizzle 0.45; deleting a future-dated transaction recomputes from past `until` | patched: purge removed, lock scoped by `locked_on` at read |
| blind, edge, spec, verification | A lock set after a rebuy is exported on the closed position's days | medium | `holdingPages` joined the lock on account and security only | patched: `Holding` lines take it after the position's last zero day; test |
| blind, spec | The purge tests quantity at `until`, a future day | false | A trade is never dated after today (`date_in_future`), so the quantity at `until` is today's; the purge is gone anyway | rejected |
| edge | A backdated full sale between buys leaves the lock | low | Read rule: a zero day before `locked_on` keeps the lock on the position held that day, as the owner set it | rejected |
| blind, edge | A huge cost basis makes `toMinorUnits` throw, every positions read a 500 | medium | `marketValue` up to 10^15 minor units with no bound | patched: `too_big` refusal, figures null past `MAX_MINOR_UNITS`, percentages null past a safe integer; tests |
| blind, edge | `typePrice` checks the provider outside its transaction | low | A fetch clearing `offline` between read and write lets a typed price through | patched: read in the immediate transaction |
| edge | A security in another currency than its holder | false | A trade in another currency than its account's is refused (AD-6), so every holder shares the security's currency | rejected |
| edge, spec, blind | `?tab=positions` while loading or failing shows a blank panel | medium | The tab rendered only once `date` was known | patched: the tab shows while pending or failed when asked for |
| edge | `writable` undefined hides the sheet | false | An account's currency is always an ISO 4217 code, checked at creation | rejected |
| blind, edge, standards | The form's day is the browser's, the server's `APP_TIMEZONE`'s | low | Same as the trade and snapshot forms; the server refuses a future day either way | rejected |
| blind, edge | A fully sold account shows the empty note and the cash row | false | Deliberate: the note says nothing is held, the cash row still lists the cash, as Sure's table shows its cash | rejected |
| blind, spec | The sheet lists the first 50 trades without saying so | low | `usePositionTrades` took the default page | patched: 200, and a note counting the older ones |
| blind, standards | `priceDateOf` runs two queries per position | low | N+1 on a household's few positions | patched: correlated subqueries in the positions query |
| blind | `origin` unused in the lock writes | false | AD-2 asks every ledger write for one; `recordTrade` ignores it too | rejected |
| blind | `sprint-status.yaml` says `in-progress` while the spec is in review | false | Workflow state; both reach `done` at finalisation | rejected |
| blind | `deployment.md` export section misses `prices.ndjson` | low | Its file list stopped at `goals.ndjson` | patched |
| blind | `security-model.md` misses positions and security names | low | AGENTS.md: it changes with the code it describes | patched |
| blind | `data.holds` in `fr.json` omits typed prices | low | It already omits trades and goals; the settings page's list is not a file inventory | rejected |
| standards | AD-2's ledger table list lacks `cost_basis_locks` | low | Only `services/ledger/` writes it | patched |
| standards | `setCostBasis` checks the account type twice, and the « not held » message is written twice | low | `investmentCurrency` beside `heldToday` | patched: ledger check alone, `notHeld` shared |
| blind, standards | `formatShare` duplicates `formatSignedPercent` | low | One is unsigned with one decimal for a weight, the other signed for a change; merging adds an option for two callers | rejected |
| standards | `invalid_price` covers two bounds, hence a sheet-only message | low | The shared message says « zero or more », right for a trade's price and a cost basis; `not_positive` speaks of an amount | rejected |
| standards | `percentOf` returns `Micros` for percents | low | `Micros` is the millionths scale, documented on the function | rejected |
| standards | `exportedTypedPrices` reads its table whole | low | Typed prices are a handful a month; `exportedGoals` and `exportedRecurring` read whole too | rejected |
| spec | Lock deletion on a full sale is scope creep | low | Recorded in Implementation Notes and the pull request as an assumption | rejected |
| verification | No test of a trade later than the last stored price for `priceDate` | medium | Every case had no price or a later one | patched: test |
| verification | No test of a zero day with a lock in the export | medium | Removing `quantity > 0` failed nothing | patched: full sale, rebuy and lock in the export household |
| verification | No end-to-end test shows « Saisir un cours » for an offline provider security | low | The suite keeps fetching off, so no fixture sets `offline`; the API side is tested | deferred |
