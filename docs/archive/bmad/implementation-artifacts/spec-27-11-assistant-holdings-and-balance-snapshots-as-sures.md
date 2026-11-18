---
title: "Story 27.11: Assistant holdings and balance snapshots as Sure's"
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_commit: '11599662e774c5a5937591f8fcf41ffa1bee350c'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-27-10-assistant-transactions-as-sures.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `get_holdings`, `get_valuations` and `record_valuation` still answer Story 22.4's and 26.2's fields: decimal strings where Sure's functions (`origin/main` `7e1d93613`) answer JSON numbers, eight holding fields and `left_out_*` Sure lacks, a snapshot's `computed` and `gap`, no `amount_formatted`, no `success` or `message`, and a refused citation as `{ error, hint }`. `get_holdings` also lists today's positions only, where Sure lists each security's last held row.

**Approach:** Each tool takes and answers its Sure function field by field, with 27.9's `decimalOf`, `formatMoney` and `refuse`; `listHoldings` reads each security's last non-zero row instead of today's.

## Boundaries & Constraints

**Always:**
- `get_holdings` item, exactly and in Sure's order: `ticker`, `name`, `quantity`, `price`, `currency`, `amount` (JSON numbers, each `Number` of its decimal text, never a float computed), `formatted_amount` (`formatMoney`), `weight`, `average_cost` (number or `null`), `formatted_average_cost` (`formatMoney` of the cost basis rounded half up to minor units, or `null`), `account` (the name), `date` (that row's day). Page: `holdings`, `total_results`, `page`, `page_size` (50), `total_pages`, `total_value` (`formatMoney`, reporting currency). `security_id`, `isin`, `exchange_mic`, `price_date`, `average_cost_locked`, `book_value`, `gain`, `gain_percent`, top-level `currency` and `left_out_*` go. Inputs unchanged: `page`, `accounts`, `account_ids`, `securities`.
- Rows: for each active investment account and security, the last `holdings` row with `quantity > 0` on or before today, a security sold out included at its last held quantity, its cost basis as `liveCostBasisLocks` decides for that row. Order: amount descending, then today's tie-breakers. `total_value` sums the listed rows of reporting-currency accounts, sold-out rows included, as Sure sums its query; other currencies stay out and the description says so (AD-6).
- `weight` is Sure's `Holding#weight` as Rails writes it: `0` (JSON number) when the amount is zero; else `1` (JSON number) when the account's current balance, the `balances` row on or before today, is zero; else `amount / balance × 100` rounded half away from zero to 2 decimals, as `decimalOf` writes a `BigDecimal` (`"33.33"`, `"100.0"`, `"-12.5"`), negative when the balance is.
- `get_valuations` item, exactly: `entry_id`, `account` (`{ id, name, currency }`), `date`, `amount` (`decimalOf`), `amount_formatted` (`formatMoney`), `kind`, `notes`. `computed` and `gap` go. A malformed date or `start_date` after `end_date` answers Sure's `{ error: "invalid_date", message }`, without `success`, with Sure's two messages; `page` clamps below 1 as `resolved_page`.
- `record_valuation`: `amount` a JSON number, read through `String(number)`, or a decimal string, as 27.10's `sureAmount`; `date`, `amount` and `source` reach `run` loosely typed. Refusals in Sure's order and messages: `invalid_source_citation` (`<Sure's reason>. Every recorded value must cite its source, in the grammar: ["estimated: "] citation [" (grade: A|B|C)"].`, `unknown_grade` naming the grade given), `invalid_date`, `invalid_amount`, `account_not_found`; the sheet's own refusals (opening date, future, scale) keep 27.9's generic shape. Answer `{ success: true, entry_id, account, date, amount, amount_formatted, replaced_existing, provenance, message }`, message `Recorded <amount_formatted> for <account name> on <date>, cited as: <source>.`
- Docs: AD-19 (`docs/architecture.md`) says Stories 27.12 to 27.14 still answer their earlier fields; `docs/deployment.md` « Connecting an assistant », `docs/security-model.md` « Assistants » if it names these fields, and `docs/sure-parity.md` « Snapshots by an assistant » and every `get_holdings` mention follow, those rows set to Parity with their departures: totals in the reporting currency only, `account_ids` beside names.

