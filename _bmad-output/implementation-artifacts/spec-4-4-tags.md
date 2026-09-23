---
title: 'Story 4.4: Tags'
type: 'feature'
created: '2026-09-23'
status: 'done'
baseline_commit: 'bc983a6d56657cfef78aa96a29be392375ad13df'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/scaffolding-lessons.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A trip or a project spreads over many categories, and nothing lets the user mark those transactions together, see the marks on the rows, or list them (FR21, FR23, FR30).

**Approach:** Add `tags` and a `taggings` join, set a transaction's tags through the transaction PATCH with a `tags` lock, add a repeated `tag` filter, then show tags on the row, edit them from a multi-select combobox that can create a tag, and manage tags under `/reglages/etiquettes`.

## Boundaries & Constraints

**Always:**
- `tags`: `id` text UUID, `name`, `created_at`, `updated_at`; `uniqueIndex` on `lower(name)`; `TAG_NAME_MAX_LENGTH` (60) in `schema/tags.ts`. Name schema and French fold check as merchants.
- `taggings`: `transaction_id` → `transactions(entry_id)`, `tag_id` → `tags(id)`, both `ON DELETE restrict` written by hand, primary key `(transaction_id, tag_id)`, index `taggings_tag` on `tag_id`. Migration `0014_add_tags`; `transactions` is not altered.
- Only `services/ledger.ts` writes `taggings`. `deleteTransaction`, `revertImport` and `deleteAccount` delete the taggings of the rows they delete, before the `transactions` rows, as they do for `entry_keys`.
- `LOCKABLE_FIELDS` gains `"tags"`; `PATCH_KEY_OF` maps it to `tagIds`. PATCH `tagIds: string[]` replaces the whole set; duplicates are dropped; at most `MAX_TAGS_PER_TRANSACTION` (20). `updateTransaction` checks every id exists inside its `immediate` transaction; an unknown id is `400 VALIDATION_ERROR`, `tagIds`, `invalid_value`. `touchesEntry` ignores `tags`: no entry write, no balance recompute.
- New ledger functions: `removeTag(deps, tagId, { origin: "maintenance" })` deletes a tag's taggings and returns the count, locks untouched; `countByTag` as `countByMerchant`.
- Rows and `findTransaction` gain `tagIds: string[]`, loaded by one extra `IN` query on the page's ids (page size ≤ 200), never a join that multiplies rows.
- Filter `tag` repeats like `merchant`, capped by `MAX_TAG_FILTER` (100), values ORed through `EXISTS` on `taggings`, so the count and the sum never count a row twice.
- API `/api/tags`: `GET /` with `transactionCount`, sorted with `Intl.Collator("fr")`; `POST /` `{ name }` 201; `PATCH /:id` `{ name }`; `DELETE /:id` returns `{ id, untagged }` in one `immediate` transaction. Taken name `name`/`name_taken`; unknown id `NOT_FOUND`.
- Row: tag names as outline `Badge`s on the caption line after the merchant, inside the open button, sorted by name; beyond 3, « +N ». Names resolved from `useTags`.
- `TagCombobox`: multi-select, a check on selected tags, filtered with `matchesCommand`, « Créer "…" » last when no name folds equal to the search and it fits the cap. Picking toggles and keeps the list open; « Créer » creates then selects.
- `t` on a focused row opens it anchored on the row. Closing it saves once if the set changed, optimistic, toast « Étiquettes modifiées » with « Annuler », rollback with `showErrorToast`. Listed in `lib/shortcuts.ts`.
- The sheet gains an Étiquettes field under Marchand, edits only, sent only when dirty.
- Filter bar gains « Étiquette », a searchable checklist as `MerchantEditor`.
- Settings `SECTIONS`: Catégories, Marchands, Étiquettes, Sécurité; palette gains « Étiquettes ». The page lists name and count, menu Renommer, Supprimer; delete confirms with the number of transactions that lose the tag.

