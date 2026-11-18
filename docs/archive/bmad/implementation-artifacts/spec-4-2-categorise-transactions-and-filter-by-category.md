---
title: 'Story 4.2: Categorise transactions and filter by category'
type: 'feature'
created: '2026-09-23'
status: 'done'
baseline_commit: '681a14799029f287b3ab47495fe4b3b3fb55bbf6'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/scaffolding-lessons.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Categories exist since Story 4.1, but no screen sets one on a transaction and the list cannot be narrowed to a category, so the user cannot tell what they spend on (FR21, FR23).

**Approach:** Extend the transaction PATCH with `categoryId`, lock the category when the user sets it and record `category_origin`, add a repeated `category` filter to the list, then give every row a category chip that opens a searchable combobox in place, saving optimistically with an undo toast.

## Boundaries & Constraints

**Always:**
- `transactions.category_origin`: text, `user` | `rule` | `provider` | null, check constraint from `CATEGORY_ORIGINS` in `@archant/data`, plus a check that it is null exactly when `category_id` is null. Existing rows get null.
- `LOCKABLE_FIELDS` gains `"category"`. `ledger.updateTransaction` takes `categoryId` in `TransactionPatch`, loops over `LOCKABLE_FIELDS` instead of its hard-coded list, and writes `category_origin` as the call's origin (`user` here), or null when the category is cleared. Clearing a category by hand locks it too, as in Sure.
- A change that touches only the category writes `transactions` alone: no `entries` update, no balance recompute.
- The category's existence is checked inside the same `immediate` transaction as the write. Unknown id: `400 VALIDATION_ERROR`, field `categoryId`, code `invalid_value`.
- `recategorise` (merge, delete with replacement) keeps `category_origin`; a delete without replacement sets it to null with the id. Locks stay untouched (AD-10).
- List rows gain `categoryId`. The interface resolves name and colour from the cached `useCategories` list, so the payload stays flat and the optimistic update is one field.
- Filter `category` repeats like `account`, capped at the same size; the value `none` means « Sans catégorie ». Several values are ORed. A parent selects its children too, as in Sure: the service expands parent ids from `categories` before calling the ledger. An unknown id matches nothing. Count and sum join `transactions` when this filter is set.
- Row chip: 8 px dot in the category colour, then the name; uncategorised shows a dashed outline dot and « Sans catégorie ». The chip is a sibling button of the row's open button, never nested inside it.
- Combobox (Popover + `Command`): « Sans catégorie » first, then parents sorted with `Intl.Collator("fr")`, each followed by its children indented. Type to filter, arrows, `Enter`. The current category is marked.
- Picking saves at once: optimistic `setQueriesData` over `queryKeys.transactions.all`, success toast « Catégorie modifiée » with an « Annuler » action that PATCHes the previous `categoryId`; failure rolls back and shows `showErrorToast`; settle invalidates.
- `c` on a focused row opens its combobox, listed in `lib/shortcuts.ts` and shown in the chip's tooltip. Below 768 px the chip moves to a second line under the label.
- The transaction sheet gains a Catégorie field using the same combobox, saved with the rest of the form.
- The `/operations` filter bar gains a « Catégorie » kind and chip; its editor follows `AccountEditor`: checkboxes, « Sans catégorie » first, then the tree, and « Appliquer ».

**Never:** no category filter on `/comptes/$accountId`, which has no filter bar. No inline category creation, no "recent categories" group, no multi-row categorising (Story 4.5), no merchant or tags. No `services/classification.ts` yet: one existence check does not need a module. Do not regroup the 4.1 delete and merge pickers (deferred item).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Set by hand | PATCH `{ categoryId: C }` | `category_id = C`, `category_origin = user`, `category` in `locked_fields`, balances untouched | — |
| Clear by hand | PATCH `{ categoryId: null }` | Both null, `category` locked | — |
| Other origin on locked category | `updateTransaction(..., { origin: "rule" })` | Category unchanged | — |
| Unknown category | PATCH `{ categoryId: "x" }` | Nothing written | `400`, `categoryId`, `invalid_value` |
| Parent filter | `?category=P`, P has child K | Rows on P and on K | — |
| Mixed filter | `?category=none&category=C` | Uncategorised rows and rows on C | — |
| Merge after hand set | Source S locked, `user` | Row on target, still `user`, still locked | — |
| Delete without replacement | Row on C, `user` | Both null, lock kept | — |

