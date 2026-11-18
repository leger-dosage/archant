---
title: 'Story 4.5: Bulk edit'
type: 'feature'
created: '2026-09-23'
status: 'done'
baseline_commit: 'a8c838ee7b6c71baa9ae1833c4485dafc159d8c2'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/scaffolding-lessons.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Cleaning up an import means opening rows one by one: nothing selects several transactions, and no endpoint changes more than one row per request (FR26, UX-DR7, UX-DR9).

**Approach:** Add two bulk routes that take either `ids` or the list's filter object and run one ledger call each, then add row selection on `/operations` (checkbox, `x`, `Shift`), a bulk bar with Catégorie, Marchand, Étiquettes, Exclure, Supprimer, and `Esc` to clear.

## Boundaries & Constraints

**Always:**
- Selection body, shared by both routes: exactly one of `ids: string[]` (1 to `MAX_BULK_IDS` = 200, the list's largest page, duplicates dropped) or `filter`, the list filter without `page`/`pageSize`, parsed by the same Zod shape as the query (`repeated` accepts arrays). Both missing or both present is `400 VALIDATION_ERROR`, path `selection`.
- `POST /api/transactions/bulk-update` `{ ...selection, patch }` where `patch` has at least one of `categoryId: string | null`, `merchantId: string | null`, `addTagIds: string[]` (1 to `MAX_TAGS_PER_TRANSACTION`), `excluded: boolean`. Returns `{ data: { updated } }`, the number of matched rows.
- `POST /api/transactions/bulk-delete` `{ ...selection }`. Returns `{ data: { deleted } }`.
- Ledger: `bulkUpdateTransactions(deps, selection, patch, { origin })` and `bulkDeleteTransactions(deps, selection, { origin })`, each in one `behavior: "immediate"` transaction. Inside it, resolve the selection to entry ids once (filter through `filterCondition`), before any write, so a write never changes which rows match. Writes go in chunks of `ROWS_PER_INSERT`.
- An unknown id in `ids`, an unknown category, merchant or tag: nothing written, `400 VALIDATION_ERROR` on `ids`, `patch.categoryId`, `patch.merchantId` or `patch.addTagIds`, code `invalid_value`.
- Bulk update applies the same rules as `updateTransaction` with `origin: "user"`: a field changes only where the value differs, a changed field joins `locked_fields`, `category_origin` becomes `user` (null when the category is cleared). `addTagIds` adds to each row's set, never removes, and a row that would exceed `MAX_TAGS_PER_TRANSACTION` fails the whole call on `patch.addTagIds`. Extract the per-row logic from `updateTransaction` rather than copying it.
- Classification and exclusion move no balance: bulk update never calls `recomputeBalances`.
- Bulk delete removes `entry_keys`, `taggings`, `transactions`, then `entries`, as `deleteTransaction`, then calls `recomputeBalances` once per affected account from its earliest deleted date, as `revertImport`.
- Selection lives in `/operations` only; `TransactionList` takes it as optional props, so `/comptes/$accountId` is unchanged. It holds ids of the current page, or « all results » for the current filters. Changing a filter or the page clears it; a successful action clears it; a failed one keeps it and shows `showErrorToast`.
- Row: a `Checkbox` before the label with `aria-label` « Sélectionner « {label} » », 24 px target, visible on touch screens. `Shift`+click selects the range from the last toggled row.
- Keys, listed in `SHORTCUTS` and the `?` dialog: `x` toggles the focused row; `Shift+j`, `Shift+k`, `Shift+ArrowDown`, `Shift+ArrowUp` move and add the reached row; `Esc` clears the selection when no layer is open. With a selection, `c`, `m`, `t` open the bar's picker instead of the row's. Update the comment on `hasForeignModifier`.
- Bulk bar, fixed at the bottom of `/operations` while a row is selected, as in `key-transactions.html`: « N sélectionnée(s) » in an `aria-live` region, « Tout sélectionner (N résultats) » while the selection is not already every result, then Catégorie (`CategoryCombobox`), Marchand (`MerchantCombobox`), Étiquettes (`TagCombobox`, applied once on close if the draft is not empty), Exclure (menu: « Exclure des rapports », « Réintégrer dans les rapports »), Supprimer.
- Supprimer opens `ConfirmDialog` with the count, confirm label `deleteTransactions_*` (« Supprimer 12 opérations »), focus on Annuler.
- After an action: invalidate `transactions.all` and the category, merchant and tag counts; toast with the count, e.g. « Catégorie modifiée sur 9 opérations ». No optimistic update.
- No undo after a bulk action, as in Sure: the toast only states the count, and a wrong bulk edit is fixed by another one.

**Never:** no bulk edit of date, amount, label or notes; no tag removal in bulk; no selection on the account page; no selection kept across pages or filters; no page-level checkbox; no `Backspace` delete; no `ON DELETE cascade`; no route reading more than one service function.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Category by ids | 3 ids, `categoryId: C` | 3 rows on C, `category` locked, origin `user`, balances untouched | — |
| Clear merchant | `merchantId: null` | Merchant unlinked, `merchant` locked | — |
| Add tags | Row tagged A, `addTagIds: [B]` | Row tagged A and B, `tags` locked | — |
| Tag cap | Row with 20 tags, `addTagIds: [new]` | Nothing written | `400`, `patch.addTagIds` |
| Unchanged row | Row already on C | Not re-locked, counted in `updated` | — |
| By filter | `filter: { category: ["none"] }`, set C | Every uncategorised row, all pages, on C | — |
| Empty match | Filter matches nothing | `updated: 0` | — |
| Unknown id | 2 real ids + 1 unknown | Nothing written | `400`, `ids`, `invalid_value` |
| Both or neither | `ids` and `filter`, or none | Nothing written | `400`, `selection` |
| Delete over two accounts | Rows in A and B | Rows, keys and taggings gone; balances of A and B recomputed once each | — |
| Exclude | `excluded: true` | Rows excluded, `excluded` locked, no balance rewrite | — |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/ledger.ts` -- `recomputeBalances` 155 (private, one account), `ROWS_PER_INSERT` 107, `chunksOf` 112, `inSequence` 119, `TransactionPatch` 895, `PATCH_KEY_OF` 910, `updateTransaction` 981 (lock loop 995-1004, checks 1008-1048, `touchesEntry` 1069, lock union 1093, taggings 1100-1108) to split into a per-row helper, `deleteTransaction` 1124 (delete order), `revertImport` 1348 (chunked deletes 1395-1403, per-account recompute 1449-1456), `TransactionFilter` 1677, `filterCondition` 1761 (`null` means no match).
- `packages/api/src/schemas/transactions.ts` -- `MAX_TAGS_PER_TRANSACTION` 9, patch body 25, `repeated` 204, `transactionFilterSchema` 217 (built on `pageQuerySchema`: split the filter fields out so the body reuses them).
- `packages/api/src/services/transactions.ts` -- filter mapping inline in `listAllTransactions` 200-209 (`amountsFor` 155, `categoryFilterOf` 175 expands children): extract a `filterOf` used by the list and the bulk services.
- `packages/api/src/routes/transactions.ts` -- GET 16, PATCH 25, DELETE 38; add the two POST routes before `/:id`.
- Tests: `ledger.spec.ts` `add` 222, `lockedFields` 260, `history` 243; `app.spec.ts` `request` 246, `openAccount` 256, `postTransaction` 266, `balanceOf` 270.
- `packages/web/src/components/TransactionList.tsx` -- day `<section>`/`<ul>` 237-245, `<li>` 258-262 (two lines below `md`), row button 272-328, `focusedRowId` 176, `c`/`m`/`t` 184-220, `closeRowPicker` 222. `hooks/useListNavigation.ts` moves focus through `[data-transaction-id]`.
- `packages/web/src/lib/shortcuts.ts` -- `SHORTCUTS` 15-130, `hasForeignModifier` 164, `isLayerOpen` 235, `stepIndex` 256. `hooks/useShortcut.ts` (`when`, `enabled`).
- `packages/web/src/hooks/useTransactions.ts` -- `ROW_FIELDS` 109 (toast texts), `useSetRowField` 136 (error path to copy), `useDeleteTransaction` 219. `lib/query-keys.ts`.
- `packages/web/src/lib/transaction-filters.ts` -- `filtersOf` 100, `toApiQuery` 120: the bulk body sends `filtersOf(search)`.
- `packages/web/src/routes/_authed.operations.tsx` -- results block 200-226 (`data.total`), list 265-271, `Pagination` 273.
- Reuse: `CategoryCombobox`, `MerchantCombobox`, `TagCombobox`, `ConfirmDialog`, `ui/checkbox.tsx`, `ui/dropdown-menu.tsx`. Mockup `_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/mockups/key-transactions.html` 199-216, 316-349, 651-659.
- `packages/web/src/locales/fr.json` -- `deleteTransactions_one/_other` 474, `transactions.*.changed` for wording.
- `packages/web/e2e/fixtures.ts` -- `addTransaction` 141, `createCategory` 220, `createMerchant` 248, `createTag` 272, `setTags` 284; `e2e/keyboard.spec.ts:369-385` exact help list.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/services/ledger.spec.ts` -- failing tests first, one per matrix row, plus a 5 000-row filter update inside one transaction.
- [x] `packages/api/src/services/ledger.ts` -- per-row helper out of `updateTransaction`; `bulkUpdateTransactions`, `bulkDeleteTransactions`.
- [x] `packages/api/src/schemas/transactions.ts`, `schemas/transactions.spec.ts` -- filter fields split out, selection and patch schemas, `MAX_BULK_IDS`.
- [x] `packages/api/src/services/transactions.ts`, `routes/transactions.ts`, `app.spec.ts` -- `filterOf`, two services, two routes, route rows of the matrix.
- [x] `packages/web/src/hooks/useTransactions.ts` -- `useBulkUpdateTransactions`, `useBulkDeleteTransactions`.
- [x] `packages/web/src/hooks/useSelection.ts` -- ids or « all », anchor for `Shift`, cleared on filter or page change.
- [x] `packages/web/src/components/TransactionList.tsx`, `lib/shortcuts.ts` -- checkbox, `x`, `Shift` moves, `Esc`, `c`/`m`/`t` routed to the bar.
- [x] `packages/web/src/components/BulkBar.tsx`, `routes/_authed.operations.tsx`, `locales/fr.json` -- bar, pickers, exclusion menu, delete confirmation, toasts.
- [x] `packages/web/e2e/bulk.spec.ts`, `e2e/keyboard.spec.ts` -- one test per criterion below; help list updated.

**Acceptance Criteria:**
- Given three rows, when I tick two checkboxes, then the bar shows « 2 sélectionnées », and `Esc` hides it.
- Given a focused row, when I press `x` then `Shift+j` twice, then three rows are selected.
- Given a ticked row, when I `Shift`+click the checkbox two rows below, then three rows are selected.
- Given a selection, when I pick a category in the bar, then every selected row shows it after a reload and the selection is cleared.
- Given a selection, when I set a merchant, add a tag, and exclude, then every selected row shows the merchant, the tag and the exclusion marker.
- Given 60 uncategorised rows over two pages, when I select one, press « Tout sélectionner (60 résultats) » and set a category, then « Sans catégorie » lists none.
- Given a selection of two rows, when I press Supprimer, then the dialog's button reads « Supprimer 2 opérations », focus is on Annuler, and confirming removes the rows and updates the account balance.
- Given a rejected bulk request, when I set a category, then the rows are unchanged, the selection stays, and a destructive toast shows.

## Implementation Notes

- `useShortcut.ts` records, from a window capture listener, the key presses that began while a layer was open: Radix closes a popover on `Escape` before the shortcuts read the DOM, so the `Escape` that closed a bar picker also cleared the selection. The guard applies to every shortcut.
- Error codes: `too_big` on `patch.addTagIds` for the per-row cap, `ids_or_filter` on `selection`, `empty_patch` on `patch`.
- The bar is `sticky bottom-4` rather than `fixed`, so it keeps the content column's width beside the sidebar.
- `useSelection` resets its state during render when the scope changes, and keeps only ids still on the page, so a row deleted from its sheet never fails the next request.
- `BulkBar` awaits `mutateAsync`: a success that drops the ticked rows unmounts the bar, and `mutate`'s callbacks would then never run.
- `bulkFilterSchema` is strict: a filter key renamed on one side only would otherwise be dropped, widening « Tout sélectionner » to every transaction.
- The delete button's red darkens in the dark theme, where the bar turns light (seen in the manual check).

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|---|
| 1 | blind, edge | A filter selection resolves at request time, so rows added since the count was shown are acted on | low | Needs a write between display and confirm; no sync exists yet, and Sure acts on what it finds too | reject |
| 2 | blind | `filter: {}` selects every transaction | false | Intended: « Tout sélectionner » with no filter means every result, and the bar and dialog show that count | reject |
| 3 | blind, edge | Placeholder rows of the previous filter stay tickable under the new scope | low | `TransactionList` gets `data.items` while `shownItems` is empty; one-line fix | patch |
| 4 | edge | A ticked row that leaves the page in the same scope stays in `ids`, and the next bulk request fails on `ids` | medium | Deleting a ticked row from its sheet reaches it; filtering `ids` on `pageIds` fixes it | patch |
| 5 | blind | Grouping copies the id array per row, quadratic on large selections | low | `[...(writes.get(key)?.ids ?? []), id]` inside the immediate transaction; direct correction | patch |
| 6 | blind, edge | Bar triggers stay active while a bulk request is pending | low | `update.isPending` is not read by the triggers; a second pick sends a second write | patch |
| 7 | blind | Focus falls to `body` when the bar unmounts after an action | low | Real, but restoring focus needs new plumbing; `j` still starts from the first row | reject |
| 8 | blind | `aria-live` region mounts with its first text, so the first count may not be announced | low | The ticked checkbox announces its own state; a permanent region is extra structure | reject |
| 9 | blind | `ledger.ts` imports a constant from `schemas/transactions.ts` | false | `services/password.ts` and `services/imports.ts` already import constants from `schemas/` | reject |
| 10 | blind | The tag-cap refusal shows the generic validation toast | low | Needs a row near 20 tags; the refusal writes nothing | reject |
| 11 | blind | Unticking one row in « all » mode narrows to the page silently | low | Documented in `useSelection`; the count shows the new number | reject |
| 12 | blind, edge | Escape on the tags picker adds the draft instead of cancelling | false | Same rule as the row picker of Story 4.4: tags save when the combobox closes | reject |
| 13 | blind | Bar is `sticky` rather than `fixed` | low | Sticky stays at the viewport bottom whenever the list overflows and keeps the sidebar's width | reject |
| 14 | edge | `bulkPicker` survives the bar unmounting | low | Every close path sets it to `null`; a scope change first closes the popover | reject |
| 15 | edge | `ids` is deduplicated before its length is bounded | low | Authenticated single-household endpoint | reject |
| 16 | edge | Bulk update skips `rejectionFor` | false | `rejectionFor` guards date and amount changes, which a bulk edit cannot make | reject |
| 17 | edge | The filter's child categories resolve outside the write transaction | low | Same as the list itself; needs a category created mid-request | reject |
| 18 | verification-gap | Clearing on a filter or page change is untested | medium | No test changes the scope after ticking | patch |
| 19 | verification-gap | Unticking one row after « Tout sélectionner » is untested | medium | Reverting the `all ? pageIds` branch passes every test | patch |
| 20 | verification-gap | « Réintégrer dans les rapports » is untested | medium | Only `excluded: true` is exercised | patch |
| 21 | verification-gap | Balance refresh after a bulk delete is only seen after a full reload | medium | The test uses `page.goto` | patch |
| 22 | verification-gap | Escape closing a bar picker keeping the selection is untested | medium | Removing `beganInLayer` passes every test | patch |

## Design Notes

Resolving the filter to ids before writing is what makes « select all uncategorised, set a category » safe: an `UPDATE ... WHERE` re-evaluated after the first chunk would see fewer rows and skip the rest of the lock and tag writes.

Selection is capped at the current page for `ids` because « Tout sélectionner » covers the cross-page case without shipping ids; it also bounds the request at 200 ids, far below SQLite's bound-parameter cap.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all pass, no tracked file modified afterwards.
