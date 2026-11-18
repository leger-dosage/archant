---
title: 'Story 28.6: Sell more than is held'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_commit: 'b7af2af8b754a15e9c245569c247870ed14d0a60'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-28-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A sale above the quantity held on its date, or an edit, deletion or import revert that leaves a later sale short, is refused with `QUANTITY_UNAVAILABLE`; Sure (`00dd977fb`) saves it, lets `Holding::ForwardCalculator` take the quantity below zero, and has `Holding::CostBasisTracker#sell` relieve only what it holds.

**Approach:** Delete the refusal everywhere, compute holdings with Sure's tracker semantics, list a position below zero as Sure's `Account#current_holdings` and `get_holdings` do, and end a cost basis lock when a position crosses zero, not only when it lands on it.

## Boundaries & Constraints

**Always:**
- The cost basis mirrors Sure's tracker exactly, kept apart from the position's quantity: a buy adds `quantity × price + fee` to what the tracker holds and moves the average (rounded half to even to the millionth, as today); a sale relieves `min(|sold|, tracker quantity)` at the average, the average unchanged, and does nothing when the tracker holds nothing; the tracker at zero clears the cost basis to `null`, so the next buy starts over. A day's `costBasis` is the tracker's average, whatever the position's sign. Long-only histories give the same rows as today.
- Every quantity reader that meant « held » keeps Sure's `qty <> 0`: `listPositions` and `lastHeldHoldings` take a row whose quantity is not zero; ordering stays by value descending, so a negative position sorts last. Weight, value, book value and gain come from the existing formulas with the negative sign; `positionFigures` is unchanged.
- A cost basis lock ends on the first day at quantity zero **or below** on or after `locked_on`, and `after` is the last such day; the partial index follows (migration `0076`, `pnpm data generate`, index renamed `holdings_not_held`, `WHERE quantity <= 0`, the literal written in the query so SQLite proves it applies).
- Locking a cost basis still needs a quantity above zero today (`heldToday`), as Sure's `HoldingsController#update` checks `qty.positive?`; the sheet keeps showing the form, as Sure's drawer does.
- AD-22 in `docs/architecture.md` and the Investment row of `docs/sure-parity.md` change with the code.

