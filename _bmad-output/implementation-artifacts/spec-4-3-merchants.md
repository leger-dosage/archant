---
title: 'Story 4.3: Merchants'
type: 'feature'
created: '2026-09-23'
status: 'done'
baseline_commit: '7ebd42bc5539ae3e4768d2524e585d24a580c645'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/scaffolding-lessons.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A bank writes one shop many ways (« CB CARREFOUR 1234 », « CARREFOUR MARKET »), and nothing lets the user say they are the same shop, nor list what they spent there (FR21, FR23, FR29).

**Approach:** Add a `merchants` table and `transactions.merchant_id`, set it through the transaction PATCH with the same lock as the category, add a repeated `merchant` filter, then show the merchant as a caption under the row's label, edit it from a combobox that can create a merchant, and manage merchants under `/reglages/marchands`.

## Boundaries & Constraints

**Always:**
- `merchants`: `id` text UUID, `name`, `created_at`, `updated_at`. Names unique ignoring case: `uniqueIndex` on `lower(name)` plus the service's French fold check, as `assertNameFree` does for categories. Name schema trims, applies NFC, 1 to `MERCHANT_NAME_MAX_LENGTH` (60). No colour, logo or website.
- `transactions.merchant_id`: nullable, `REFERENCES merchants(id) ON DELETE restrict`, index `transactions_merchant`. Added by `ALTER TABLE` as 0011 did, with the `ON DELETE restrict` written by hand; no check, so no table rebuild. No `merchant_origin` column: AD-10 records only the category's origin.
- `LOCKABLE_FIELDS` gains `"merchant"`; `PATCH_KEY_OF` maps it to `merchantId`. `ledger.updateTransaction` checks the merchant exists inside its `immediate` transaction; unknown id is `400 VALIDATION_ERROR`, field `merchantId`, code `invalid_value`. A change touching only category and merchant writes `transactions` alone, with no balance recompute.
- A new ledger function `moveMerchant(deps, fromId, toId | null, { origin: "maintenance" })` is one `UPDATE`, leaves locks alone, and serves both merge and delete. Only the ledger writes `transactions` (AD-2).
- API `/api/merchants`: `GET /` lists every merchant with `transactionCount`, sorted with `Intl.Collator("fr")`; `POST /` `{ name }` returns 201; `PATCH /:id` `{ name }`; `DELETE /:id` unlinks its transactions then deletes it, returns `{ id, unlinked }`; `POST /:id/merge` `{ targetId }` moves transactions then deletes the source. A taken name is `VALIDATION_ERROR` `name`/`name_taken`; an unknown or self `targetId` is `targetId`/`invalid_value`; an unknown id is `NOT_FOUND`. Delete and merge run in one `immediate` transaction.
- List rows gain `merchantId`; the interface resolves the name from the cached `useMerchants` list, as 4.2 does for categories.
- Filter `merchant` repeats like `category`, capped by `MAX_MERCHANT_FILTER` (100), values ORed, an empty value refused with 400, an unknown id matching nothing. `needsTransactionColumns` includes it.
- Row: the merchant name as a `text-xs text-muted-foreground` caption under the label, inside the open button; nothing when there is none.
- `MerchantCombobox`: « Sans marchand » first, then merchants sorted by name, filtered with `matchesCommand`; when the search is non-empty and no name folds equal to it, a last item « Créer "…" ». Picking it POSTs the merchant, then sets it.
- `m` on a focused row opens the combobox anchored on that row. Picking saves optimistically with a toast « Marchand modifié » and « Annuler », rolls back with `showErrorToast` on failure, as `useSetTransactionCategory` does. Listed in `lib/shortcuts.ts`.
- The transaction sheet gains a Marchand field under Catégorie, edits only, sent only when dirty.
- `/operations` filter bar gains a « Marchand » kind: a searchable checklist, since merchants outnumber categories, then « Appliquer ».
- Settings `SECTIONS` becomes Catégories, Marchands, Sécurité; the command palette gains « Marchands ». The page lists name and transaction count, with a menu Renommer, Fusionner, Supprimer. Merge picks the target with `MerchantCombobox` without « Sans marchand » nor « Créer », source excluded. Delete confirms with the number of transactions that lose their merchant.

