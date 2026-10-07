---
title: 'Story 16.4: Ask an assistant to classify my transactions'
type: 'feature'
created: '2026-10-03'
status: 'done'
route: 'dispatch'
baseline_commit: 'b0d825c83cab16996e5b118b0057ab18c61f9ca3'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-16-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An assistant connected through `/api/mcp` can write and apply rules, but cannot set the category, merchant, tags or notes of the lines no rule covers, nor tidy a category, merchant or tag name.

**Approach:** Add five `archant:write` tools: `update_transaction`, `bulk_update_transactions`, `rename_category`, `rename_merchant`, `rename_tag`. Each calls the service function the transaction sheet, the bulk bar or « Réglages » calls, with `origin: "user"` for transactions. Story 16.4 of `epics.md` is the acceptance contract; this spec adds what reading the code settled.

## Boundaries & Constraints

**Always:**
- Inputs are `z.strictObject`s in `schemas/assistants.ts`; tools live in `mcp/transactions.ts`, `mcp/categories.ts`, `mcp/merchants.ts`, `mcp/tags.ts`, listed in `TOOLS` after `createTagTool`. Every write tool is `archant:write`.
- `update_transaction` takes `id` and any of `categoryId` (nullable), `merchantId` (nullable), `tagIds` (the whole set, replacing it), `notes` (nullable), `label`, `excluded`; never `date` or `amount`: amounts come from banks, and a label an injection wrote must not move money. It calls `updateTransaction` of `services/transactions.ts`, whose ledger call already passes `origin: "user"`, so each changed field is locked. It returns `get_transaction`'s output, annotations `REPLACES`, description ending with `BANK_TEXT`, `changedRows: 1`.
- `bulk_update_transactions` takes `patch` (`categoryId`, `merchantId`, `addTagIds`, `excluded`, as `bulkPatchSchema`) and exactly one of `ids` (1–200, `bulkIds`' rules) or `filter` (the tool filter of `get_transactions` without its page, the `groupTransactionsInput` shape). `expectedCount` is required with `filter` and refused with `ids`. Annotations `REPLACES` (`destructiveHint: true`).
- The count check runs in the ledger's transaction, after `selectedRows` and before any write: a count other than `expectedCount` throws `BULK_COUNT_STALE` (409, `params.count` the count now) and writes nothing. Only the count is compared, as `apply_rules` does.
- The ledger's `bulkUpdateTransactions` returns the selected and the changed counts; `services/transactions.ts` keeps `updated` and adds `changed`. The tool returns `{ matched, changed }` and records `changed` as `changedRows`.
- `rename_category` (`categoryId`, `name`) calls `updateCategory` with `{ name }`; `rename_merchant` (`merchantId`, `name`) calls `renameMerchant`; `rename_tag` (`tagId`, `name`) calls `renameTag`. Names parse with the schemas « Réglages » uses; a taken name answers `VALIDATION_ERROR` `name_taken`, an unknown id `NOT_FOUND`. Annotations `REPLACES`, `changedRows: 1`.
- `INSTRUCTIONS` gains: prefer a rule when a label repeats, since it also sorts the next ones; `update_transaction` locks the fields it sets against rules; before a bulk update by filter, call `get_transactions` with that filter, show the owner `total` and pass it as `expectedCount`; on `BULK_COUNT_STALE`, read again and show the owner.

**Never:** no new route or screen; the bulk bar sends no `expectedCount`; no rename of a category's kind, colour, icon or parent; no delete, merge or create of a transaction; no date or amount edit.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Lock | `update_transaction` sets `categoryId`, then `apply_rules` with a rule setting another category | the category stays; `apply_rules`' changed count leaves it out |
| Clear | `categoryId: null` | uncategorised, field locked |
| Bulk by ids | 3 ids, `addTagIds` | `matched: 3`, tags added beside the existing ones |
| Bulk by filter | filter and `get_transactions`' `total` | written; `matched` equals that `total`, all currencies included |
| Stale count | filter, `expectedCount` off by one | `isError` `BULK_COUNT_STALE` with the count now, nothing written |
| Missing count | filter without `expectedCount` | `VALIDATION_ERROR` on `expectedCount` |
| Unknown id | one of `ids` missing | `VALIDATION_ERROR` on `ids`, nothing written |
| Name taken | `rename_tag` to another tag's name, case aside | `VALIDATION_ERROR` `name_taken` |
| Read-only token | any of the five | `403 insufficient_scope`, recorded, nothing written |

</frozen-after-approval>

## Code Map

- `packages/api/src/mcp/transactions.ts` -- `transaction`, `itemOf`, `getTransactionTool`: factor its full mapping so `update_transaction` returns the same output.
- `packages/api/src/mcp/tool.ts` -- `REPLACES`, `BANK_TEXT`, `defineTool`.
- `packages/api/src/mcp/server.ts:61` `TOOLS`, `:89` `INSTRUCTIONS`; `call()` already sends `failure.params` to the assistant.
- `packages/api/src/schemas/assistants.ts` -- `toolFilterFields`, `groupTransactionsInput` (reuse for `filter`), `createCategoryInput` (name rule via `createCategorySchema.pick`), `createMerchantInput`, `createTagInput`.
- `packages/api/src/schemas/transactions.ts` -- `bulkPatchSchema`, `MAX_BULK_IDS`, `bulkIds` (export it), `updateTransactionSchema` (parsed inside the service; the tool passes the raw fields).
- `packages/api/src/services/transactions.ts:464` `updateTransaction`, `:533` `bulkUpdateTransactions`, `selectionOf`, `filterOf`.
- `packages/api/src/services/ledger/edits.ts:242` `bulkUpdateTransactions`, `selectedRows`: add `expectedCount` to `options`, count `changed` rows.
- `packages/api/src/services/rules.ts` `assertExpected` -- the pattern for `BULK_COUNT_STALE`.
- `packages/api/src/lib/errors.ts` -- add `BULK_COUNT_STALE: 409` beside `RULE_PREVIEW_STALE`; `packages/app/src/locales/fr.json:1261` its translation.
- `packages/api/src/services/categories.ts:175` `updateCategory`; `services/merchants.ts:98` `renameMerchant`; `services/tags.ts:88` `renameTag`.
- Tests: `mcp/server.spec.ts` (`WRITE_TOOLS` `:67`, `writer()`, `callTool`, `outcomes`, `callsRecorded`); `services/ledger/edits.spec.ts:737`.
- Docs: `docs/deployment.md:301`, `docs/security-model.md:52`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/services/ledger/edits.spec.ts`, `edits.ts` -- first: stale count by filter writes nothing, matching count writes, changed count leaves unchanged rows out; then `expectedCount` and the changed count.
- [x] `packages/api/src/lib/errors.ts`, `packages/app/src/locales/fr.json` -- `BULK_COUNT_STALE`.
- [x] `packages/api/src/services/transactions.ts` -- `bulkUpdateTransactions` passes `expectedCount`, returns `changed`; the route's payload gains it.
- [x] `packages/api/src/schemas/assistants.ts` -- the five inputs, with descriptions.
- [x] `packages/api/src/mcp/transactions.ts`, `categories.ts`, `merchants.ts`, `tags.ts`, `server.ts` -- the tools, `TOOLS`, `INSTRUCTIONS`.
- [x] `packages/api/src/mcp/server.spec.ts` -- each matrix row through the handler; `WRITE_TOOLS` updated; each write recorded in `assistant_calls` with its count.
- [x] `docs/deployment.md`, `docs/security-model.md` -- the five tools, the lock, the count guard.

**Acceptance Criteria:**
- Given Story 16.4 of `epics.md`, when the story ships, then each of its criteria holds, with the revisions this spec records.
- Given a write token, when `tools/list` runs, then the five tools are listed with `destructiveHint: true` and an object `outputSchema`.

## Design Notes

`expectedCount` compares with `get_transactions`' `total`, which counts every currency. `transactionTotals` and `selectedRows` share `filterCondition`, so the two agree; a test pins it with an account in another currency.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green, the ledger's count guard covered to the branch
- `pnpm test:e2e` -- expected: green, nothing in the interface changed

**Manual checks:**
- Claude Code on a throwaway server: « Classe mes opérations sans catégorie de septembre », « Renomme le marchand AMZN en Amazon ».

## Implementation Notes

- Refusal codes of `bulk_update_transactions`' input: neither or both selections answer `ids_or_filter` on `ids`; a filter without its count `required` on `expectedCount`; a count beside ids `filter_only` on `expectedCount`. The patch is `bulkPatchSchema.strict()`, so a misspelt key is refused rather than dropped.
- `update_transaction` refuses a patch with every field absent with `empty_patch`, as the bulk patch does. Only that case is refused: a patch repeating the values already there is accepted and still records `changedRows: 1`.
- The bulk route's payload is now `{ updated, changed }`; the bulk bar still reads `updated` only.

## Spec Change Log
- Owner rule of 2026-10-07, settled for the field names: every assistant tool names its input and output fields in snake case, Sure's names where Sure's function has the field, the snake case of Archant's own otherwise, so the server uses one style throughout; a refusal names the tool's field. The HTTP API keeps camel case. KEEP: amounts as decimal strings (money). Here: `update_transaction` takes Sure's `name`, `category_id`, `merchant_id` and `tag_ids`; `bulk_update_transactions` takes `expected_count` and a `patch` of `category_id`, `merchant_id`, `add_tag_ids`; `rename_category` and `rename_tag` became Sure's `update_category`, by `id` and `name`, and `update_tag`, by `id` and `new_name` where Sure finds the tag by its current `name`; `rename_merchant`, which Sure lacks, takes `merchant_id`.

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| blind, edge | `update_transaction` and the `rename_*` tools record `changedRows: 1` when the values are already there | low | The ledger's `updateTransaction` returns `updated` without reporting what changed; only the call record overstates | rejected: needs a new ledger result for an informational count |
| edge | The tool descriptions and `INSTRUCTIONS` say every field set is locked; a value already there stays unlocked | low | `changeOf` locks only changed fields, as the interface does | patched: "each field it changes is locked", both tools named |
| blind | `filter ?? {}` would select every transaction if the input refinement regressed | low | `superRefine` refuses neither-or-both and is tested; `toSelection` does the same | rejected |
| blind | A filter bulk has no cap and `{}` selects everything | false | The bulk bar's « Tout sélectionner » does the same; `expectedCount` and the owner's agreement are the guard the story chose | rejected |
| blind | `INSTRUCTIONS` asks for the owner's agreement only before a filter bulk | low | Two tools write without that line | patched: tell the owner before `update_transaction` or a bulk by ids |
| blind | `security-model.md` omits what an injected label can still make a writer do | low | Exclusion and label rewrite remain possible | patched: one sentence |
| blind | `BULK_COUNT_STALE`'s message implies row identity is checked | low | Only the count is compared | patched |
| blind | Spec and sprint status disagree | false | Mid-workflow states; completion sets both | rejected |
| blind | A test asserts locked fields in order | low | The stored order is deterministic | rejected |
| blind | The read-only test checks only some rows | false | The 403 is returned before any tool runs, for every tool, and recorded | rejected |
| blind | `deployment.md` says the bulk tool "excludes" | low | It sets or clears the exclusion | patched |
| blind | `update_transaction`'s input does not state the service's length limits; the bulk description hard-codes 200 | low | Limits answer field codes the assistant can correct | patched: `MAX_BULK_IDS`; limits rejected |
| blind | No test pins that the same count on other rows passes | low | Documented limitation, as for `apply_rules` | rejected |
| edge | A child category added between `filterOf` and the ledger transaction escapes the count | low | Same window as the bulk bar; needs a concurrent category edit | rejected |
| edge | `rename_category` rewrites the children's `updatedAt` yet records 1 | low | `updateCategory` as « Réglages » calls it | rejected |
| edge | The implementation note claims a no-op call never records 1 | low | A same-value patch still does | patched: note corrected |
| verification-gap | No MCP test has `changed` below `matched` | medium | Every route and MCP case had both equal | patched: a bulk by ids with one row already categorised |
| verification-gap | Nothing pins that `sumTransactions`' count equals the bulk selection with transfer sides | medium | Two SQL forms of the transfer side, `joinedTransferSide` and `correlatedTransferSide` | patched: `filter.spec.ts` with a transfer pair and a loan payment |
