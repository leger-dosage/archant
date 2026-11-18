---
title: "Story 28.20: Opening balance and snapshot refusals as Sure's"
type: 'feature'
created: '2026-10-17'
status: 'done'
baseline_commit: '737c89386720565fef8c7781fffe4c4aa54aa689'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-28-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Archant refuses opening balances and snapshots where Sure accepts them. The « Solde d'ouverture » sheet refuses a date on or after the oldest entry, where Sure's valuation drawer (`valuations/show`, saved through `ReconciliationManager`) refuses only a future date, by its field's `max: Date.current`. `set_opening_balance` refuses a future date, where Sure's `OpeningBalanceManager#date_error` checks only the oldest entry. `record_valuation` refuses a future date, where Sure's `ReconciliationManager` records it. `get_valuations` answers `not_found` for a well-formed unknown `account_id`, where Sure checks only that it is a UUID and filters.

**Approach:** The ledger's `setOpeningBalance` takes the caller's rule: the sheet's (any day up to today, never onto another valuation's day, as Sure's unique valuation date) or Sure's manager's (a given date before the oldest other entry, nothing else). `recordSnapshot` lets the assistant date after today. `get_valuations` refuses a non-UUID with Sure's `invalid_account_id` and filters otherwise.

## Boundaries & Constraints