**Never:** no warning, badge or confirmation for a short position (Sure has none); no change to `not_held` for an income, which checks a buy on or before its date; no change to the export's Holding lines beyond the lock's end; no deletion or remap of a position (Story 28.7).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Oversell | 10 held on D, sell 15 on D | 201; holding −5 on D, cost basis `null` | none |
| Edit a buy down | buy 10 then sell 8; buy edited to 5 | 200; holding −3 after the sale | none |
| Delete the buy | buy 10 then sell 8; buy deleted | 204; holding −8 | none |
| Delete or revert a converted buy | transaction converted into the buy, then deleted or its import reverted | succeeds; the later sale leaves the position short | none |
| Rebuy after short | −5, then buy 8 at P | holding 3, cost basis P | none |
| Partial cover | −5, then buy 3 at P | holding −2, cost basis P (tracker holds 3), as Sure | none |
| Lock crossed | lock at 10 units, sell 15, buy 8 | lock ended on the sale's day; the 3 read the calculated P | none |
| Lock on short | `PUT` cost basis while holding −5 | nothing written | 404 `NOT_FOUND`, as today for nothing held |
| Positions | holding −5 today | listed with −5, its negative value and weight; cash below | none |
| `get_holdings` | last non-zero row is −5 | returned at −5 | none |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/ledger/shared.ts:154-235` -- `refuseShortfall`, `refuseShortfalls`, `TradedPosition`: delete; `deleteSplitChildren` returns `void` and drops its `traded` query; `deleteTransactionRows:247` calls it plainly.
- `packages/api/src/domain/trades.ts:115-141` -- `firstShortfall`: delete with its tests in `domain/trades.spec.ts`.
- `packages/api/src/services/ledger/trades.ts:403,530,575,675` -- record, edit, delete, convert: drop each `refuseShortfall` call and the import.
- `packages/api/src/services/ledger/edits.ts:466-473`, `import-revert.ts:157-164` -- drop `moved` and `refuseShortfalls`; keep `deleteSplitChildren` per chunk.
- `packages/api/src/lib/errors.ts:127-133` -- remove `QUANTITY_UNAVAILABLE`; `errors.spec.ts:29` its assertion.
- `packages/api/src/domain/holdings/forward.ts:58-117` -- `Position` gains the tracker's quantity; `apply` follows Sure's `buy`/`sell`; docs of `DailyHolding.costBasis` and `forwardHoldings` updated.
- `packages/api/src/services/ledger/holdings.ts:165-185` `lockEndedOn`, `:196-212` `liveCostBasisLocks`' `lastZero` -- `quantity <= 0`; `:302` `currentHoldings` (read by `listPositions` in `services/holdings.ts`) and `:369` `lastHeldHoldings` -- `ne` instead of `gt`; `:455` `heldToday` unchanged.
- `packages/data/schema/holdings.ts:50-52` -- index `holdings_not_held` `where quantity <= 0`; `packages/data/drizzle/0076_holdings_not_held.sql` generated, journal tag renamed; `packages/api/src/services/history-volume.spec.ts:793` plan regex.
- `packages/app/src/components/TradeDialog.tsx:159-164`, `ConvertTradeDialog.tsx:150-154` -- drop the `QUANTITY_UNAVAILABLE` branch.
- `packages/app/src/locales/fr.json:2500,2517` -- remove `errors.fields.quantity_unavailable` and `errors.QUANTITY_UNAVAILABLE`.
- `docs/architecture.md:219` AD-22 -- replace the « No write may leave… » sentence; cost basis sentence becomes Sure's tracker; positions « quantity above zero » and `get_holdings` « last row above zero » become « not zero »; a lock ends at a day at zero or below.
- `docs/sure-parity.md:64` -- drop the `QUANTITY_UNAVAILABLE` departure.
- Tests to rewrite: `services/ledger/trades.spec.ts:232-268,473,552-614,1134,1285-1302`; `routes/trades.spec.ts:113-136,334,386`; `domain/holdings/forward.spec.ts:151-190`; `services/ledger/holdings.spec.ts` lock tests; `mcp/holdings.spec.ts`; `app/e2e/trades.spec.ts:102,180`; `app/e2e/positions.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/holdings/forward.spec.ts` -- add oversell to −5 with `null` basis, rebuy after short, partial cover keeping the tracker's basis, same-day sale before its buy -- tests first, failing on today's `apply`.
- [x] `packages/api/src/domain/holdings/forward.ts` -- Sure's tracker in `apply` -- make them pass, existing cases unchanged.
- [x] `packages/api/src/services/ledger/trades.spec.ts`, `routes/trades.spec.ts`, `services/ledger/edits.spec.ts`, `services/ledger/import-revert.spec.ts` -- turn each refusal into success with the negative holding.
- [x] `shared.ts`, `trades.ts`, `edits.ts`, `import-revert.ts`, `domain/trades.ts`, `lib/errors.ts` -- delete the refusal chain as mapped.
- [x] `services/ledger/holdings.spec.ts`, `services/holdings.spec.ts`, `mcp/holdings.spec.ts` -- a negative position listed, a crossed lock ended; then `holdings.ts`, schema, migration `0076`, volume spec.
- [x] `TradeDialog.tsx`, `ConvertTradeDialog.tsx`, `fr.json` -- remove the error mapping.
- [x] `packages/app/e2e/trades.spec.ts` -- the sale above what is held saves and « Positions » shows the negative quantity; deleting the buy a sale needs succeeds.
- [x] `docs/architecture.md`, `docs/sure-parity.md` -- AD-22 and the Investment row.

**Acceptance Criteria:**
- Given any trade write, edit, deletion, transaction deletion or import revert, when it leaves a running quantity below zero, then it commits and balances and holdings are recomputed as for any other write.
- Given `git grep QUANTITY_UNAVAILABLE`, when the story lands, then it finds nothing outside `_bmad-output/`.
- Given a viewer, when « Positions » shows a negative position, then nothing new is offered to write.

## Implementation Notes

- `holdings` carried two checks, `holdings_quantity_check` and `holdings_amount_check`, holding both at zero or more; migration `0076_holdings_not_held.sql` rebuilds the table without them (pattern of `0073`, `0075`), then creates the index. No row changes.
- `holdings_not_held` indexes `(account_id, security_id, date, quantity)`: with `<= 0`, unlike `= 0`, SQLite reads the quantity to check each day, and the index stays covering only with it; the volume spec asserts the plan.
- The matrix's « 204 » for a deletion is the planner's slip: `DELETE /api/trades/:id` answers 200 with `{ data: { id } }`, unchanged.
- `positionFigures` changed despite « unchanged »: a book value below `-MAX_MINOR_UNITS` gives no figures, as one above `MAX_MINOR_UNITS` does, and a short position's gain percentage is measured over the book value's size, as Sure's `Trend#percent` divides by `previous.abs`.
- Export: a `Holding` line sold short is left out (AD-23), since Sure's `Holding` validates `qty` and `amount` at zero or more and Sure's own importer would refuse the archive; `family.sync_later` after a Sure import recomputes those days from the trades.
- `PositionSheet.tsx` hides « Prix de revient unitaire » on a short position: the server refuses it with `NOT_FOUND`, as Sure's `HoldingsController#update` refuses one without `qty.positive?`, and the toast would have read « Cette ressource n'existe pas. ».
- `formatQuantity` writes a negative quantity with U+2212, as `formatMoney` writes the value beside it.
- Same-day trades with the same `created_at` order by id: a sale and a buy recorded in one millisecond may give run-dependent cost bases. Pre-existing; tests use distinct dates.