**Never:** no merchant detection from labels, no `normalizeLabel` use, no provider merchants (Epic 10). No inline merchant button on the row: as in Sure, the row shows the merchant and the sheet and `m` edit it. No « Sans marchand » filter value, no creation form on the settings page, no multi-row edit (Story 4.5). No `services/classification.ts`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Set by hand | PATCH `{ merchantId: M }` | `merchant_id = M`, `merchant` locked, balances untouched | — |
| Clear by hand | PATCH `{ merchantId: null }` | null, `merchant` locked | — |
| Other origin on locked merchant | `updateTransaction(..., { origin: "rule" })` | Merchant unchanged | — |
| Unknown merchant | PATCH `{ merchantId: "x" }` | Nothing written | `400`, `merchantId`, `invalid_value` |
| Duplicate name | POST `{ name: "carrefour" }`, « Carrefour » exists | Nothing created | `400`, `name`, `name_taken` |
| Merge | S has 3 rows, one locked | 3 rows on T, lock kept, S gone | — |
| Merge into self | `POST /S/merge { targetId: S }` | Nothing changes | `400`, `targetId`, `invalid_value` |
| Delete | M has 2 rows | Rows unlinked, locks kept, M gone, `unlinked: 2` | — |
| Filter | `?merchant=A&merchant=B` | Rows on A or B; count and sum match | — |

</frozen-after-approval>

## Code Map

