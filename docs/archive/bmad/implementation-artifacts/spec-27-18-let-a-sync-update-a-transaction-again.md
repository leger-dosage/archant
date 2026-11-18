---
title: "Story 27.18: Let a sync update a transaction again"
type: 'feature'
created: '2026-10-12'
status: 'done'
baseline_commit: '7c797abef7ad1ca88d3b81ce20936277e2656ebc'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A field the owner sets by hand is locked for good: no rule and no booked version ever reaches it again, where Sure's protection indicator shows the locks and `unlock_for_sync!` clears them. Locks also keep no time, so Archant cannot say when each was set. Sure read at `origin/main` `275f2f994`.

**Approach:** `transactions.locked_fields` becomes Sure's `locked_attributes` shape, each field with its lock time; the sheet shows Sure's folded block, and `POST /api/transactions/:id/unlock` clears every lock at once.

## Boundaries & Constraints

**Always:**
- `locked_fields` is a JSON object, `{ "<field>": <epoch ms> | null }`, default `{}`; the keys stay `LOCKABLE_FIELDS`. A migration turns each existing array into an object whose values are `null`. A `user` write stamps each field it locks with the write's time, a re-edit renewing it, as Sure's `lock_attr!`; any other origin never adds or changes a key (AD-10).
- The sheet shows the block for every reader when the transaction has at least one lock and is not excluded, as Sure's `protected_from_sync? && !excluded?`: a native `<details>`, closed, summary « Protégée contre la synchronisation » with a lock icon, then « Vos modifications sur cette entrée ne seront pas écrasées par la synchronisation du fournisseur. », « Champs verrouillés : » and one row per lock, the field's French name and, when a time is known, its date as `longDate` writes it (« 13 septembre 2026 »). Names: « Date », « Montant », « Libellé », « Notes », « Exclue des rapports », « Catégorie », « Marchand », « Étiquettes ».
- For an administrator only, « Autoriser la mise à jour par la synchronisation » opens a `ConfirmDialog` reading Sure's « Autoriser la synchronisation à mettre à jour cette entrée ? Vos modifications pourraient être écrasées lors de la prochaine synchronisation. »; confirming calls the route and toasts « Entrée déverrouillée. Elle pourra être mise à jour lors de la prochaine synchronisation. »; the block then disappears.
- `POST /api/transactions/:id/unlock` sets `locked_fields` to `{}` in one update and answers the transaction as `GET` reads it; an unknown id answers `NOT_FOUND`; a viewer is refused by `viewerReadOnly`. It touches no other column: `category_origin` stays.
- A transaction row whose transaction shows the block carries a lock icon, visible on hover and focus, titled « Protégée contre la synchronisation », as Sure's `_transaction.html.erb`; the row itself still opens the sheet, so the icon is no second control.