**Never:** no change to `listPositions`, `GET /accounts/:id/holdings` or the « Positions » tab; no migration nor new index; no change to `parseCitation`'s codes, which the « Soldes » dialog translates; no Sure `invalid_account_id` UUID check (27.10); no change to the reports, bills or Archant-only tools (27.12 to 27.14).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sold out | bought 10 on 2026-03-02, sold all 2026-06-01 | listed, `quantity: 10`, `date: "2026-05-31"` | none |
| Weight | amount 250,00 €, balance 750,00 € | `weight: "33.33"` | none |
| Zero balance | balance 0 | `weight: 1` | none |
| Negative balance | amount 100, balance −400 | `weight: "-25.0"` | none |
| Number amount | `record_valuation` `amount: 175000.5` | stored `17500050`, `amount: "175000.5"`, `amount_formatted: "175 000,50 €"` | none |
| Bad grade | `source: "Relevé (grade: D)"` | nothing written | `invalid_source_citation`, message names `"D"` |
| Reversed range | `start_date` after `end_date` | nothing listed | `{ error: "invalid_date", message: "start_date must be on or before end_date." }` |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/holdings.ts:109-203` -- `HoldingsFilter`, `HoldingsAcrossAccounts`, `listHoldings` (only `mcp/holdings.ts` calls it): rebuilt on a new ledger read; `leftOut` goes. `:74` `listPositions` and `positionOf` untouched.
- `packages/api/src/services/ledger/holdings.ts:171-282` -- `liveCostBasisLocks`, `lastHoldingsDay`, `currentHoldings`: add a reader of the last `quantity > 0` row per `(account_id, security_id)` on or before a day, `max(date)` grouped then joined back on the primary key, as Drizzle allows without raw SQL. `services/ledger/balances.ts:58` `lastBalanceOnOrBefore` gives `balance`.
- `packages/data/schema/holdings.ts:18-57` -- quantities and prices in micros, amounts in minor units; `formatMicros` reads them.
- `packages/api/src/mcp/holdings.ts` -- the tool; `decimal`, `leftOutFields`, `leftOutOf` imports go. `mcp/tool.ts` `leftOutFields`/`leftOutOf`/`decimal` go if nothing else uses them after this story (knip).
- `packages/api/src/mcp/snapshots.ts` -- both tools; `SURE_REFUSALS` (`tool.ts:150`) gains `invalid_source_citation` (`VALIDATION_ERROR`); `RefusalBody` gains Sure's `{ error, message }` for `get_valuations`.
- `packages/api/src/services/snapshots.ts:77` `listValuations` (MCP only): stop computing `computed`/`gap` if the ledger read allows. `createSnapshot` unchanged.
- `packages/api/src/schemas/assistants.ts:271` `holdingsInput` unchanged; `:1297` `valuationsInput` loose dates, no refine; `:1330` `recordValuationInput` loose `date`/`amount`/`source`, `sureAmount` (`:1441`) and `requiredLoose` reused. `domain/balances/citation.ts` `parseCitation` reused, its codes mapped to Sure's messages in the tool.
- `packages/api/src/mcp/server.ts:177-179` -- `INSTRUCTIONS` on valuations: drop anything naming `gap`.
- Tests: `mcp/holdings.spec.ts`, `mcp/snapshots.spec.ts`, `mcp/server.spec.ts` (7 lines).
- Sure: `app/models/assistant/function/get_holdings.rb`, `get_valuations.rb`, `record_valuation.rb`, `app/models/holding.rb` `weight`, `app/models/provenance/citation.rb`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/mcp/holdings.spec.ts`, `snapshots.spec.ts` -- failing first: each matrix row, every citation refusal message, Sure's refusal order, `Object.keys` of every answer and item.
- [x] `packages/api/src/services/ledger/holdings.ts`, `services/holdings.ts` -- the last-held read and `listHoldings`.
- [x] `packages/api/src/schemas/assistants.ts`, `mcp/holdings.ts`, `mcp/snapshots.ts`, `mcp/tool.ts` -- inputs, answers, refusals.
- [x] `packages/api/src/mcp/server.spec.ts`, `server.ts` -- follow the shapes; `INSTRUCTIONS`.
- [x] Docs as Boundaries list.