**Always:**
- Sheet (`PATCH /api/accounts/:id/opening-balance`): a date after today answers `date_in_future`; a date another valuation holds (a snapshot or the bank's `current_anchor`) answers `snapshot_exists`, « Un solde est déjà saisi à cette date », as Sure's `validates :date, uniqueness` on valuations; any other date saves, before or after the oldest entry, and balances start at the oldest entry (Story 27.21).
- `set_opening_balance`: a given date on or after the oldest other entry answers `invalid_date` with `oldest_entry_date`, as now; an omitted date keeps the opening date and checks nothing, as Sure passes `date: nil`; a date after today saves, balances running from it.
- `record_valuation`: a date after today records the valuation; « Ajouter un solde » and « Modifier le solde » keep refusing it, as Sure's form `max`.
- `get_valuations`: an `account_id` that is not a UUID answers `{ error: "invalid_account_id", message: "account_id must be a UUID from get_accounts." }` without `success`; a UUID no active account has answers an empty page. `record_valuation` refuses a non-UUID the same way, `{ success: false, error: "invalid_account_id", message: "account_id must be a UUID." }`, after `invalid_amount` and before `account_not_found`, as Sure's.
- The sheet no longer meets `not_before_oldest_entry`: its message, `FieldMessage`'s `date` and the sheet's state for it go.
- AD-8 and `docs/sure-parity.md` (« Editing the opening balance », « Snapshots by an assistant ») change with this story; the tool descriptions say the new rules.

**Never:** no migration; no change to file statement balances (`ingest.ts` keeps `snapshotRejectionFor`'s future refusal), to trades, or to the dry run; no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sheet, after a line | opening 30 days ago, line 10 days ago, date 5 days ago | saved; balances from the line, the anchor setting its day | none |
| Sheet, amount only | line before the opening date | saved | none |
| Sheet, future | tomorrow | refused | `date_in_future` |
| Sheet, onto a snapshot | snapshot 20 days ago, date 20 days ago | refused, nothing written | `snapshot_exists` |
| Tool, empty account, future | date in 10 days | saved; balance rows run to that day | none |
| Tool, on the oldest entry | line on the date | refused | `invalid_date`, `oldest_entry_date` |
| Tool, no date, opening after a line | date omitted | saved, date kept | none |
| `record_valuation`, future | tomorrow | recorded, `replaced_existing: false` | none |
| `get_valuations`, unknown UUID | random UUID | `valuations: []`, `total_results: 0` | none |
| `get_valuations`, malformed id | `"nothing"` | refused | `invalid_account_id` |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/ledger/opening.ts` -- `setOpeningBalance` gains `rule: "drawer" | "manager"`; `OpeningBalanceResult` gains `SNAPSHOT_EXISTS`.
- `packages/api/src/services/accounts.ts` -- `setAccountOpeningBalance` takes the rule and an optional date; `openingRejection` maps `SNAPSHOT_EXISTS`.
- `packages/api/src/routes/accounts.ts` -- the sheet's route passes `drawer`.
- `packages/api/src/mcp/opening-balance.ts` -- passes `manager` and the date only when given; `refuseDate` drops `date_in_future`; description.
- `packages/api/src/services/ledger/snapshots.ts`, `services/snapshots.ts` -- `recordSnapshot` / `createSnapshot` take whether a date may pass today; `snapshotRejectionFor` in `domain/balances/snapshot.ts` unchanged for `ingest.ts`.
- `packages/api/src/mcp/snapshots.ts` -- `record_valuation` allows the future and checks the UUID; `get_valuations` checks the UUID; `services/snapshots.ts`' `listValuations` stops calling `getAccount`. Reuse the UUID pattern of `mcp/bills.ts` by moving it to `mcp/tool.ts`; `invalid_account_id` joins `SURE_REFUSALS`.
- `packages/api/src/schemas/assistants/snapshots.ts`, `schemas/assistants/opening-balance.ts` -- descriptions.
- `packages/app/src/components/OpeningBalanceSheet.tsx`, `FieldMessage.tsx`, `locales/fr.json` -- drop the oldest-entry message.
- Specs: `services/ledger/opening.spec.ts`, `services/ledger/snapshots.spec.ts`, `routes/accounts.spec.ts`, `mcp/opening-balance.spec.ts`, `mcp/snapshots.spec.ts`; `app/e2e/snapshots.spec.ts`.
- `docs/architecture.md` (AD-8), `docs/sure-parity.md`; `deferred-work.md`'s 28.17 entry is settled.
- Sure, read-only, at `00dd977fb`: `app/models/account/opening_balance_manager.rb`, `account/reconciliation_manager.rb`, `assistant/function/{set_opening_balance,record_valuation,get_valuations}.rb`, `app/views/valuations/{new,show}.html.erb`, `app/models/entry.rb`.

## Tasks & Acceptance

**Execution:**
- [x] Vitest first: ledger `opening.spec.ts` (drawer: after the oldest entry saves, future refused, onto a snapshot or an anchor refused; manager: future saves, oldest kept, no date checks nothing), `snapshots.spec.ts` (future recorded when allowed), route and MCP specs for every matrix row; failing first.
- [x] Ledger, services, route, MCP tools and descriptions.
- [x] Sheet, `FieldMessage`, locales.
- [x] `e2e/snapshots.spec.ts` -- the sheet saves a date after a line's date; the refusal test moves onto a snapshot's day.
- [x] AD-8, parity rows, deferred entry.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass, and the sheet's saved and refused states are screenshotted light and dark, desktop and phone width.

## Design Notes

Assumptions taken alone, each settled by Sure. The sheet's refusal onto a valuation's day is Sure's `Entry` uniqueness, which its drawer's `save!` meets, shown with Archant's existing `snapshot_exists` words. The `current_anchor` counts, being a valuation in Sure too. The assistant's `manager` rule never needs that check, since a valuation is an entry and the date must precede them all. `record_valuation`'s UUID check comes with `get_valuations`', Sure's same `valid_uuid?`, so one malformed id reads alike in both tools.

## Implementation Notes

- The ledger names the two paths: `setOpeningBalance(…, { rule: "drawer" | "manager" })` (`OpeningDateRule` in `services/ledger/opening.ts`); `recordSnapshot` and `createSnapshot` take `afterToday`, which only `record_valuation` sets. `snapshotRejectionFor` is unchanged, so files keep refusing a future balance.
- A date the sheet or « Modifier le solde » does not move is checked for nothing: an amount-only edit saves when the opening date shares the bank balance's day or sits after today after an assistant moved it there, which Sure's own field `max` would block in the browser. Taken alone, beyond the frozen Always, because the sheet always sends its date and the user could otherwise never correct the amount.
- An assistant's date after today is bounded at a year, Archant's `MAX_DAYS_AHEAD` for lines (`isTooFarAhead` in `domain/statement.ts`), answering `date_too_late`: Sure has no bound, but every day up to the latest entry gets a balance row written under the write lock, and 9999-12-31 would write millions. Recorded as Different in the parity rows and AD-8.
- An id is lower-cased after Sure's UUID check, as Sure's `uuid` column matches either case.
- `docs/deployment.md`'s assistant paragraph follows the new rules.
- Screenshots of the sheet saved after a line's date and refused onto a snapshot's day, light and dark, at 1440 and 390 px, were reviewed against Sure's `valuations/show` drawer.

### Review Findings

- [x] [Review][Patch] A future snapshot from `record_valuation` could not be edited from « Modifier le solde » [packages/api/src/services/ledger/snapshots.ts]
- [x] [Review][Patch] No test of the sheet's unchanged future opening date, nor of `set_opening_balance`'s `date_too_late` [packages/api/src/services/ledger/opening.spec.ts, packages/api/src/mcp/opening-balance.spec.ts]
- [x] [Review][Patch] `set_opening_balance` answered `not_found` to an upper-case UUID [packages/api/src/mcp/opening-balance.ts]
- [x] [Review][Patch] The `date` parameter descriptions of both tools left out the new rules [packages/api/src/schemas/assistants/opening-balance.ts, snapshots.ts]
- [x] [Review][Patch] The one-year bound said Parity; AD-8 omitted it and the unmoved date; `docs/deployment.md` called the tool and the sheet alike [docs/sure-parity.md, docs/architecture.md, docs/deployment.md]

Rejected:
- `set_opening_balance` refuses a resent current date after the sheet moved it past a line (low): Sure's `date_error` checks any date given.
- `record_valuation` on the bank balance's day adds a second valuation (low): unchanged by this story; the anchor wins its day (AD-8, Story 28.18).
- `not_before_oldest_entry` still emitted over HTTP (false): only the `manager` rule produces it, which only the tool uses.
- `recordSnapshot` checks the year bound without `afterToday` (low): `DATE_IN_FUTURE` answers first; harmless.
- The deferred entry's old evidence line (low): kept as written, the resolution line says what changed.
- No route test of `snapshot_exists` on the bank balance's day (low): the ledger test covers the branch; the route maps the same code as a snapshot's.
- Tracking and screenshots (false): statuses move to done together; screenshots recorded above and on the pull request.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | No upper bound on an assistant's future date | medium | patch | `entryDateSchema` caps nothing above; 9999-12-31 writes one balance row a day under the write lock. Archant's `MAX_DAYS_AHEAD` (366 days, `DATE_TOO_LATE`) already guards lines for the same reason. |
| 2 | Sheet refuses an amount-only edit when its unchanged date shares a day with the `current_anchor`, or sits after today | low | patch | The sheet always sends the date; a date that does not move is checked for nothing. |
| 3 | Upper-case UUID passes the check but matches no row | low | patch | The pattern has `i`, the SQL compares text; Sure's `uuid` column matches either case. Lower-cased after the check. |
| 4 | `docs/deployment.md` still describes the old refusals | low | patch | Its assistant paragraph quotes « not after today » for both tools. |
| 5 | Future-date tool test asserts no `current_balance` | low | patch | Sure's `current_balance_effect` answer added to the test. |
| 6 | A future opening date leaves no balance today, while `current_balance` says it moves | low | reject | Sure's `current_balance_effect` answers the same; today's balance is the day's row, none before the history starts, as AD-8. |
| 7 | `snapshot_exists` wording on a linked account's bank balance day | low | reject | Rare (opening date moved onto today on a linked account); Archant's existing words for Sure's uniqueness error. |
| 8 | `snapshotRejectionFor`'s comment outdated | false | reject | It still states the forms' and files' rule; `recordSnapshot` documents the assistant's exception. |
| 9 | `set_opening_balance` description names the « Solde d'ouverture » row though the rules differ | false | reject | It names the anchor it edits; the next paragraph states the tool's own date rule. |
| 10 | No test for a linked account's future valuation | low | reject | Days after the anchor go forward from it (`domain/balances/reverse.ts`), where a reconciliation sets its day as anywhere. |
| 11 | No test for a dry run with a future or absent date, a deactivated account in `get_valuations`, or a future opening-date valuation through the tool | low | reject | Same branches as the tested write paths; the active filter is unchanged. |
| 12 | No test for a blank `account_id` in `get_valuations` | low | reject | Sure's `present?`; the schema already refuses the empty string. |
| 13 | Tracking: `last_updated` earlier, story `in-progress`, spec outside the diff | false | reject | Statuses move to done together at completion; the spec is the claims file. |

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.
