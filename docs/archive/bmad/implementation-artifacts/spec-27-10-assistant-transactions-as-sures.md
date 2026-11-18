---
title: "Story 27.10: Assistant transactions as Sure's"
type: 'feature'
created: '2026-10-10'
status: 'done'
baseline_commit: 'eee243c6af13e0401ee81c1cd50ee9e78d0911f2'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-27-9-assistant-answers-in-sures-formats-and-sures-accounts-and-lists.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Archant's transaction tools speak Archant's sign, where Sure's speak the opposite: `create_transaction` reads `"12.50"` without `type` as money in, so an assistant written for Sure (`origin/main` `00dd977fb`) records an expense as income. `get_transactions`, `get_transaction`, `update_transaction` and `delete_transaction` also answer fields Sure's functions lack and miss the ones they have.

**Approach:** Each tool takes and answers its Sure function field by field, in Sure's sign (positive is money out), converted to Archant's sign (AD-5) at the tool's boundary, with 27.9's `decimalOf`, `formatMoney` and refusals.

## Boundaries & Constraints

**Always:**
- `get_transactions` item, exactly: `id`, `name`, `date`, `amount` (`decimalOf` of the absolute amount), `currency`, `formatted_amount` (`formatMoney` of the absolute amount), `classification` (`"income"` when money in, else `"expense"`), `account`, `category`, `merchant` (names or `null`), `notes`, `tags` (names), `is_transfer` (a side of any transfer, pending or confirmed). Page: `transactions`, `total_results`, `page`, `page_size`, `total_pages`, `total_income`, `total_expenses` (`formatMoney`, positive, reporting currency, from today's `sumTransactions`, which already leaves out transfer sides and tax-advantaged accounts as Sure's `Transaction::Search#totals`). Lines in another currency stay out of the totals and the description says so (AD-6); `currency` and `skipped_count` go.
- Its parameters, exactly Sure's: `search`, `amount`, `amount_operator`, `start_date`, `end_date`, `types`, `statuses`, `account_ids`, `accounts`, `categories` (with « Uncategorized »), `merchants`, `tags`, `order`, `sort_by`, `page`, `page_size`. `amount` or `amount_operator` alone is ignored; `amount` reads as Ruby's `to_f` (leading decimal, else 0). `page` and `page_size` clamp through 27.9's `clampedPageFields`. `category_ids`, `merchant_ids`, `tag_ids`, `amount_min`, `amount_max` go from this tool only.
- `get_transaction` (Archant's): a `get_transactions` item plus `account_id`, `excluded`, `source` (today's union) and `transfer`: `{ id, kind, status, counterpart_transaction_id, counterpart_account: { id, name } }` or `null`. `account_id` and `source` stay because `delete_transaction` and `INSTRUCTIONS` need them; `status` replaces `transfer_suggested`, which Story 27.1 removed. `reference` goes.
- `create_transaction`: Sure's parameters. `amount` a JSON number, read through `String(number)`, or a decimal string; without `type` positive is money out; `type` `income`/`inflow` makes it money in, `expense`/`outflow` money out, whatever its sign. The tool negates into Archant's sign. Answer `{ success: true, created, transaction, message }`, `transaction` exactly `id`, `entry_id` (= `id`), `name`, `date`, `amount` (`decimalOf`, Sure's sign), `amount_formatted` (`formatMoney`, Sure's sign), `currency`, `type`, `notes`, `category` and `merchant` as `{ id, name }` or `null`, `tags` as `[{ id, name }]`. Message `Created <name> (<amount_formatted> on <date>).`, or for `created: false` `Transaction already exists for this external_id; returned the existing one.`
- Its refusals, Sure's keys and messages where Sure's function checks the same thing: `account_not_found`, `invalid_date`, `invalid_amount` (not a number), `invalid_name` (blank), `invalid_currency` (unknown code, and a code other than the account's, message saying the account's currency), `invalid_category`, `invalid_merchant`, `invalid_tags`. Date, amount and name reach `run` loosely typed, as 27.9's `name_required`. Any other service refusal keeps 27.9's generic shape.
- `update_transaction`: parameters unchanged, `excluded` kept (FR65). Answer `{ success: true, transaction, message }`, `transaction` exactly `id`, `name`, `date`, `notes`, `category`, `merchant`, `tags` as `{ id, name }`; message `Transaction '<name>' updated.` Refusals `not_found` « Transaction with id '<id>' not found. », `no_changes` « Provide at least one field to update. » from `run` instead of the Zod refinement, `invalid_category`, `invalid_merchant`, `invalid_tags`; a split's exclusion keeps `transaction_split`.
- `delete_transaction`: `id`, `account_id`, `date` required as today (FR96), `amount` in Sure's sign, number or decimal string, negated before the ledger compares it. Answer `{ success: true, deleted: true, transaction, message }`, `transaction` exactly `id`, `entry_id`, `account_id`, `name`, `date`, `amount`, `amount_formatted`, `currency`, `type` (Sure's sign), message `Deleted <name> (<amount_formatted> on <date>).`; `deleted_count` goes. Refusals `not_found` « No transaction with id '<id>' in an account you can write to. », `split_child` « Split child transactions cannot be deleted individually. Delete the split parent instead. », `transaction_changed` as today.
- `bulk_update_transactions`' filter swaps `amount_min`/`amount_max` for Sure's `amount`/`amount_operator`, so `get_transactions` can still count what it selects; its ids stay (AD-19). `INSTRUCTIONS` say to read that count with the names `get_categories`, `get_merchants` and `get_tags` give for those ids, `Uncategorized` for `none`.
- Docs: AD-19 (`docs/architecture.md`) says a transaction amount crosses in Sure's sign, converted at the boundary, and that a read gives references as its Sure function does; `INSTRUCTIONS` (`mcp/server.ts`) drop « A row another one points to comes as { id, name } » and say amounts are positive for money out; `docs/deployment.md` « Connecting an assistant », `docs/security-model.md` « Assistants » and `docs/sure-parity.md` « Transactions by an assistant » follow, that row set to Parity with its departures: another currency refused, `delete_transaction`'s guard.