</frozen-after-approval>

## Code Map

- `packages/data/schema/transactions.ts` -- `LOCKABLE_FIELDS`, `categoryId`; add `categoryOrigin` and the two checks (`inList`, `schema/check.ts:10`). Put `CATEGORY_ORIGINS` beside `CATEGORY_KINDS` in `schema/categories.ts`.
- `pnpm data generate --name add_category_origin` -- produces `drizzle/0012_add_category_origin.sql`. A check on an existing table rebuilds it, as 0007 did; keep the `ON DELETE restrict` 0011 restored by hand.
- `packages/data/migrate.spec.ts:267` -- `migratedBefore(tag)` rebuild pattern with `pragma_foreign_key_check`; categories block at 434.
- `packages/api/src/services/ledger.ts` -- `Origin` L59, `TransactionPatch` L868, `transactionRow` L878, `updateTransaction` L907 (hard-coded field list L921, lock merge L958), `recategorise` L1005 (comment L1011 to update), `transactionColumns` L1344, `TransactionFilter` L1408, `filterCondition` L1452, count and sum joins L1502 and L1537.
- `packages/api/src/services/ledger.spec.ts` -- `lockedFields` helper L253; `updateTransaction` locks L1732-1853; `recategorise` L2753; list tests L1921-2099.
- `packages/api/src/services/categories.ts:73` -- `findCategory` is private; export a check usable inside the ledger's transaction, and a helper expanding parent ids to their children.
- `packages/api/src/schemas/transactions.ts` -- `transactionPatchBodySchema` L22, `updateTransactionSchema` L78, `transactionFilterSchema` L176 (`account` repeated-key pattern, `MAX_ACCOUNT_FILTER`).
- `packages/api/src/services/transactions.ts` -- `listAllTransactions` L173 maps the query, `updateTransaction` L243 calls the ledger with `origin: "user"`.
- `packages/api/src/app.spec.ts` -- `request` L246, `listOwn`/`listed` L737-744, `listItem` shape ~L715, PATCH tests L621-715, list tests L771.
- `.oxlintrc.json:72-75, 230` -- only `ledger.ts` imports `schema/transactions`; stay inside that rule.
- `packages/web/src/lib/transaction-filters.ts` -- schema L19-57, `FILTER_KINDS` L64, `PARAMS_OF` L68, `toApiQuery` L95, `ChipKey` L107, `filterChips` L153: one entry each for `category`.
- `packages/web/src/components/TransactionFilters.tsx` -- `AccountEditor` L68-118 to copy; chips L346-364.
- `packages/web/src/components/TransactionList.tsx:70-98` -- the row is one `<button data-transaction-id>`; restructure into a container with the open button and the chip button. `hooks/useListNavigation.ts:23-38` finds rows by that attribute.
- `packages/web/src/routes/_authed.reglages.categories.tsx:50-55, 87-137` -- dot and parent/child tree to extract into `CategoryDot.tsx` and reuse.
- `packages/web/src/components/TransactionSheet.tsx` -- `FIELD_NAMES` L40, fields L190-247.
- `packages/web/src/hooks/useTransactions.ts:56-88`, `lib/query-keys.ts:34-48`, `lib/error-toast.ts` -- mutations, keys, destructive toast. No optimistic update exists yet.
- `packages/web/src/lib/shortcuts.ts:83-102`, `hooks/useShortcut.ts`, `locales/fr.json` (`operations` L216, `shortcuts` L53) -- list shortcuts and strings.
- `packages/web/e2e/fixtures.ts:237-250` -- `categorise` writes SQL straight into the database; replace it with a PATCH through `apiHelpers`. `e2e/operations.spec.ts:23` `openFilter` gains « Catégorie ».

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/migrate.spec.ts` -- first, failing tests: origin check, origin null exactly when category null, rebuild keeps rows and foreign keys.
- [x] `packages/data/schema/categories.ts`, `schema/transactions.ts`, `types.ts` -- `CATEGORY_ORIGINS`, `categoryOrigin`, `"category"` lockable; generate `0012_add_category_origin`.
- [x] `packages/api/src/services/ledger.spec.ts`, `ledger.ts` -- spec first for the matrix rows on set, clear, lock, merge and delete; then `updateTransaction`, `recategorise`, `categoryId` in list columns, `categoryIds`/`uncategorised` in `TransactionFilter`.
- [x] `packages/api/src/services/categories.ts`, `categories.spec.ts` -- exported existence check and child expansion.
- [x] `packages/api/src/schemas/transactions.ts`, `schemas/transactions.spec.ts`, `services/transactions.ts`, `app.spec.ts` -- `categoryId` in the PATCH body, repeated `category` query, unknown id and filter rows of the matrix.
- [x] `packages/web/src/components/CategoryDot.tsx`, `CategoryCombobox.tsx` -- shared dot and single-choice combobox; the settings page reuses the dot.
- [x] `packages/web/src/hooks/useTransactions.ts` -- `useSetTransactionCategory` with optimistic update, rollback and undo toast.
- [x] `packages/web/src/components/TransactionList.tsx`, `lib/shortcuts.ts` -- chip per row, `c` shortcut, two-line layout below 768 px.
- [x] `packages/web/src/components/TransactionSheet.tsx` -- Catégorie field.
- [x] `packages/web/src/lib/transaction-filters.ts`, `components/TransactionFilters.tsx` -- category filter kind, editor and chip.
- [x] `packages/web/src/locales/fr.json` -- « Sans catégorie », « Catégorie modifiée », « Annuler », filter and shortcut strings.
- [x] `packages/web/e2e/fixtures.ts`, `e2e/categorise.spec.ts`, `e2e/categories.spec.ts` -- `categorise` through the API; one test per criterion below.

**Acceptance Criteria:**
- Given a transaction on `/operations`, when I click its chip, type « cour » and press `Enter`, then the chip shows Courses at once and still does after a reload.
- Given that toast, when I press « Annuler », then the chip shows « Sans catégorie » again.
- Given a focused row, when I press `c`, then its combobox opens.
- Given categorised and uncategorised rows, when I filter on « Sans catégorie », or on two categories, then only matching rows show, and the chip lists the choice.
- Given the sheet of a transaction, when I pick a category and save, then the row shows it.
- Given a rejected PATCH, when I pick a category, then the chip returns to its previous value and a destructive toast shows.

## Design Notes

The undo PATCHes the previous `categoryId` with `origin: "user"`, so the field stays locked: the user did choose it twice. Undo does not restore an unlocked state; Epic 8 can offer an unlock if that matters.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all pass, no tracked file modified afterwards.

## Implementation Notes

- `0012_add_category_origin` copies a row that already has a category with `category_origin = 'user'` and `category` appended to `locked_fields`, rather than a null origin: the new check requires an origin beside a category, and before 0012 only a person could set one, directly in the database. The generated copy also read the missing column from the old table, as 0009 did; both edits are by hand.
- `ledger.updateTransaction` maps each origin to a `category_origin`: `sync` records `provider`. A `maintenance` call that changes the category throws: it would record an origin without a lock, and no caller does it. The `entries` update and the balance recompute are skipped only when the category alone changed; other fields keep their earlier behaviour.
- The ledger checks that a category exists by reading `categories` itself, inside its transaction, so it does not import `services/categories.ts`, which imports the ledger.
- `useCategoryShown` in `hooks/useCategories.ts` gives the row chip and the sheet field the same colour and name, and a skeleton while the list loads.
- The `account` and `category` filters refuse an empty value with `400` rather than matching nothing.
- The sheet shows the Catégorie field on edits only, as it does the exclusion switch: the create route takes no category.
- The row chip sits after the amount on wide screens, in a fixed-width column so amounts stay aligned, and on its own line under the label below 768 px. It cannot sit between the account and the amount without being nested in the open button.
- The combobox filters on the category name only, case and accents aside (`matchesCommand`), and keeps list order, so `Enter` picks the first match as the user reads it.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|---|
| 1 | blind, verification-gap | 0012 backfills `user` without locking `category` | low | `migrate.spec.ts` expects `locked: '["label"]'` beside `categoryOrigin: "user"`; a later rule would overwrite it | patch |
| 2 | blind, edge, verification-gap | `CATEGORY_ORIGIN_OF` maps `maintenance` to `user`, which never locks | medium | `ledger.ts` map; no caller today, but the next maintenance writer would record `user` unlocked | patch |
| 3 | blind | `ledger.ts` imports `categoryExists` from `categories.ts`, which imports the ledger | medium | Import cycle noted in Implementation Notes; the ledger can read the `categories` table itself | patch |
| 4 | blind, edge | An older toast's « Annuler » overwrites a newer choice on the same row | low | `onSuccess` shows one toast per change without an id; `previous` is the older value | patch |
| 5 | blind | Clearing an already uncategorised row does not lock | false | Matrix row « Clear by hand » starts from a set category; `null === null` is no change, as in Sure's `saved_changes` | reject |
| 6 | blind | Chip's accessible name is the category name alone | low | `CategoryChip` sets `aria-label` only while loading | patch |
| 7 | blind, edge | Sheet shows « Catégorie inconnue » while categories load | low | `CategoryField` falls back to `unknownCategory` when `categories.data` is undefined | patch |
| 8 | blind | A category deleted elsewhere yields the generic « Valeur invalide » | low | Needs a delete in another tab during an edit; fix adds a message and an invalidation | reject |
| 9 | blind | Spec status, task ticks and empty triage log disagree | false | Status follows the workflow order; `types.ts` needed no new type; this log is filled now | reject |
| 10 | blind | A label, notes or excluded edit still recomputes balances | low | Pre-existing behaviour, not caused by this story; no user-visible harm on a household's volume | reject |
| 11 | blind | Optimistic row stays under an active category filter | false | `onSettled` invalidates `transactions.all`, so the row leaves once the refetch lands | reject |
| 12 | blind | No route test for the PATCH lock, nor for an unchanged `categoryId` staying unlocked | low | Only `ledger.spec.ts` covers the lock; the sheet always sent `categoryId` | patch |
| 13 | edge | Picking the category a rule already set does not lock it | low | No rule exists before Epic 8, and the row does not send an unchanged pick; same as Sure | reject |
| 14 | edge | The sheet sends a stale `categoryId` and fails on any save after a delete elsewhere | low | `submit` sends every value; sending the field only when dirty is direct | patch |
| 15 | edge | Chips show a skeleton forever when the category query fails | low | The global query error toast already reports it; fix adds an error branch | reject |
| 16 | edge | A failed change restores a snapshot over a second in-flight change | low | Needs two picks within one request's latency and a failure; `onSettled` refetch corrects it | reject |
| 17 | edge | A URL category id that no longer exists cannot be unchecked | low | Editor seeds its set from the URL as is; filtering to known ids is one line | patch |
| 18 | edge | `?category=` with an empty value returns an empty list | low | The interface never sends it; the API answers an empty page rather than an error | reject |
| 19 | edge | Moving a category under a parent leaves a parent-filtered list stale | low | Settings and list are separate pages; the list refetches on mount | reject |
| 20 | verification-gap | Optimistic update and rollback unproven by e2e | medium | Removing `onMutate` or the `onError` restore keeps every test green | patch |
| 21 | verification-gap | Undo showing no toast of its own is untested | low | Removing `change.undo === true` keeps the test green | patch |
| 22 | verification-gap | Focus return to the row after `c` is untested | low | Removing `onCloseFocus`'s refocus keeps the test green | patch |