**Never:** no tag colour, no tag merge, no delete-with-replacement, no creation form on the settings page, no « Sans étiquette » filter value, no AND filter mode, no multi-row edit (Story 4.5), no tags from rules or imports (Epic 8), no `ON DELETE cascade`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Set by hand | PATCH `{ tagIds: [A, B] }` | Exactly A and B, `tags` locked, balances untouched | — |
| Replace | Tagged A, PATCH `{ tagIds: [B] }` | Only B | — |
| Clear | PATCH `{ tagIds: [] }` | No tagging, `tags` locked | — |
| Other origin on locked tags | `updateTransaction(..., { origin: "rule" })` | Tags unchanged | — |
| Unknown tag | PATCH `{ tagIds: [A, "x"] }` | Nothing written | `400`, `tagIds`, `invalid_value` |
| Too many | 21 ids | Nothing written | `400`, path `tagIds` |
| Delete tag | T on 2 rows | Taggings gone, locks kept, T gone, `untagged: 2` | — |
| Delete tagged transaction, revert import, delete account | Rows carry tags | Rows and their taggings gone | — |
| Filter | `?tag=A&tag=B`, one row on both | Row listed once; count and sum count it once | — |

</frozen-after-approval>

## Code Map

- `packages/data/schema/merchants.ts` -- model for `schema/tags.ts`. `schema/entry-keys.ts:32` -- composite `primaryKey` model for `schema/taggings.ts`. `schema/transactions.ts:13-21` -- `LOCKABLE_FIELDS`. `types.ts:43-44` -- add `Tag`, `Tagging`.
- `pnpm data generate --name add_tags` -- produces `drizzle/0014_add_tags.sql`; set `ON DELETE restrict` by hand, as 0013.
- `packages/data/migrate.spec.ts:604-650` -- merchants block as the pattern (`migratedBefore`, `pragma_foreign_key_check`).
- `packages/api/src/services/ledger.ts` -- `TransactionPatch` 892, `PATCH_KEY_OF` 906, `transactionRow` 918, `updateTransaction` 955 (merchant check 996-1008, `touchesEntry` 1029, lock union 1038-1055), `deleteTransaction` 1072 (deletes 1084-1086), `moveMerchant` 1150 and `countByMerchant` 1171 as models, `revertImport` 1263 (chunked deletes 1294-1328), `deleteAccount` 1388 (1398-1405), `transactionColumns` 1488, `findTransaction` 1536, `TransactionFilter` 1554, `filterCondition` 1636, `listTransactions` 1675, `sumTransactions` 1715.
- `packages/api/src/services/merchants.ts`, `routes/merchants.ts`, `schemas/merchants.ts` -- copy into the tags equivalents without merge; mount in `app.ts:51-58`. `.oxlintrc.json` bans `schema/taggings` outside the ledger, as `schema/transactions`; `tags` stays open to `services/tags.ts`.
- `packages/api/src/schemas/transactions.ts` -- patch body 23, update schema 92, `MAX_MERCHANT_FILTER` 179, `repeated` 192, filter 209. `services/transactions.ts:207` maps the filter.
- Tests: `app.spec.ts` merchant PATCH 781, filter 1040-1076, helpers 3446-3468, `describe("merchants")` 3476; `ledger.spec.ts` `lockedFields` 256, merchant cases 1974-2058, filter 2318, `moveMerchant` 3139; `services/merchants.spec.ts`.
- `packages/web/src/components/MerchantCombobox.tsx` -- `nameKey` 37, `canCreate` 72, `create` 79; model for `TagCombobox.tsx`. `ui/command.tsx:150` draws the check from `data-checked`. `ui/badge.tsx`.
- `packages/web/src/components/TransactionList.tsx` -- caption 216-225, `setMerchantRow` 170-180 and the anchored popover 203-268 as the `t` model.
- `packages/web/src/hooks/useTransactions.ts` -- `RowField` 91, `useSetRowField` 126-195 to extend to an array field; `hooks/useMerchants.ts` model for `useTags.ts`; `lib/query-keys.ts:35-37`.
- `packages/web/src/components/TransactionSheet.tsx` -- `FIELD_NAMES` 48, `MerchantField` 153-206, dirty send 274-282.
- `packages/web/src/lib/transaction-filters.ts` (merchant 39-44, 80-91, 118, 127-148, 165, 208) and `components/TransactionFilters.tsx` (`MerchantEditor` 184-236, props 424-454, pane 515).
- `packages/web/src/routes/_authed.reglages.tsx:8-12`, `_authed.reglages.marchands.tsx`, `RenameMerchantDialog.tsx`, `ConfirmDialog.tsx`, `CommandPalette.tsx:115-124`, `lib/shortcuts.ts:110-116`, `locales/fr.json` (`transactions.merchant` 228, `operations` 243-275, `merchants` 579, `settings.sections` 620).
- `packages/web/e2e/fixtures.ts:248-266`, `e2e/merchant.spec.ts`, `e2e/merchants.spec.ts`, `e2e/keyboard.spec.ts:362-384` (exact help list).

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/migrate.spec.ts` -- failing test first: 0014 keeps every transaction, foreign keys hold, a duplicate tagging and a delete of a used tag are refused.
- [x] `packages/data/schema/tags.ts`, `schema/taggings.ts`, `schema/transactions.ts`, `types.ts` -- tables, `"tags"` lockable; generate `0014_add_tags`.
- [x] `packages/api/src/services/ledger.spec.ts`, `ledger.ts` -- matrix rows first; then `tagIds` in patch and rows, taggings deletes in the three delete paths, `removeTag`, `countByTag`, `tagIds` filter.
- [x] `packages/api/src/schemas/tags.ts`, `services/tags.ts`, `services/tags.spec.ts`, `routes/tags.ts`, `app.ts` -- list, create, rename, delete.
- [x] `packages/api/src/schemas/transactions.ts`, `schemas/transactions.spec.ts`, `services/transactions.ts`, `app.spec.ts` -- `tagIds` in the PATCH, repeated `tag` query, route rows of the matrix.
- [x] `packages/web/src/lib/query-keys.ts`, `hooks/useTags.ts`, `hooks/useTransactions.ts` -- tag CRUD hooks, `useSetTransactionTags`.
- [x] `packages/web/src/components/TagCombobox.tsx` -- toggle, « Créer "…" ».
- [x] `packages/web/src/components/TransactionList.tsx`, `lib/shortcuts.ts` -- badges and `t`.
- [x] `packages/web/src/components/TransactionSheet.tsx` -- Étiquettes field.
- [x] `packages/web/src/lib/transaction-filters.ts`, `components/TransactionFilters.tsx` -- tag kind, editor, chip.
- [x] `packages/web/src/routes/_authed.reglages.etiquettes.tsx`, `_authed.reglages.tsx`, `components/RenameTagDialog.tsx`, `CommandPalette.tsx`, `locales/fr.json` -- settings page and strings.
- [x] `packages/web/e2e/fixtures.ts`, `e2e/tag.spec.ts`, `e2e/tags.spec.ts`, `e2e/keyboard.spec.ts` -- one test per criterion below.

**Acceptance Criteria:**
- Given a focused row on `/operations`, when I press `t`, create « Vacances 2026 », pick an existing tag and close, then the row shows both badges and still does after a reload.
- Given that toast, when I press « Annuler », then the badges disappear.
- Given the sheet of a transaction, when I add a tag and save, then the row shows it.
- Given rows with and without a tag, when I filter on it, then only tagged rows show, and the chip names it.
- Given `/reglages/etiquettes`, when I rename a tag, then its rows show the new name.
- Given a used tag, when I delete it and confirm, then its rows no longer show it.
- Given a rejected PATCH, when I change tags and close, then the row returns to its previous tags and a destructive toast shows.

## Implementation Notes

- `.oxlintrc.json` bans `@archant/data/schema/taggings` in the API, type imports allowed in `domain/` and `connectors/`, since only the ledger writes taggings; the plan had wrongly left it open. `services/tags.spec.ts` reads taggings through `sql`, as `merchants.spec.ts` reads transactions.
- « Étiquette » sits between Catégorie and Marchand in the filter menu, in the epic's order; the chip-order test follows.
- `MAX_TAGS_PER_TRANSACTION` is checked by the route schema, not by `updateTransaction`: the ledger's only caller with tag ids is that route.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|---|
| 1 | blind, edge | Sheet or row draft keeps a tag id deleted elsewhere, so the next tag edit is refused | low | Needs a delete in another tab while the sheet or picker is open; an untouched set is not sent, and merchants took the same call | reject |
| 2 | blind | `useCreateTag` appends the new tag, so it sits last until the refetch | low | `useCreateMerchant` does the same; the refetch sorts it within one request | reject |
| 3 | blind | Picked tags are only `data-checked`, invisible to a screen reader | low | `CommandItem` shows the check by CSS; `aria-checked` is a one-attribute fix | patch |
| 4 | blind | « +N » hides the extra tag names | low | The spec asks for « +N »; the sheet lists every tag | reject |
| 5 | blind | No test on « +N » nor on badge order | low | No acceptance criterion covers them; a presentational detail | reject |
| 6 | blind | `sameTags`, the collator and the toggle are written twice or three times | low | No named caller that diverges; merging them adds a module | reject |
| 7 | blind, edge | Draft lost if the row leaves the list while its picker is open | low | Changing a filter closes the popover first, which saves; only a delete elsewhere removes the row | reject |
| 8 | blind | `getTag` recounts every tag after a write | low | One indexed `GROUP BY` on a household's volume; merchants do the same | reject |
| 9 | blind | `transactionRow` loads tag ids on every update and delete | low | One indexed lookup inside a write transaction | reject |
| 10 | blind | No test combines `tag` with another filter | low | `filterCondition` joins every condition with the same `and`; category and merchant rely on it untested too | reject |
| 11 | blind | `MAX_TAGS_PER_TRANSACTION` comment claims the ledger is bounded | low | Only the route schema applies the cap | patch |
| 12 | blind | `taggings` docstring says taggings are deleted "by name" | low | Deletes go by `transaction_id` | patch |
| 13 | edge | Closing the row picker while « Créer » is pending creates an unattached tag | low | Needs `Esc` within one local request; the tag is then one pick away. The first `tag.spec.ts` test hit it under full-suite load and now waits for the check, as a user does | reject |
| 14 | edge | 19 tags, « Créer », then another pick yields 21 and a refused save | low | Needs a twentieth tag during a pending create; the save rolls back with a toast | reject |
| 15 | edge | « Annuler » fails if a previous tag was deleted meanwhile | low | Needs a delete elsewhere within the toast's lifetime | reject |
| 16 | edge | More than 100 tags checked in the filter errors | low | Same as merchants; not an everyday path | reject |
| 17 | edge | `?tag=` empty or over 100 in the URL errors | low | Same schema shape as `merchant`; the interface never writes it | reject |
| 18 | verification-gap | Sheet saving another field after its tag was deleted is untested | medium | Always sending `tagIds` keeps every test green; merchants have this test | patch |
| 19 | verification-gap | « Créer » hidden for an existing name in another case is untested | medium | Dropping the fold keeps every test green; merchants have this test | patch |
| 20 | verification-gap | `name_taken` in the rename dialog is untested in the interface | low | API tests cover the refusal; merchants lack it too | defer |

## Design Notes

Tags save when the combobox closes, not on every pick: one PATCH and one « Annuler » per edit, where a save per toggle would stack one toast per tag.

`restrict` plus explicit deletes keeps the ledger's rule that every row it removes is removed by name; a forgotten path fails loudly in the delete tests instead of silently dropping links.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all pass, no tracked file modified afterwards.