## Review Triage Log

| Source | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| blind | Export writes negative `Holding` lines Sure's importer refuses | high | Sure's `Holding` validates `qty`, `amount` >= 0 and `upsert_imported_holding!` calls `save!`; `sure-preflight.ts` flagged it | patch: short days left out, test fails without the filter |
| blind, verification-gap | Short position with a cost basis: gain percent `null`, untested | medium | `percentOf` refused a negative whole; Sure's `Trend#percent` divides by `previous.abs` | patch: over the book value's size, unit test |
| blind, edge-case | Spec says `positionFigures` unchanged; delete answers 200, not 204 | low | Spec slips, not code defects | rejected: fix edits this spec; recorded in Implementation Notes |
| blind | « creates no security when the trade is refused » now refused before `resolveSecurity` | medium | The future date hit `refuseFutureDate` first | patch: refused by `amountOf` after the security resolves |
| blind | « nets a day's trades » asserts nothing a sale could fail | low | Every sale succeeds now | patch: asserts quantity 0 on the day |
| blind | Two-chunk revert test lost its reason | false | It still asserts both converted trades go across chunks (`trades: 0`) | rejected |
| blind | Cost basis form on a short position shows « Cette ressource n'existe pas. » | medium | `heldToday` refuses with `NOT_FOUND`; the sheet showed the form | patch: form hidden below zero, e2e asserts it |
| blind | Viewer criterion untested | false | No write control was added; `viewer.spec.ts` covers the sheet | rejected |
| blind | No sign-consistency check replaces the dropped ones | low | `holdings` is derived, written by the recompute alone; a check adds complexity | rejected |
| blind | Stored holdings keep old cost bases until the next recompute | low | Only same-day sale-before-buy histories differ; accepted in Design Notes | rejected |
| blind | `epics.md` and `epic-22-context.md` still describe the refusal | false | Historical planning artifacts of Epic 22, not current conventions | rejected |
| blind, standards | Overlong or stale lock comments in `holdings.ts`, `export.ts` | low | Direct corrections | patch |
| standards | `firstZero`, `lastZero` names | low | Direct rename | patch: `firstNotHeld`, `lastNotHeld` |
| standards | Book value unbounded below zero | medium | `toMinorUnits` past a safe integer on a huge short position | patch: symmetric bound, unit test |
| verification-gap | Income security list offers a security only ever sold short, then `not_held` | low | Rare, and `not_held` is out of scope by the spec's « Never » | rejected |

## Design Notes

Sure keeps two counts: the portfolio's quantity (can go negative) and the tracker's (never below zero). Example: buy 10, sell 15, buy 3 → quantity −2, tracker 3, cost basis = the last buy's price. Today's `apply` derives `held` from the position and would clear the basis at −2; that is the divergence to remove. Same-day histories where a sale is recorded before its covering buy may change cost basis on their next recompute; no migration recomputes them, since Sure's figure is the right one and they were already reachable.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- clean, knip finds no orphan export.
- `pnpm test` -- unit and volume projects pass, the volume plan naming `holdings_not_held`.
- `pnpm test:e2e` -- passes.

**Manual checks (if no CLI):**
- Screenshot « Positions » with a −5 position, and the « Ordres » list after the sale, in light and dark.
