---
title: "Story 27.14: Archant's own assistant tools in Sure's shapes"
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_commit: '8be637e3e93dfd2afc874e442261076aa5faba26'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-27-13-assistant-bills-and-recurring-payments-as-sures.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Twenty tools still answer pre-27.9 shapes: two-decimal strings in Archant's sign (`decimal()`, `toDecimalString`), `{ id, name }` refs, bare `{ id }` or row answers to writes, unpaged lists, accounts by id in `create_goal`, and `import_bank_statement` sharing its name with a Sure function of another contract. Sure (`origin/main` `275f2f994`) has `create_goal` and `import_bank_statement`; it has no goal read, rule, transfer, merchant-write, label-grouping or bulk function.

**Approach:** `create_goal` takes and answers Sure's contract; the import tools answer Sure's `import_bank_statement` keys first, then the figures Archant's preview and confirmation need; every other tool follows its closest Sure function: writes `create_category`'s `{ success, <row>, message }`, lists `get_categories`' pagination (`pageOf` in `mcp/tool.ts`), transaction-like rows `get_transactions`' row (`itemOf` in `mcp/transactions.ts`).

## Boundaries & Constraints

**Always:**
- `create_goal` input: `name`, `target_amount` (number or decimal text, `sureDecimalText`), `target_date` (ISO; unreadable → ignored, as Sure's), `linked_account_names` (strip, blanks dropped), `earmarks` `{ name: amount }` (nonpositive or unreadable ignored; a key naming no linked account ignored), `notes`; Archant extras `kind` (`one_off` default, `maintained`) and `target_months` (1–120, a reserve's target instead of `target_amount`). Names match exactly, case included, among active accounts `canBackGoal` accepts (Sure's visible `Depository`).
- `create_goal` refusals, `{ success: false, error, message, …extras }` in Sure's order and words: `name_required`, `target_amount_invalid` (a one-off without a positive amount; a reserve without amount or months), `no_linked_accounts`, `unknown_accounts` (+`unknown_names`), `ambiguous_accounts` (+`ambiguous_names`), `currency_mismatch` (`Found: EUR, USD.`), `account_claimed_in_full` (+`claimed_account_names`), each of the four account ones with `available_accounts [{ name, currency, free_to_earmark, claimed_in_full }]`; any other service refusal `validation_failed`, English sentences joined by `; ` (a reserve with a date included). `RefusalBody` accepts these extras.
- `create_goal` answer: `success`, `goal_id`, `name`, `target_amount_formatted` (a reserve in months: the target it stores), `currency`, `target_date` (or `null`), `url`, `linked_account_names`, `message` `Created goal 'X' (target 5 000,00 €). View it at <url>.`
- `get_goals`: `goals`, then `pageOf`'s fields, `page`/`page_size` as `get_categories`. Each goal: `create_goal`'s fields from `goal_id` to `linked_account_names`, then `notes`, `kind`, `target_months` (or `null`), `status` (Sure's `display_status`: `archived`, `paused`, `completed`, else `goalProgress`'s), `progress_percent`, `current_balance`, `remaining_amount`, `monthly_target_amount` (or `null`), `pace` (per month), `earmarks` `{ name: formatted }` for allocated links. Money through `formatMoney`. `totals`, `left_out`, `accounts` refs and `target_mode` go.
- `import_bank_statement` becomes `import_statement_file`, input unchanged (Sure's `upload_account_statement` plus a required `account_id`). It and `preview_import` answer `success`, `import_id`, `transaction_count` (lines read, rejected ones out), `transactions_preview` (first five lines to create: `{ date, amount, name, category, notes }`, `amount` Sure's decimal text in the statement's sign, `category` and `notes` `null` when the file gives none), `statement_period` (`{ start_date, end_date }` over the lines read, `{}` when none), `message` (Sure's `Successfully extracted N transactions. Import created with ID: X. Review and publish when ready.`), then Archant's `counts`, `rejected_lines` (`{ date, name, amount, reason }`), `opening_suggestion`, `opening`, `statement_balance`, `csv`, `qif`, amounts formatted. `filename`, `source`, `currency`, `lines` go.
- `confirm_import` answers `{ success, counts, message: "Imported N transactions: N matched, N flagged as possible duplicates." }`.
- Rules: `get_rules` and `get_rule_runs` (`rule_runs`) paged as `get_categories` (`page_size` loose, clamped 1–100, default 50); `create_rule`, `update_rule`, `set_rule_enabled` answer `{ success, rule, message }` (`Rule 'X' created.`, `updated`, `enabled`, `disabled`; `Rule created.` etc. without a name); `delete_rule` `{ success, deleted: true, rule, message }`; `apply_rules` `{ success, changed, runs [{ rule_id, rule, matched_count, changed_count }], message }`. `preview_rule` samples are `get_transactions` rows (without `is_transfer`) plus `changes`, each `from`/`to` by name. A rule read (`get_rules`, `rule_runs`' `rule`, every write's `rule`) gives each condition's and action's category, merchant, tag and account by name and an amount through `formatMoney`; rule inputs keep ids and decimal text. Top-level `currency` goes.
- Transfers: `get_transfer_candidates` paged, rows `get_transactions` rows; `pair_transfer` `{ success, transfer: { id, status, outflow_transaction_id, inflow_transaction_id }, message }`; `unpair_transfer` same `transfer`, its message saying whether the pair stays refused; `kind` and `never_propose` keys go.
- Merchants: `create_merchant`, `rename_merchant` answer `{ success, merchant: { id, name, source: "family" }, message }` (`Merchant 'X' created.`, `updated.`), refusing through `validated()` as `create_tag`.
- `group_transactions_by_label`: `groups`, `pageOf`'s fields; each `{ label, count, total, formatted_total, classification, currency, last_date, categories }` (`total` absolute decimal text, category names, `null` for none). The 100-group cap gives way to pages.
- `bulk_update_transactions` answers `{ success, matched, changed, message: "Updated N transactions." }`.
- `decimal()` leaves `mcp/tool.ts`. AD-19 (`docs/architecture.md`) says `create_goal` takes accounts by exact name and no tool answers earlier fields; `INSTRUCTIONS`, `docs/deployment.md` « Connecting an assistant », `docs/security-model.md` « Assistants » name `import_statement_file`; `docs/sure-parity.md` « Imports by an assistant », « Pairing by an assistant », « Savings goals », « Assistant tools » and « Assistant tools for bills » read Parity, Archant's own tools listed with the Sure function each follows and each departure named.

**Never:** no migration; no change to service figures, routes or the interface; no change to tool inputs beyond `create_goal`, paging, and the rename; no `account_holder` (Archant reads none); no Statement Vault; no goal update tool; `get_transaction`'s `counterpart_account` stays (27.10).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Goal by name | `linked_account_names: ["Livret A"]`, `target_amount: 5000` | goal at 500000 minor units, `target_amount_formatted: "5 000,00 €"` | none |
| Namesake | two « Livret A » | nothing written | `ambiguous_accounts` + `available_accounts` |
| Claimed | « Livret A » whole in another goal, no earmark | nothing written | `account_claimed_in_full` |
| Earmark | `earmarks: { "Livret A": 2000 }` | link allocated 200000 | none |
| Reserve | `kind: "maintained"`, `target_months: 6` | target = 6 × median expenses | none |
| Statement | OFX of 12 lines, 2 rejected | `transaction_count: 10`, 5 previews, `statement_period` | none |
| Groups page 2 | 120 labels, `page: 2` | 20 groups, `total_pages: 3` | none |
| Merchant taken | `create_merchant` existing name | nothing written | `validation_failed`, `Name has already been taken` |
| Rule read | rule « Courses » → category id `c1` named « Alimentation » | `value: "Alimentation"` | none |

**Decision (owner, 2026-10-11):** « Comme Sure »: a rule read answers names and formatted amounts while its writes take ids, as Sure's `get_transactions` reads names and `update_transaction` takes ids; a rule read no longer goes back into `update_rule` as it is.

</frozen-after-approval>

## Code Map

- `packages/api/src/mcp/goals.ts` -- `goalOutput`, `get_goals`, `create_goal`; Sure: `app/models/assistant/function/create_goal.rb`, `app/models/goal.rb` (`display_status:817`, `progress_percent:667`).
- `packages/api/src/services/goals.ts` -- `listGoals:174`, `createGoal:516`, `assertFundable:368` (codes `not_fundable`, `currency_mismatch`, `whole_balance_taken` give the refusals), `wholeTakenElsewhere`; `free_to_earmark` = balance less other unreleased goals' allocations (`RELEASED_GOAL_STATES`, `packages/data/goals.ts:50`). `domain/goals.ts:128` `goalProgress`, `canBackGoal`.
- `packages/api/src/services/names.ts:145` `accountsNamed` -- one name, active only; `create_goal` needs every id per name among fundable accounts: add a sibling, not a change.
- `packages/api/src/mcp/imports.ts:79-316` -- `previewOutput`, three tools; `services/imports.ts:83` `ImportPreview` (lines carry dates; period derived in the tool).
- `packages/api/src/mcp/rules.ts` -- `valueOf:70`, eight tools; services untouched.
- `packages/api/src/mcp/transfers.ts`, `merchants.ts`, `transactions.ts:163-205` (grouping), `:406-427` (bulk); reuse `itemOf`, `classificationOf`, `formatMoney`, `decimalOf`.
- `packages/api/src/mcp/tool.ts` -- `pageOf:118`, `validated:230`, `refuse:181`, `RefusalBody:150` (extras), `decimal:129` (delete).
- `packages/api/src/schemas/assistants.ts` -- `createGoalInput:1334`, `importBankStatementInput:1493` (rename, comments), `ruleRunsInput:570`, `groupTransactionsInput:551`, `get_rules` and `get_transfer_candidates` gain paging.
- `packages/api/src/mcp/server.ts:85-133,142-182` -- `TOOLS`, `INSTRUCTIONS`.
- Docs: `docs/architecture.md:201`, `docs/security-model.md:75,85`, `docs/deployment.md:321-333`, `docs/sure-parity.md:139,163,226,245,252`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/mcp/goals.spec.ts`, `imports.spec.ts`, `transfers.spec.ts`, `merchants.spec.ts`, `server.spec.ts` (tool names `:60-115`, `INSTRUCTIONS`, grouping, rules, bulk, merchants) -- failing first: every matrix row, `Object.keys` of each answer and row in order, each refusal's text and extras.
- [x] `packages/api/src/services/names.ts`, `names.spec.ts` -- exact-name lookup over fundable accounts.
- [x] `packages/api/src/schemas/assistants.ts`, `mcp/tool.ts` -- inputs, paging, rename, `RefusalBody`, `decimal()` out.
- [x] `packages/api/src/mcp/goals.ts`, `imports.ts`, `rules.ts`, `transfers.ts`, `merchants.ts`, `transactions.ts` -- answers and refusals.
- [x] `packages/api/src/mcp/server.ts` -- `TOOLS` rename, `INSTRUCTIONS`.
- [x] Docs as Boundaries list; `sprint-status.yaml` key `27-14-archants-own-assistant-tools-in-sures-shapes`.

**Acceptance Criteria:**
- Given `pnpm test`, when both Vitest projects run, then they pass and each of the twenty tools is pinned key by key through the MCP handler.
- Given `pnpm lint:code`, when knip runs, then `decimal()` and anything else this story leaves unused are gone.
- Given « Objectifs », « Règles » and the import dialog, when they load, then they show what they showed before.

## Design Notes

`free_to_earmark` mirrors Sure's `available_accounts`: what a new goal could still reserve. A whole-balance link elsewhere sets `claimed_in_full` and leaves `0,00 €`.

`transactions_preview.amount` stays decimal text, not Sure's float: money is never a float (NFR1), as 27.10's `amount`.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean.
- `pnpm test` -- expected: both Vitest projects pass.
- `pnpm test:e2e` -- expected: green.

## Implementation Notes

- `create_goal` checks in Sure's order in the tool: `fundableAccountsNamed` (new in `services/names.ts`) finds every active fundable account of each exact name, `goalAccountChoices` (new in `services/goals.ts`) gives `available_accounts` and the accounts claimed in full; the service's own refusals become `validation_failed` sentences, Sure's English where its model has the check. A one-off goal given `target_months` is refused by the service as Sure's `months_requires_maintained`. `getGoalsOverview` is gone, `get_goals` no longer reading the card's totals.
- The import preview's lines carry the file's `notes` (`PreviewLine.notes` in `services/ledger/ingest.ts`), so `transactions_preview.notes` gives a CSV or QIF memo; the import routes' preview answers that key too, which the interface ignores. `transactions_preview` merges created lines and possible duplicates in the file's order; `transaction_count` and `statement_period` read every group but the rejected one.
- `transactionsById` (new in `services/transactions.ts`) reads the rows `preview_rule` samples and `get_transfer_candidates` lists, so each answers `get_transactions`' row through `itemOf`. `groupTransactionsByLabel` returns every group; the tool pages them.
- `unpair_transfer` reads the transfer's status first through `getTransferStatus` (`transferStatusOf` in the ledger), since the transfer is gone once unpaired and the routes' answers stay as they were.
- The matrix row « Groups page 2 » reads with 50 groups a page: 120 groups give `total_pages: 3`, page 2 holds 50 and page 3 the last 20; the spec pins pages 1 to 3.
- `noToolInput` is gone, `get_rules` and `get_goals` paging now, and so is `pageFields`, `get_rule_runs` reading its page as `get_categories` does.

## Spec Change Log

- Review pass 1 (blind, verification-gap): `transactions_preview` mixed possible duplicates with lines to create and nothing marked them, while `INSTRUCTIONS` ask the assistant to show them. Amended in code, not by loopback: a `duplicate_lines` extra after `rejected_lines`, as the old `lines.duplicates`. Avoids an assistant confirming an import without naming its possible duplicates. KEEP: Sure's keys first, Archant's extras after.
- Implementation: `PreviewLine` carries the file's `notes` so `transactions_preview.notes` reads them; the import preview routes answer that key too, which the interface ignores. Accepted beside the Never on routes: the only source of the memo.
- Matrix row « Groups page 2 » is inconsistent (20 groups on page 2 cannot give 3 pages of 50); the tests pin 120 groups as 50, 50 and 20 on pages 1 to 3.
- `docs/sure-parity.md` « Savings goals » keeps « Different »: the row also covers the goal screens' own departures; only its assistant sentence now reads Sure's contract.

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---------|---------|----------|-------|
| A reserve with both `target_amount` and `target_months` drops the amount (blind, edge) | medium | `create_goal` sends `months_of_expenses` and the service ignores the amount; `one_target_only` was removed. | patch |
| Possible duplicates unmarked in `transactions_preview` (blind) | medium | `previewOf` merges `created` and `duplicates`; INSTRUCTIONS step 4 asks to show duplicates. | patch |
| Preview with duplicate and matched lines, confirmed unpair, released goals in `goalAccountChoices`, `rename_merchant` taken, reserve with both targets untested (verification-gap, blind) | medium | Each mutation the reviewers describe passes the suite. | patch |
| `linked_account_names` naming one account twice is refused (blind) | low | Sure's `where(name: names)` links it once; Archant's matched list doubles the row. Direct fix. | patch |
| `goalAccountChoices` read twice on the claimed path (blind) | low | Two calls, one `balanceOn` per account each. Direct fix. | patch |
| `target_months` strict while the comment says loose (blind) | low | Comment wrong. | patch |
| `lineOutput.category` says a file gives no category (blind) | low | QIF `L` lines carry one; Archant reads none. | patch: description |
| « 1 transactions » in Archant's own messages (blind) | low | `bulk_update_transactions`, `apply_rules`, `confirm_import`. Sure's extract message stays verbatim. | patch |
| An unreadable or zero earmark links the whole balance (edge) | low | Sure's `parse_earmarks` drops it the same way; decided in the frozen block. | rejected |
| `earmarks` keyed by name collides for two namesake accounts (blind, edge) | low | A goal linked by id in the interface to two same-named accounts; rare, and a fix reshapes the field. | rejected |
| Stored names with surrounding spaces never match (edge) | low | Sure compares the same way after stripping the input only. | rejected |
| A non-string in `linked_account_names` answers Zod's hint (edge) | low | No assistant sends one. | rejected |
| Reserve date refused before service checks run (edge) | low | Sure's own checks also stop at the first refusal. | rejected |
| `delete_rule` deletes then answers NOT_FOUND (blind, edge) | false | `deleteRule` throws NOT_FOUND for an unknown id before deleting; `before` is undefined only for an id no rule had. | rejected |
| `unpair_transfer` invents `pending` when no status is found (blind) | false | An unknown id makes `deleteTransfer` throw NOT_FOUND before the answer is built. | rejected |
| Rows deleted between a service read and `transactionsById` (edge) | low | A race within one request; counts stay the service's. | rejected |
| CSV without mapping answers « Successfully extracted 0 transactions … » (blind) | low | Sure's message verbatim; INSTRUCTIONS step 2 sends the assistant to `preview_import`. | rejected |
| Rule reads give names while `update_rule` takes ids (blind) | false | The owner's decision in the frozen block. | rejected |
| `free_to_earmark` zero when claimed in full (edge) | false | Design Notes say so. | rejected |
| `totals.left_out` gone from `get_goals` (edge) | false | Decided in the frozen block. | rejected |
| Import routes now carry `notes` (blind, edge) | low | Additive key the interface ignores; recorded in the change log. | rejected |
| AD-19 says a tool calls one service; `delete_rule` reads `listRules`, `unpair_transfer` `getTransferStatus` (standards) | low | Neither read was in AD-19's list of exceptions. | patch: AD-19 |
| `confirm_import` sums the counts twice (standards) | low | `imported` already holds it. | patch |
| `savedAsSure` repeats `validated`; candidate and sample rows repeat one chain; `merged`, `readerFor`, two `written` names (standards) | low | Judgement calls; each has two call sites with different messages or shapes. | rejected |
| `positiveText` takes a `number` meaning money (standards) | low | Sure's loose input turned into decimal text at once, as 27.13's `sureDecimalText`; never computed as a float. | rejected |
| `earmarks` or `target_amount` `null` answers Zod's hint rather than being ignored (spec) | low | No assistant sends a null amount. | rejected |
| A reserve with months and an unreadable amount answers « not both » (spec) | low | The message stays true. | rejected |