**Acceptance Criteria:**
- Given `pnpm test`, when both Vitest projects run, then they pass and the three tools are pinned key by key through the MCP handler.
- Given `pnpm lint:code`, when knip runs, then nothing this story leaves unused remains.
- Given the « Positions » tab, when it loads, then it shows what it showed before this story.

## Design Notes

Sure's `weight` mixes types because `round(2)` keeps a `BigDecimal`, which `to_json` writes as a string, while the two early returns are Ruby integers; the tool's `outputSchema` declares `z.union([z.string(), z.number()])`. Rounding the exact ratio of the two minor-unit integers in `BigInt` matches `BigDecimal#round`'s default half-up.

Sold-out rows count in `total_value` because Sure sums the same query it lists. That is Sure's behaviour, kept on purpose; diverging needs an admitted reason the epic does not give.

No index: the read scans one account's rows through the primary key's `account_id` prefix, about 73,000 rows for twenty securities over ten years, once per assistant call.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean.
- `pnpm test` -- expected: both Vitest projects pass.
- `pnpm test:e2e` -- expected: green.

## Implementation Notes

- `parseCitation` keeps its codes; its `unknown_grade` failure now also carries the grade given, which Sure's message names (`(got "D")`).
- `sureDecimalText` moved into `mcp/tool.ts`, shared by `record_valuation` and 27.10's `ledgerAmount`.
- `refuseWithoutSuccess` answers Sure's `{ error, message }` for `get_valuations`, recorded as `VALIDATION_ERROR`.
- The ledger's `listValuations` no longer computes `computed` and `gap`; `findSnapshot` and the « Soldes » tab still do.
- `get_valuations` with an unknown `account_id` still answers the generic `not_found`, where Sure lists nothing; `sure-parity.md` says so.
- `decimal`, `leftOutFields` and `leftOutOf` stay in `tool.ts`: the reports, budgets and bills tools still use them until 27.12 and 27.13.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| A lock standing on a sold-out security's last held day is ignored | medium | `lastHeldHoldings` reads only locks live today; a full sale ends the lock, so the day before the sale shows the calculated cost basis the « Positions » tab did not show that day. | patch: a lock applies when no zero day falls between `lockedOn` and the row's date |
| `costMoney` rounding up, a zero-decimal currency, `sureWeight`'s exact half and `"-0.0"` untested (blind, verification-gap) | medium | Every pinned cost basis rounds down or is exact; `AGENTS.md` asks money paths covered to the branch. | patch: tests |
| Refusal-order test checks `invalid_date`'s key alone | low | `snapshots.spec.ts` uses `toMatchObject({ error })` for the missing date. | patch |
| The reporting currency is named nowhere in `get_holdings` | low | Top-level `currency` went, as Sure's; the description still asks the assistant to warn about other currencies. | patch: description |
| AD-19 lists two refusal shapes | low | `refuseWithoutSuccess` answers `{ error, message }`, as Sure's `get_valuations`. | patch: docs |
| « Assistant tools » row says the 27.11 tools answer decimal text | low | `get_holdings` answers JSON numbers. | patch: docs |
| `price` and `average_cost` keep six decimals, Sure's columns four | low | Sure's `holdings.price` and `cost_basis` are `decimal(19,4)`; Archant stores micros, more exact data, not a format. | patch: departure noted in `sure-parity.md` |
| `sprint-status.yaml` `last_updated` written day-month | low | `generated: 09-21-2026` is month-day. | patch (fixed) |
| Exponent forms (`1e-7`, `1e21`) refused as `invalid_amount` (blind, edge, verification-gap) | low | Carried from 27.10's triage: never a sensible balance; a fix adds a parser branch. | rejected |
| A boolean amount or a numeric source answers `{ error, hint }` | low | Same as 27.10's rejected row on loosely typed fields; no assistant sends them. | rejected |
| A string amount over 40 characters answers `{ error, hint }` | low | `sureAmount`'s bound, shared with 27.10; no balance needs it. | rejected |
| No volume test pins the last-held query plan | low | Assistant-only read bounded by the primary key's `account_id` prefix; NFR10 covers the interface's reads. | rejected |
| `createSnapshot`'s trailing `found()` NOT_FOUND mapped to `account_not_found` after a write | false | `found` reads the row the same call just wrote, in the same request; nothing deletes it in between. | rejected |
| `costMoney` truncates a negative cost basis | false | A cost basis is a weighted price of buys, never negative. | rejected |
| Negative quantities dropped where Sure's `qty <> 0` keeps them | false | `holdings_quantity_check` requires `quantity >= 0`. | rejected |
| A missing balance row gives `weight: 1` silently | false | A holdings row exists only after a trade, which writes the account's balances. | rejected |
| `liveCostBasisLocks(db, null)` reads every account's locks | low | Folded into the lock patch, which reads the asked accounts'. | patch (same fix) |
| Code Map names `services/snapshots.ts` and `lastBalanceOnOrBefore` where the code changed `ledger/snapshots.ts` and calls `balanceOn` | low | `balanceOn` wraps `lastBalanceOnOrBefore`; the fix edits the spec. | rejected |
| `deployment.md` « Like the dashboard, they count only… » reads as covering `get_valuations` | maybe-false | The sentence follows the reports' paragraph; reading its antecedent settles it. | rejected (low at most) |
| `weight`'s zero-amount `0` untested (spec-review) | medium | The story asks each weight edge case covered; the weights test pins every case but `0`. | patch: test |
| « A full sale ends the lock » encoded twice, `liveCostBasisLocks` and `lastHeldHoldings` (spec-review) | medium | Two subqueries on the same partial index; a change to one rule would leave the « Positions » tab and the assistant disagreeing on a cost basis. | patch: one shared subquery |
| `?? toMinorUnits(0)` applied twice in `listHoldings` (spec-review) | low | The map already holds a value for every listed account. | patch |
| `costMoney` rounds half up, AD-22 half to even (spec-review) | false | AD-22 binds stored values; `formatted_average_cost` mirrors Sure's `Money#format`, which rounds half up. | rejected |
| `sureWeight` writes its own decimal, not `percentage` (spec-review) | false | Sure's `weight` is a `BigDecimal` written by `to_json`, not `number_to_percentage`; `percentage` would answer `"33,33 %"`. | rejected |
| Checks in `run`, a `domain/` import from `mcp/` (spec-review) | false | 27.10's triage rejected the same; other tools import `domain/` already. | rejected |
| `z.iso.date().safeParse` written three times (spec-review) | low | One-line calls; a helper adds surface for no named harm. | rejected |
| `numberOf` names micros poorly (spec-review) | low | Its type, `Micros`, and its doc comment say it. | rejected |
| A mechanism comment in `lastHeldHoldings` (spec-review) | low | Removed by the shared-subquery patch. | patch (same fix) |
| `String(given)` could give `"undefined"` (spec-review) | false | `GRADE_SUFFIX` matched, so its `grade` group captured, possibly the empty string. | rejected |
| `Date.iso8601` accepts `20260331` or week dates, `z.iso.date()` does not (spec-review) | low | Both tools advertise `YYYY-MM-DD`; no assistant sends another form. | rejected |