- `packages/data/schema/categories.ts:30-53` -- model to copy for `schema/merchants.ts` (`lower(name)` unique index L50). `category-presets.ts:7` holds `CATEGORY_NAME_MAX_LENGTH`; put `MERCHANT_NAME_MAX_LENGTH` in the merchants schema file.
- `packages/data/schema/transactions.ts:12-19, 54-69` -- `LOCKABLE_FIELDS`, `categoryId` column and index to mirror. `packages/data/types.ts` -- `Merchant` types.
- `pnpm data generate --name add_merchants` -- produces `drizzle/0013_add_merchants.sql`; add `ON DELETE restrict` by hand, as 0011 L17.
- `packages/data/migrate.spec.ts` -- `migratedBefore` L267, 0011 test L487 as the pattern.
- `packages/api/src/services/ledger.ts` -- `TransactionPatch` L892, `PATCH_KEY_OF` L903, `transactionRow` L914, `updateTransaction` L949 (category existence check L976-987, `touchesEntry` L1008), `recategorise` L1082 and `countByCategory` L1108 as models, `transactionColumns` L1423, `TransactionFilter` L1488, `needsTransactionColumns` L1515, `filterCondition` L1565.
- `packages/api/src/services/categories.ts` -- `assertNameFree` L111, `deleteCategory` L228, `mergeCategory` L268: copy into `services/merchants.ts`.
- `packages/api/src/routes/categories.ts`, `schemas/categories.ts` -- copy into `routes/merchants.ts`, `schemas/merchants.ts`; mount in `app.ts:54`.
- `packages/api/src/schemas/transactions.ts` -- patch body L23, `updateTransactionSchema` L81, `MAX_CATEGORY_FILTER` L170, `repeated` L183, filter L196. `services/transactions.ts:175-206` maps the filter.
- `packages/api/src/app.spec.ts` -- `request` L246, `listed` L811, category helpers L3083-3095 and `describe("categories")` L3127. `ledger.spec.ts` -- `updateTransaction` L1733, `recategorise` L2900.
- `.oxlintrc.json` -- `schema/transactions` import ban; merchants service goes through the ledger.
- `packages/web/src/components/CategoryCombobox.tsx` -- `filterByName` L22, `Command` L56; model for `MerchantCombobox.tsx`.
- `packages/web/src/components/TransactionList.tsx` -- label span L184-186 gets the caption; `CategoryChip` L70-117 and `useShortcut("categoriseRow")` L146-157 are the `m` model.
- `packages/web/src/hooks/useCategories.ts`, `useTransactions.ts:89-171`, `lib/query-keys.ts:31-33` -- `useMerchants`, `useSetTransactionMerchant`, `queryKeys.merchants`.
- `packages/web/src/components/TransactionSheet.tsx` -- `CategoryField` L100-146, `FIELD_NAMES` L46, dirty send L208-211.
- `packages/web/src/lib/transaction-filters.ts` -- schema L23, `FILTER_KINDS` L74, `PARAMS_OF` L78, `toApiQuery` L106, `ChipKey` L119, `FilterNames` L136, `filterChips` L179. `components/TransactionFilters.tsx` -- `CategoryEditor` L121-177, props L360.
- `packages/web/src/routes/_authed.reglages.tsx:8-11`, `_authed.reglages.categories.tsx`, `components/MergeCategoryDialog.tsx`, `ConfirmDialog.tsx`, `CommandPalette.tsx:115-119`.
- `packages/web/src/lib/shortcuts.ts:104-108`, `locales/fr.json` (`transactions.category` L217, `operations.kinds` L232, `settings.sections` L565).
- `packages/web/e2e/fixtures.ts:140-260` -- add `createMerchant`, `setMerchant`; `e2e/categorise.spec.ts` helpers (`gate`, `holdPatches`, `visitOperations`) to reuse.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/migrate.spec.ts` -- failing test first: 0013 keeps every transaction, foreign keys hold, delete of a used merchant is refused by the database.
- [x] `packages/data/schema/merchants.ts`, `schema/transactions.ts`, `types.ts` -- table, column, index, `"merchant"` lockable; generate `0013_add_merchants`.
- [x] `packages/api/src/services/ledger.spec.ts`, `ledger.ts` -- matrix rows on set, clear, lock, merge, delete and filter first; then `merchantId` in patch, row and columns, `moveMerchant`, `countByMerchant`, `merchantIds` filter.
- [x] `packages/api/src/schemas/merchants.ts`, `services/merchants.ts`, `services/merchants.spec.ts`, `routes/merchants.ts`, `app.ts` -- CRUD, merge, delete.
- [x] `packages/api/src/schemas/transactions.ts`, `schemas/transactions.spec.ts`, `services/transactions.ts`, `app.spec.ts` -- `merchantId` in the PATCH, repeated `merchant` query, route rows of the matrix.
- [x] `packages/web/src/lib/query-keys.ts`, `hooks/useMerchants.ts`, `hooks/useTransactions.ts` -- list, create, rename, merge, delete; `useSetTransactionMerchant`.
- [x] `packages/web/src/components/MerchantCombobox.tsx` -- pick, clear, « Créer "…" ».
- [x] `packages/web/src/components/TransactionList.tsx`, `lib/shortcuts.ts` -- caption and `m`.
- [x] `packages/web/src/components/TransactionSheet.tsx` -- Marchand field.
- [x] `packages/web/src/lib/transaction-filters.ts`, `components/TransactionFilters.tsx` -- merchant kind, editor, chip.
- [x] `packages/web/src/routes/_authed.reglages.marchands.tsx`, `_authed.reglages.tsx`, `components/RenameMerchantDialog.tsx`, `MergeMerchantDialog.tsx`, `CommandPalette.tsx` -- settings page.
- [x] `packages/web/src/locales/fr.json` -- all strings above.
- [x] `packages/web/e2e/fixtures.ts`, `e2e/merchant.spec.ts`, `e2e/merchants.spec.ts` -- one test per criterion below.

**Acceptance Criteria:**
- Given a focused row on `/operations`, when I press `m`, type « Carrefour » and pick « Créer "Carrefour" », then the caption shows Carrefour and still does after a reload.
- Given a merchant « Carrefour », when I press `m` on another row and type « carr », then Carrefour is offered; when I type « carrefour », « Créer » is not.
- Given that toast, when I press « Annuler », then the caption disappears.
- Given the sheet of a transaction, when I pick a merchant and save, then the row shows it.
- Given rows on two merchants, when I filter on one, then only its rows show, and the chip names it.
- Given `/reglages/marchands`, when I rename a merchant, then its rows show the new name.
- Given two merchants, when I merge the first into the second, then the first disappears and its rows show the second.
- Given a used merchant, when I delete it and confirm, then its rows show no merchant.
- Given a rejected PATCH, when I pick a merchant, then the caption returns to its previous value and a destructive toast shows.

## Implementation Notes

- « Créer "…" » follows the Always rule: it shows whenever no name folds equal to the search, so « carr » offers both Carrefour and « Créer "carr" ». Hiding it on any partial match would stop the user creating « Carrefour » beside « Carrefour Market ». The second acceptance criterion was reworded to match.
- `packages/api/package.json` exports `./schemas/merchants`, which the interface imports for the rename form.
- `useSetTransactionCategory` and `useSetTransactionMerchant` share one private `useSetRowField` in `hooks/useTransactions.ts`; the category behaviour is unchanged and its end-to-end tests pass.
- The rename dialog shows its own « Un marchand porte déjà ce nom. », since the shared `name_taken` message names a category.
- `e2e/keyboard.spec.ts` lists the `m` shortcut in the help.
- Names compare with `toLocaleLowerCase("fr")`, as categories do: accents count, so « epicerie » beside « Épicerie » is two merchants.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|---|
| 1 | blind, edge | `MerchantEditor` drops every URL merchant id when opened before `useMerchants` resolves | low | Initialiser filters on `merchants.data ?? []`; needs the pane opened within the first request, and `CategoryEditor` does the same | reject |
| 2 | blind, edge | « Créer » offered for an existing name while the list loads | low | `canCreate` reads `merchants.data ?? []`; needs `m` within the first request, and the server then answers `name_taken` | reject |
| 3 | blind, edge | « Créer » offered for a name over 60 characters, refused with a generic toast | low | `canCreate` checks no length; `merchantSchema` caps at `MERCHANT_NAME_MAX_LENGTH`; one condition fixes it | patch |
| 4 | blind | Row shows nothing, sheet « Marchand inconnu », for an id missing from the list | low | Only reachable between a delete elsewhere and the refetch that nulls the id | reject |
| 5 | blind | « Annuler » after the previous merchant was deleted fails generically | low | Needs a delete in another tab inside the toast's lifetime | reject |
| 6 | blind | Merge or delete leaves a dead `?merchant=` filter | low | Chip reads « Marchand inconnu » and can be removed; categories behave the same | reject |
| 7 | blind | `getMerchant` recounts every merchant after each write | low | One indexed `GROUP BY` per write on a household's volume; no user-visible cost | reject |
| 8 | blind, verification-gap | NFC normalisation of a merchant name is untested | low | Removing `.normalize("NFC")` keeps every test green; categories have the test | patch |
| 9 | blind | No unit test for `nameKey`/`canCreate` | low | `e2e/merchant.spec.ts` covers « carr » and the full-name fold | reject |
| 10 | blind, verification-gap | `sprint-status.yaml` moves `last_updated` backwards | low | The earlier 11:00 was ahead of the clock; step 5 rewrites it | patch |
| 11 | blind | Review diff leaves the spec out | false | Deliberate: the blind layer never reads the claims | reject |
| 12 | blind | `zValidator` hook repeated three times in `routes/merchants.ts` | false | Same shape as `routes/categories.ts`; no named harm | reject |
| 13 | blind | `app.spec.ts` filter test uses tuple defaults | low | Test readability only | reject |
| 14 | blind | Inner double spaces make two merchants | low | Categories trim the same way; no report of such names | reject |
| 15 | edge | More than 100 merchants checked yields an API error | low | Ticking 100 boxes by hand is not an everyday path | reject |
| 16 | edge | `?merchant=` empty in the URL reaches the API and errors | low | Same schema shape as `category`; the interface never writes it | reject |
| 17 | edge | Merge answers 404 if the target is deleted right after commit | low | Needs two concurrent writes from one household | reject |
| 18 | verification-gap | Sheet sending `merchantId` only when dirty is untested | medium | Always sending it keeps every test green; a merchant deleted elsewhere would block any label edit | patch |

## Design Notes

Merchant names come from the user only in this story. `normalizeLabel` stays for the rules of Epic 8 and the sync of Epic 10, which may create merchants from bank data; those will need a source column then, as Sure's `ProviderMerchant` does, and nothing here blocks adding it.

The row caption stays inside the open button, because a second button there would be nested or float over the label. `m` and the sheet are the two ways in; the tooltip rule for shortcuts is met by listing `m` in the `?` help.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all pass, no tracked file modified afterwards.