**Never:** no per-field unlock (Sure's indicator has none); no change to which writes lock or to how syncs and rules respect a lock; no assistant tool, Sure has none; no rule « ignore locks » re-apply.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Migrated lock | `["category"]` before 0070 | `{"category":null}`; the row shows « Catégorie » without a date | none |
| Hand edit | category set on 2026-10-12 | `{"category":<ms>}`; row « Catégorie … 12 octobre 2026 » | none |
| Unlock then rule | locked category, unlock, rule sets another | the rule's category applies | none |
| Imported line | no lock | no block, no icon | none |
| Excluded line | `excluded` locked, excluded | no block, no icon | none |
| Viewer | any lock | block without the button | POST answers 403 |
| Unknown id | POST `/api/transactions/x/unlock` | nothing written | 404 `NOT_FOUND` |

</frozen-after-approval>

## Code Map

- `packages/data/schema/transactions.ts:14-25,68` -- `LOCKABLE_FIELDS`, `LockableField`, the column; add `LockedFields`, default `'{}'`.
- `packages/data/drizzle/` -- next is `0070`; `pnpm data generate` rebuilds the table for the new default, then append the hand `UPDATE … json_group_object(value, NULL) FROM json_each(…)` with a comment, as `0058_loan_terms.sql`. `packages/data/migrate.spec.ts` tests with `migratedBefore("0070")`; its fixtures at 154, 574, 632, 701, 755, 2030 stay arrays.
- `packages/api/src/services/ledger/shared.ts:25-37` -- `lockedBy(origin, current, fields, now)` returns the object.
- `packages/api/src/services/ledger/patch.ts:77-91,141,185-188` -- `editableColumns`, `changeOf` (key present = locked), `detailOf`.
- `packages/api/src/services/ledger/ingest.ts:853-855,867,977`, `splits.ts:196-226,332,415`, `trades.ts:597,711` -- the other writers.
- `packages/api/src/domain/rules/matching.ts:147,292` -- `RuleCandidate.lockedFields`, `locked()`.
- `packages/api/src/services/ledger/pending.ts:97-130` -- reads through `changeOf`; no change expected.
- `packages/api/src/services/ledger/export.ts:188`, `services/export.ts:620` -- `archant.locked_fields` emits the object, times as ISO 8601, `null` kept.
- `packages/api/src/services/ledger/queries.ts:38-72,99-115` -- `TransactionRecord`, `transactionColumns`: add `lockedFields`.
- `packages/api/src/services/ledger/duplicates.ts:376` (`dismissDuplicate`), `services/transactions.ts:720`, `routes/transactions.ts:83` -- the action pattern to copy.
- `packages/api/src/testing/ledger.ts:122`, `routes/transactions.spec.ts:53-58` -- `lockedFields`, `locksOf`: return the keys, so existing `toEqual([...])` assertions hold.
- `packages/app/src/components/TransactionForm.tsx:104,293-312` -- where the blocks render; `TransactionLinks.tsx:164` `DuplicateBlock` for mutation, toast and `admin`; `LoanDetailsFields.tsx:235-245` the `<details>` pattern; `ConfirmDialog.tsx`.
- `packages/app/src/components/TransactionList.tsx` -- the row's trailing cell for the icon.
- `packages/app/src/hooks/useDuplicates.ts` -- `useDismissDuplicate`, the hook to mirror.
- `packages/app/src/lib/dates.ts:87` -- `longDate`; `toIsoDate` turns the lock time into the local day.
- `packages/app/src/locales/fr.json:281-421` -- `transactions.*`; `form` holds the field names to reuse.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/migrate.spec.ts` -- first: arrays, empty and full, become objects with `null` values.
- [x] `packages/api/src/services/ledger/edits.spec.ts`, `ingest.spec.ts` -- first: a hand edit stamps the time, a re-edit renews it, a `rule` or `sync` write leaves the object unchanged.
- [x] `packages/api/src/routes/transactions.spec.ts` -- first: unlock clears every lock and answers `lockedFields: {}`; 404; viewer 403; anonymous 401; a rule then sets the category it could not before.
- [x] `packages/data/schema/transactions.ts`, `packages/data/drizzle/0070_*.sql` -- the shape and the migration.
- [x] `ledger/shared.ts`, `patch.ts`, `ingest.ts`, `splits.ts`, `trades.ts`, `domain/rules/matching.ts`, `testing/ledger.ts` -- the object everywhere.
- [x] `ledger/edits.ts`, `services/transactions.ts`, `routes/transactions.ts`, `ledger/queries.ts` -- `unlockTransaction` and the route; `lockedFields` in the record.
- [x] `ledger/export.ts`, `services/export.ts`, `export.spec.ts` -- the exported object.
- [x] `packages/app/src/components/TransactionProtection.tsx`, `TransactionForm.tsx`, `TransactionList.tsx`, `hooks/useDuplicates.ts` or `useTransactions.ts`, `locales/fr.json` -- the block, the icon, `useUnlockTransaction` invalidating `queryKeys.transactions.all`.
- [x] `packages/app/e2e/transactions.spec.ts` -- a hand-typed line shows the block with « Libellé », « Montant », « Date »; unlock, confirm, toast, block gone; `viewer.spec.ts`: block without the button.
- [x] `docs/architecture.md` AD-10, `docs/sure-parity.md:137` -- AD-10: an object of lock times, the owner unlocks every field at once; the row Parity, Story 27.18.

**Acceptance Criteria:**
- Given a transaction unlocked, when the owner edits its label, then only `label` is locked again, with the new time.
- Given an export, when it is written, then `archant.locked_fields` holds each field's time or `null`.

## Design Notes

Sure's indicator shows on `user_modified? || import_locked?`, flags Archant does not have: AD-10 locks per field, and a hand edit always locks at least one, so « at least one lock » is Archant's equivalent. Sure's field names fall back to English (« Name », « Tag ids »), having no `activerecord.attributes.entry` keys; the epic's rule gives the French word instead.

Sure shows the button to every member and refuses the click server-side; `AGENTS.md` hides a writing control from a viewer, as the story says.

Times are epoch milliseconds, as every Archant timestamp column; only the export writes ISO text, Sure's stored form.

## Verification

**Commands:**
- `pnpm --filter @archant/data exec vitest run migrate.spec.ts` -- expected: pass.
- `pnpm --filter @archant/api exec vitest run src/services/ledger src/routes/transactions.spec.ts src/domain/rules` -- expected: pass.
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- expected: all green.

**Manual checks (if no CLI):**
- Screenshots, light and dark: the closed and open block, the confirmation, a row's lock icon on hover.

## Implementation Notes

- Migration `0070_locked_field_times.sql`: drizzle-kit's table rebuild for the `'{}'` default, then the hand `UPDATE` turning each array into an object of `null` times.
- `detailOf` takes the write's `now`; the bulk edit reads it once, so rows locking the same fields still share one statement.
- Specs that read `locked_fields` in raw SQL select `json_group_array(key)` over it, so their array-text assertions hold; `lockedFields` in `testing/ledger.ts` returns the keys and `lockTimes` the object.
- The interface lists the locks in the order they were taken, as Sure iterates `locked_attributes`; the row's lock carries an `sr-only` name beside its `title`.
- After review: `detailOf` writes the locks as one `json_set` over `locked_fields`, stamping only the changed fields with `cast(now as integer)`, since libSQL binds a JS number as a real; any origin but `user` leaves the column unwritten. `writeKeyOf` groups a bulk edit's and a rule's rows without the SQL, and an empty `set` is skipped. `protectedFromSync` and `listedLocks` live in `packages/app/src/lib/locked-fields.ts`, tested there. The e2e date is formatted in `TIME_ZONE`. `docs/sure-parity.md` records the viewer's missing button; `docs/deployment.md` and `docs/security-model.md` name the unlock.
- After the standards and spec review: `applyRulePlan` groups with `writeKeyOf` too; a split edit keeping a child unchanged writes nothing on it, now tested, which the ledger's 100 % branch threshold required.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | blind, edge | Per-row lock times break the `JSON.stringify(detail)` grouping of `bulkUpdateTransactions` and `applyRulePlan`: one UPDATE per hand-typed row | medium | Each row's lock object carries its own times, so no two keys match; a rule over thousands of locked rows runs thousands of statements | patch |
| 2 | blind, edge | A `rule` or `sync` write rewrites the lock object it read | low | Reads and writes share one SQLite transaction, so no unlock lands between them; omitting the key for non-user origins is part of the fix to 1 | patch |
| 3 | blind | The 5,000-row bulk test seeds no locked rows, so it misses 1 | medium | Its rows have `lockedFields` `{}` | patch |
| 4 | blind | The generated `0070_snapshot.json` is absent from the reviewed diff | false | Left out of the review diff on purpose as generated; it is added to the index | reject |
| 5 | blind | Sprint status says `in-progress` while the spec says `in-review` | false | Both move to `done` at the end of the review | reject |
| 6 | blind | An excluded line's locks can be cleared only through the API | false | Sure's indicator has the same `!excluded?` condition, frozen in the intent | reject |
| 7 | blind | No test times the locks written by splits and trades | low | They go through `lockedBy`, whose timing `edits.spec.ts` and `ingest.spec.ts` cover; a test per caller adds little | reject |
| 8 | blind, gap | Matrix rows « Imported line », « Excluded line » and « Migrated lock » have no interface test | medium | Removing `!transaction.excluded` or the `at !== null` guard fails no test | patch |
| 9 | blind, edge | The e2e date is formatted in the runner's zone, the page in `TIME_ZONE` | medium | On a UTC runner between 22:00 and 24:00 UTC the expected day is off by one | patch |
| 10 | blind | `docs/sure-parity.md` says Parity although a viewer gets no button, where Sure shows it | low | The departure is real and the page exists to record departures | patch |
| 11 | blind | `docs/deployment.md` does not describe the new shape of `archant.locked_fields` | low | The paragraph never described the old shape either; it names locks only | reject |
| 12 | blind | `docs/deployment.md:325` and `docs/security-model.md:75` present the lock as permanent | low | Both say a field set is locked against rules, with no way back | patch |
| 13 | edge | A lock object holding only non-lockable keys shows an empty block | false | Only `lockedBy` writes keys, typed `LockableField`; the migration converts arrays of those | reject |
| 14 | edge | Unlocking then editing in the same sheet leaves the block hidden | false | Saving closes the sheet (`TransactionSheet.tsx:149`), and reopening remounts the form | reject |
| 15 | edge | The unlock does not touch `entries.updated_at` | false | No transaction-only write does: `updatedAt` moves only with the entry's date or amount (`edits.ts:145`) | reject |