**Never:** no change to `group_transactions_by_label` nor to the bulk tool's answer (Story 27.14); no float on the way to or from a string; no change to services' signs or to the interface; no new service function; no Sure `invalid_uuid` (Archant's ids are not checked as UUIDs, an unknown one answers its not-found key).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Expense from a number | `create_transaction` `amount: 12.5`, no `type`, EUR | ledger `-1250`; `amount: "12.5"`, `amount_formatted: "12,50 €"`, `type: "expense"` | none |
| Income through `type` | `amount: 12.5, type: "income"` | ledger `+1250`; `amount: "-12.5"`, `type: "income"` | none |
| Other currency | `currency: "USD"` on a EUR account | nothing written | `{ success: false, error: "invalid_currency", … }` |
| Delete in Sure's sign | ledger `-1250`, `amount: "12.50"` | deleted, `amount: "12.5"` | `"-12.50"` answers `transaction_changed` |
| Listed expense | ledger `-1250` | `amount: "12.5"`, `formatted_amount: "12,50 €"`, `classification: "expense"` | none |
| Operator alone | `amount_operator: "less"` | filter ignored | none |
| Page size | `page_size: 500`, `page: 0` | `page_size: 100`, `page: 1` | none |
| Empty update | `update_transaction` `{ id }` | nothing written | `no_changes` |

</frozen-after-approval>

## Code Map

- `packages/api/src/mcp/transactions.ts` -- the five tools. `itemOf`/`namesFor` become Sure's item (names via `names.*.get`); `detailOf` adds `account_id`, `excluded`, `source`, `transfer` with `item.transfer.status` (`TransferLink`, `services/ledger/queries.ts:77`). `signedAmount` becomes Sure's-sign-to-Archant negation, reused by delete. Answers use `decimalOf`/`formatMoney` from `tool.ts`; refusals `refuse`, whose `SURE_REFUSALS` (`tool.ts`) gains the new keys with their recorded `ErrorCode`.
- `packages/api/src/schemas/assistants.ts:452-526` `getTransactionsInput` -- own Sure field set (not `toolFilterFields`), `clampedPageFields`, no `required` issues for a lone `amount`/operator, `to_f` reading; `operatorBounds` reused. `:537` `bulkFilterInput` -- amount operator instead of bounds. `:861` `updateTransactionInput` -- drop the `empty_patch` refine. `:1416` `createTransactionInput`, `:1476` `deleteTransactionInput` -- number-or-string amount, loose date/name, 27.9's `requiredSureName` pattern keeping them required in the advertised schema. `idFilterFields`/`toolFilterFields` stay for the group and bulk tools.
- `packages/api/src/services/transactions.ts:538` `createTransaction` -- refusal sources to map by path: `currency currency_mismatch` (:555), the schema's `date`/`label`/`amount` issues, `getAccount`'s `NOT_FOUND`; `REJECTION_FIELDS` (:214) stays generic. `:639` `deleteTransaction` unchanged.
- `packages/api/src/services/ledger/queries.ts:436` `sumTransactions` -- already Sure's totals; unchanged.
- `packages/api/src/mcp/server.ts:140-190` -- `INSTRUCTIONS` lines on amounts, `{ id, name }`, bulk count, delete.
- Tests: `mcp/transactions.spec.ts` (`create_transaction` :171, `delete_transaction` :450, names :673, filters :766), `mcp/transfers.spec.ts:141-166` (the `status` and item `transfer` assertions flip), `mcp/server.spec.ts` (55 transaction-tool lines). `packages/app/e2e/assistants.spec.ts` only lists names: unaffected.
- `docs/architecture.md:201`, `docs/deployment.md:321-329`, `docs/security-model.md:75`, `docs/sure-parity.md:138`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/mcp/transactions.spec.ts` -- failing first: each matrix row; each filter (names, « Uncategorized », `types`, `statuses`, `search`, dates, `amount` × operator, `sort_by`/`order`); exact keys with `Object.keys` for every answer; each create refusal key.
- [x] `packages/api/src/schemas/assistants.ts` -- the inputs as Code Map.
- [x] `packages/api/src/mcp/transactions.ts`, `tool.ts` -- the tools and refusal keys.
- [x] `packages/api/src/mcp/transfers.spec.ts`, `server.spec.ts` -- follow the new shapes; bulk filter with `amount_operator`.
- [x] `packages/api/src/mcp/server.ts` -- `INSTRUCTIONS`.
- [x] Docs as Boundaries list.

**Acceptance Criteria:**
- Given `pnpm test`, when both Vitest projects run, then they pass and every tool of this story is pinned key by key through the MCP handler.
- Given `pnpm lint:code`, when knip runs, then nothing this story leaves unused remains (`decimal()` goes if `transfers.ts` no longer needs it; it still does until 27.14).

## Design Notes

Why `account_id` and `source` stay on `get_transaction` though the story lists only the transfer and `excluded`: `delete_transaction` requires the account id, and `INSTRUCTIONS` ask the assistant to say whether a bank synced the line before deleting it; a `get_transactions` item carries the account's name only, as Sure's.

Why the bulk filter changes here: `get_transactions` loses `amount_min`/`amount_max`, so a bulk filter on an amount range could no longer be counted before writing. Category, merchant and tag names are unique case aside (`*_name_unique` indexes), so names and ids select the same rows.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean.
- `pnpm test` -- expected: both Vitest projects pass.
- `pnpm test:e2e` -- expected: green.

## Implementation Notes

- `createTransaction` adds the account's currency as `params.currency` to its `currency_mismatch` refusal, so the tool answers Sure's `invalid_currency` naming it without a second service call; no HTTP route passes a currency there.
- `create_transaction` checks the account through `namesOf` before the date, the amount and the name, to keep Sure's order of refusals (`account_not_found` first); the date's format is checked in `run`, so the sheet's own date refusals, before the opening or too far ahead, keep the generic `validation_error`.
- An amount with more decimals than the currency holds, such as `"12.345"` in euros, answers `invalid_amount`: the ledger has no float to round it into.
- `get_transactions` keeps refusing an inverted date range (`end_date before_from`), as before; Sure would list nothing.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| `delete_transaction` passes unreadable text such as `"12,50"` unnegated to the ledger | high | `parseAmount` reads `"12,50"` as +12.50 in Archant's sign: an income matches where an expense was meant. | patch: refuse `invalid_amount` |
| Delete test titled "a string" sends only a number | medium | `transactions.spec.ts` covered `-12.5` alone. | patch: tests |
| Unreadable delete amount answers `validation_error`, create answers `invalid_amount` | low | Same root as the first row. | patch (same fix) |
| `INSTRUCTIONS` say every transaction tool uses Sure's sign | medium | `group_transactions_by_label` and `get_transfer_candidates` stay Archant-signed until 27.14. | patch: name the four tools |
| `INSTRUCTIONS` no longer say write answers give `{ id, name }` | low | Create and update still answer references as `{ id, name }`. | patch |
| `invalid_currency` keyed on `params.currency` alone | low | Any future refusal with that param would be misreported. | patch: match the field |
| Description hard-codes 50 | low | `DEFAULT_PAGE_SIZE` is the source. | patch |
| No test reads a confirmed transfer's `status` or `is_transfer` | medium | Every transfer in the specs is matcher-made, `pending`. | patch: test after `pair_transfer` |
| Advertised `required` of create/delete unpinned | low | Only categories and tags were pinned. | patch: test |
| No `breaking-change` note | low | The tool contract changes for assistants already connected. | handled at the pull request: label and « Before upgrading » |
| Exponent forms (`1e-7`, `"1e3"`) misread | low | Never a sensible money amount; a fix adds a parser branch. | rejected |
| Amount scale refusal says "amount must be a number." | low | Rare; Sure's message, Archant's minor-unit departure. | rejected |
| Several fields refused at once hide the date | false | The tool checks date, amount and name before the service; the service's remaining date refusals come from the ledger alone. | rejected |
| Deactivated account passes `namesOf` | low | The service then refuses as it does for the sheet; order only. | rejected |
| `skipped_count`, `deleted_count`, `amount_min`/`amount_max`, lone operator removed | false | The frozen intent removes them. | rejected |
| Spec and sprint statuses differ | false | Both move to `done` together at the end of the review. | rejected |
| `sure-parity.md` table realigned | false | `pnpm format` pads the table; the gate requires it. | rejected |
| A real category named « Uncategorized » | low | Pre-existing name filter behaviour, not this change. | rejected |
| `classificationOf` and `totalOf` take a bare `number` for money (spec-review) | medium | `AGENTS.md`: a bare `number` meaning money is a bug. | patch: `MinorUnits`, `Money` |
| `create_transaction` reads `namesOf` to test an account id (spec-review) | low | AD-19 allows a names read before the call only to find a row by name; the service's `NOT_FOUND` already answers `account_not_found`. | patch: pre-check removed, an unknown account with a bad date now answers `invalid_date` first |
| Comment on the delete answer's key order describes the mechanism (spec-review) | low | `AGENTS.md` asks for why-comments. | patch |
| Checks in `run` break AD-19's "Zod parse is the only input check" (spec-review) | false | AD-19 contrasts the tool's parse with the SDK's check; 27.9 already refuses `name_required` in `run`. | rejected |
| Three decimal readers (`ledgerAmount`, `leadingAmount`, `parseAmount`) (spec-review) | false | Each reads differently on purpose: strict decimal, Ruby's `to_f`, the sheet's French text. | rejected |
| Nested `catch` for the currency beside `refusedAsSure` (spec-review) | low | One branch; generalising `RefusalMap` adds surface. | rejected |
| A number sent as `date` or `name` answers `{ error, hint }`, Sure `to_s` (spec-review) | low | No assistant sends a number there. | rejected |
| `nameOf` falls back to an id | false | Unchanged from the previous `?? id` fallback. | rejected |
