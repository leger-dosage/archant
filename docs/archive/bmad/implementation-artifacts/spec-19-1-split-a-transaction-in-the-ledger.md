---
title: 'Story 19.1: Split a transaction in the ledger'
type: 'feature'
created: '2026-10-03'
status: 'done'
route: 'dispatch'
baseline_commit: '31eeb6d1088aa65363b24092752571a91f8207ed'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-19-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A supermarket receipt mixing food and household goods sits in one category, so reports and budgets misstate what was spent on what.

**Approach:** As Sure's `Entry#split!` (at `14638a7`), a split keeps its parent and adds children summing to it: `entries.parent_entry_id`, written only by `services/ledger/splits.ts`; every money reader counts the children and drops the parent; every writer that could break the sum refuses. Story 19.1 of `epics.md` is the acceptance contract; this spec adds what reading Sure and Archant settled. The owner delegated every decision; the ones taken alone are marked « Decided ».

## Boundaries & Constraints

**Always:**
- Schema: nullable `entries.parent_entry_id` `REFERENCES entries(id) ON DELETE restrict` (added by hand in the migration, as `0013`), partial index `entries_parent_entry` on it `WHERE parent_entry_id IS NOT NULL`: SQLite's restrict check and every parent filter read it.
- A parent is « an entry some entry names as parent ». Readers drop it with one non-correlated `entries.id NOT IN (SELECT parent_entry_id … IS NOT NULL)`, defined once in `services/ledger/shared.ts`; the volume plans stay free of `CORRELATED`.
- `splitTransaction(deps, id, lines, { origin })`, `editSplit`, `unsplitTransaction`: one immediate transaction each, balances recomputed from the parent's date. A line is `{ id?, label, amount: MinorUnits, categoryId, tagIds, notes }`; 1 to 50 lines (Decided: Sure has no cap, AD-22 needs one line); sum equal to the parent's exactly, else `VALIDATION_ERROR` on `lines` with code `split_sum_mismatch`; zero and mixed signs allowed, as Sure.
- A child copies account, date, currency and merchant; has `pending`, `excluded`, `possible_duplicate` false, no `import_id`, no key; locks `date`, `amount`, `label`, and `notes`, `category`, `tags` when set, `category_origin` `user`, as a manual entry. The parent gets `excluded: true` and `excluded` locked.
- `NOT_SPLITTABLE` (409) for a transfer side, a pending, excluded, possible duplicate (Decided: resolve it first, or merging would later have to move a parent), parent or child row. `editSplit` and `unsplitTransaction` take the parent or a child (Sure's `resolve_to_parent!`); an unsplit row answers `NOT_FOUND`. A line id that is not a child of that parent fails on `lines.N.id`. Unsplitting keeps `excluded` locked, now `false` (Decided: the user set it).
- `TRANSACTION_SPLIT` (409), new: changing `date`, `amount` or `excluded` of a parent or a child through `updateTransaction` (REST `PATCH` and MCP `update_transaction`); deleting a child alone; merging when either side is a parent or a child. A bulk edit leaves `excluded` of split rows as it is, as it leaves a locked field (Decided). A bulk delete deletes a selected parent with its children and skips a child, as Sure's `bulk_deletions_controller`.
- Readers: `bookedMovements` (balances, bank unlink, snapshot gaps), `filterCondition` (list, count, totals, label groups, bulk filter), `ruleCandidates` (rules, recurring) drop parents. Cash flow and budgets already drop them through `excluded`. `pairCandidates`, `duplicateCandidatesOf` and transfer matching (`matchableSide`, `isTransferCandidate`) drop children; `duplicateCandidatesOf` drops parents too.
- Deletes: `deleteTransactionRows`, `bulkDeleteTransactions`, `revertImport`, `deleteAccount` delete children first in the same transaction; the parent's bank keys are tombstoned as today.
- HTTP: `GET`, `POST`, `PUT`, `DELETE /api/transactions/:id/split` through `services/transactions.ts`, answering `{ parent, children }` (`DELETE`: the parent); amounts are text parsed with the account's currency by `splitTransactionSchema(currency)` in `schemas/transactions.ts`. Rows gain `parentEntryId`.
- Export: `parent_entry_id` exported; `transactions.csv` lists children and unsplit rows, never a parent; `all.ndjson` emits top-level rows only, a parent carrying `split_lines` (Sure's keys: `id`, `entry_id`, `amount`, `currency`, `name`, `notes`, `excluded`, `category_id`, `merchant_id`, `tag_ids`, `kind`, `created_at`, `updated_at`, plus `archant`), ordered by creation; the preflight schema checks their sum.

**Never:** no cascade; no interface but the two error translations (Story 19.2); no MCP split tool (AD-19 forbids deleting through MCP); no QIF split records; no change to valuations; a child never pending, keyed, absorbed or a transfer side.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Split | −100,00 € into −60 food, −40 home | parent excluded, locked; balances unchanged; list, totals, cash flow, budget show −60 and −40 |
| Sum off by 1 cent | lines sum −99,99 | `VALIDATION_ERROR` `lines` `split_sum_mismatch` |
| Not splittable | transfer side, pending, excluded, duplicate, parent, child | `NOT_SPLITTABLE`, nothing written |
| Edit | one child kept by id, one new, one omitted | kept id keeps its tags; omitted one deleted |
| Re-sync | the bank resends the parent's line | `present`, nothing written |
| Child edits | `PATCH` amount, date or exclusion of a child or parent | `TRANSACTION_SPLIT` |
| Delete | parent alone, in bulk, by revert, with its account | children first, parent's bank keys tombstoned |
| Export | one split | CSV: two children; NDJSON: parent with two `split_lines`, preflight passes |

</frozen-after-approval>

## Code Map

- `packages/data/schema/entries.ts` -- add the column (self reference as `categories.ts:33`) and partial index; `pnpm data generate` writes `0042`, `ON DELETE restrict` added by hand.
- `packages/api/src/services/ledger/shared.ts:75` `deleteTransactionRows` -- children first; add the parent condition helper. `balances.ts:67` `bookedMovements`; `filter.ts:174` `filterCondition`; `rule-plans.ts:239` `ruleCandidates`; `entry-keys.ts:121` `pairCandidates`; `duplicates.ts:132,233` candidates and `mergeDuplicate`; `transfers.ts:101` `matchableSide`, `sideColumns`; `domain/transfer-matching.ts:40` `isTransferCandidate`.
- `services/ledger/edits.ts:57` `updateTransaction` (guard after `changeOf`), `:161` delete, `:202` `selectedRows`, `:249` bulk edit, `:371` bulk delete; `patch.ts` `changeOf`, `detailOf`, `editableColumns`, `categoryExists`, `tagsExist`.
- `services/ledger/import-revert.ts:161` `revertImport`, `accounts.ts:93` `deleteAccount`.
- `services/ledger/queries.ts:42,96` `TransactionRecord`, `transactionColumns`; `:447` `countedInCashFlow`; parity tests `queries.spec.ts:483,560`.
- `services/transactions.ts` service pattern (`currencyOf`, `validationError`, `getTransaction`); `routes/transactions.ts` (fixed paths before `/:id`); `schemas/transactions.ts` `fields`, `amountIn`, `MAX_TAGS_PER_TRANSACTION`.
- `lib/errors.ts` `ERROR_STATUSES`; `packages/app/src/locales/fr.json` `errors`.
- `mcp/transactions.ts` `update_transaction`, `get_transactions`; `mcp/server.spec.ts:1585` block.
- `services/ledger/export.ts:89` `EXPORTED_COLUMNS.entries`, `:322` `transactionPage`, `tagsOf`; `services/export.ts:447` CSV, `:652` NDJSON; `testing/sure-preflight.ts:247`.
- `testing/ledger.ts` helpers (`add`, `sync`, `importStatement`, `revert`, `matchedPair`, `lockedFields`); `testing/app.ts` `useSignedInApp`; `services/history-volume.spec.ts` plans.
- Docs: `docs/architecture.md` AD-20, `docs/sure-parity.md:137`, `docs/deployment.md:311`, `docs/security-model.md:52`.

## Tasks & Acceptance

**Execution:**
- [x] `services/ledger/splits.spec.ts` -- first: every matrix row and branch of the module, ledger level.
- [x] Schema, migration, `migrate.spec.ts` if a migration needs a test.
- [x] `services/ledger/splits.ts` -- the three functions and `splitOf` (read).
- [x] Readers and writers listed above, each with a spec beside its file: balances, list and totals, cash flow parity, budgets (`routes/budgets.spec.ts`), rules, recurring, transfers, pairing, duplicates, ingest, every delete, bulk edit.
- [x] `lib/errors.ts`, `fr.json`, `schemas/transactions.ts`, `services/transactions.ts`, `routes/transactions.ts` and spec.
- [x] `mcp/server.spec.ts` -- `get_transactions` and `update_transaction` on a split.
- [x] Export, its two specs and the preflight schema.
- [x] Docs above; `epics.md` and AD-20: transfer matching takes neither a parent nor a child.

**Acceptance Criteria:**
- Given Story 19.1 of `epics.md`, when it ships, then each criterion holds, with this spec's decisions.
- Given `pnpm test`, when it runs, then `services/ledger/**` and `domain/**` stay at 100 % of branches and the volume plans pass.

## Design Notes

AD-20 says the children « count in » transfer matching and also that « a child is never a transfer candidate »; the epic's departures say the latter. Neither side of a split is a transfer candidate: a split of a transfer side is refused, and a child matched as a transfer would leave its parent half moved. `epics.md` and AD-20 are reworded to say so.

Balances count excluded transactions, as Sure's: the parent's exclusion alone would leave it counted twice beside its children, hence the explicit parent filter in `bookedMovements`.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green, ledger and domain coverage at 100 %
- `pnpm test:e2e` (inside the `/tmp/archant-e2e.lock` wrapper) -- expected: green

## Implementation Notes

- A line's `tagIds` and `notes` are optional: absent, a kept child keeps its own and a new one has none, so a dialog that edits label, amount and category never wipes them. `categoryId` is required, `null` included, so an omitted key never clears a category.
- New children are created one millisecond apart, so they keep the order they came in; children created in the same millisecond by two writes order by id.
- `notSplitParent` is `entries.id not in (select parent_entry_id …)` built with Drizzle's `QueryBuilder` on an alias, so the subquery never resolves to the outer `entries`.
- `transactionPages(db, view)` takes `"lines"` for `transactions.csv` and `"nested"` for `all.ndjson`; the volume plan test reads `"lines"`.
- A user's child also locks `excluded`: without it a rule could exclude a line the user could never include again, since `updateTransaction` refuses that change on a split and `editSplit` sends no exclusion.

## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| self-review | A rule could exclude a child, which `updateTransaction` then refuses to include again and `editSplit` never touches | medium | `applyRulePlan` guards exclusion only through locks; children locked no `excluded` | patched: a user's child locks `excluded`; `rule-plans.spec.ts` covers it |
| blind, thermo | `export.spec.ts` expects a child's locks without `excluded` | high | One failing test after the self-review patch | patched |
| blind, thermo | `MAX_SPLIT_LINES`' comment claims 50 lines stay under the 64 KB body limit | low | 50 notes of 2,000 characters exceed it; the route answers `PAYLOAD_TOO_LARGE` | patched: comment corrected; the limit stays, a receipt never nears it |
| blind, edge | A split with a non-user origin locks nothing, so a rule could exclude its child | low | No production caller splits with another origin; AD-10 locks only for `user` | rejected |
| blind, edge, thermo | A bulk delete by filter skips every split line, deleting fewer rows than the list showed | low | Matches the frozen decision and Sure's `bulk_deletions_controller`; nothing is lost, and expanding a line to its whole split deletes more than selected | rejected |
| blind | `epic-19-context.md` still counts children among transfer candidates | low | Lines 19 and 22 contradicted the reworded AD-20 | patched |
| blind | Refusing a possible duplicate departs from Sure's `splittable?` without a record | low | Absent from `docs/sure-parity.md` | patched: the parity row says so |
| blind | `split_sum_mismatch` and `not_a_child` have no French translation | low | `fr.json` `errors.fields` lacked them | patched; `too_small`/`too_big` wording on `lines` is Story 19.2's dialog |
| blind | MCP items expose no split marker; `excluded`'s description misstates a parent's balance | low | `get_transactions` never lists a parent, and the tool description names `TRANSACTION_SPLIT` | rejected |
| blind | Unsplitting leaves `excluded` locked | low | Frozen decision; Sure's `unsplit!` keeps `user_modified` too | rejected |
| blind, verification-gap | No plan assertion pins the partial index behind `notSplitParent` | medium | `history-volume.spec.ts` checked only `CORRELATED`; `sqlite3` shows `SEARCH split_child USING COVERING INDEX entries_parent_entry` | patched: asserted in the totals plan |
| blind, edge | `splitItemOf` reads the split after the write commits | false | A concurrent delete makes `getTransaction` throw `NOT_FOUND`, a 404, never a 500; `createTransaction` reads back the same way | rejected |
| edge | A new line placed between kept lines comes back last after an edit | low | Kept children keep their `createdAt`; a dialog appends new lines at the end | rejected |
| verification-gap | No test sends `excluded: false` by id to a parent in a bulk edit | medium | The existing test never selected the parent with `false` | patched: asserted `{ matched: 1, changed: 0 }` |
| verification-gap | A bank line tied between a parent and another entry is flagged, but the parent is no merge candidate | low | Needs two same-amount entries in the window; unsplit, merge and split again resolves it | rejected |
| thermo | `countByMerchant` and `countByCategory` count a parent beside its lines | low | Counts of rows a merge or delete will touch, which include the parent; no amount | rejected |
| thermo | `editSplit`'s comment says it throws as `splitTransaction` does | low | It never throws `NOT_SPLITTABLE` | patched |
