---
title: "Story 31.2: Edit several transactions at once as Sure"
type: 'feature'
created: '2026-10-18'
status: 'done'
baseline_commit: 'b3dbe9e371e57c734a6e3318f48e920ca5de344e'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-31-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (at `00dd977fb`) edits a selection in a drawer, `transactions/bulk_updates/new.html.erb`, that sets the date, name, notes, category, merchant and tags of every selected line (`Entry.bulk_update!`): a blank field changes nothing (`compact_blank`), the tags replace the set when the field was sent (`tags_provided?`), a split parent is skipped and its lines take everything but the date, and every saved field is locked. Archant's bulk bar instead sets a category or a merchant, adds tags and excludes, each from its own popover.

**Approach:** The bar keeps « Tout sélectionner » and « Supprimer », loses its category, merchant, tags and exclusion controls, and gains « Modifier », which opens a drawer with Sure's fields. `POST /api/transactions/bulk-update` keeps its `ids` or `filter` selection and takes `patch: { date, name, notes, categoryId, merchantId, tagIds }`; the ledger's `bulkUpdateTransactions` applies them as `Entry.bulk_update!`, through `changeOf` so every changed field is locked with `origin: "user"` (AD-10), and recomputes each account whose dates moved once. The assistant's `bulk_update_transactions` takes the same patch, without the date, as `update_transaction` never moves one.

## Boundaries & Constraints

**Always:**
- A blank or whitespace field is absent; at least one field must remain, else `400 empty_patch` as today. `tagIds` present, `[]` included, replaces each line's set; absent keeps it. `patch` is strict: `excluded`, `addTagIds` or any other key is a `400`.
- A selected split parent is skipped and not counted in `updated`; a split line takes every field but the date (AD-20). A transfer side the dashboard does not count keeps its category, as today (`categoryHidden`).
- Unknown category, merchant or tag: `400` on `patch.categoryId`, `patch.merchantId`, `patch.tagIds`; a date more than a year ahead, `isTooFarAhead`: `400 date_too_late` on `patch.date`. Nothing is written then.
- A date change rewrites `entries.date` and recomputes each touched account once from its earliest old or new date, as `bulkDeleteTransactions` does; a transfer keeps its pairing.
- Visible text in Archant's words for the same thing (owner's rule): « Libellé » where Sure says « Nom », « Étiquettes » and « Notes » where Sure's bulk drawer says « Balises » and « Remarques », « opérations » where Sure says « transactions ».
- Every write control stays admin-only; the bar already mounts for an administrator alone.

**Never:** no migration, no new dependency; no bulk exclusion; no way to clear a category or a merchant in bulk (Sure's `compact_blank` has none); no category creation from the drawer (the parity row « Creating a category from the pickers » keeps the bulk picker without it); no change to `bulk-delete`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Date and name | three lines, `{ date, name }` | all three moved and renamed, `date` and `label` locked, balances follow | none |
| Split | a parent and its two lines selected, `{ date, name }` | parent untouched, lines renamed, lines keep their date; `updated` 2 | none |
| Tags replaced | lines tagged A, `{ tagIds: [B] }` | each line tagged B only, `tags` locked | none |
| Tags cleared | `{ tagIds: [], name }` | every tag removed | none |
| Tags untouched | `{ notes }` on tagged lines | tags kept | none |
| Blank | `{ name: "  " }` alone | nothing written | `400 empty_patch` |
| Exclusion | `{ excluded: true }` | nothing written | `400` unrecognised key |
| Far date | date two years ahead | nothing written | `400 date_too_late` on `patch.date` |

</frozen-after-approval>

## Code Map

- `~/github/sure` `00dd977fb:app/controllers/transactions/bulk_updates_controller.rb`, `app/models/entry.rb#bulk_update!`, `app/views/transactions/bulk_updates/new.html.erb` (sections « Aperçu »: date, max today; « Opérations »: name, category, merchant, tags, notes; « Annuler », « Enregistrer »), `app/views/transactions/_selection_bar.html.erb`, `config/locales/views/transactions/fr.yml` `bulk_updates.new`.
- `packages/api/src/schemas/transactions.ts` -- `bulkPatchSchema`: strict, `date` (`entryDateSchema`), `name` (trim, `LABEL_MAX_LENGTH`), `notes` (trim, `NOTES_MAX_LENGTH`), `categoryId`, `merchantId`, `tagIds` (deduplicated, at most `MAX_TAGS_PER_TRANSACTION`); blank strings read as absent; `empty_patch` kept.
- `packages/api/src/services/ledger/edits.ts` -- `BulkPatch` (`date`, `label`, `notes`, `categoryId`, `merchantId`, `tagIds`), `bulkUpdateTransactions`: skip `split && parentEntryId === null` after `selectedRows` (the ids check and `expectedCount` keep the selection's count); per-row patch through `changeOf`/`detailOf`/`writeKeyOf`; entries' date in chunks; taggings deleted then inserted for rows whose tags changed; `recomputeBalances` per account as `bulkDeleteTransactions`. Reuse `isTooFarAhead` (`domain/statement.ts`), `today`, `minDate`.
- `packages/api/src/services/transactions.ts` -- `bulkUpdateTransactions` maps `name` to the ledger's `label`; doc comment.
- `packages/api/src/schemas/assistants/transactions.ts` -- `bulkUpdateTransactionsInput.patch`: `category_id`, `merchant_id`, `tag_ids` (replacing), `name`, `notes`, strict; description. `packages/api/src/mcp/transactions.ts` -- tool title and description; `mcp/server.ts` instructions if they name adding tags or exclusion.
- `packages/app/src/components/BulkBar.tsx` -- remove pickers and « Exclure »; « Modifier » opens `BulkEditSheet`.
- `packages/app/src/components/BulkEditSheet.tsx` (new) -- `Sheet` framed as `TransactionSheet`; `InsetGroup` « Aperçu » then « Opérations »; `DateField` (max today), `Input`, `CategoryField`, `MerchantField`, `TagsField`, notes `textarea`; sends only filled fields, `tagIds` only once touched; nothing filled closes without a request; success clears the selection, closes, toasts the count.
- `packages/app/src/components/TransactionFields.tsx` -- optional `placeholder` on `CategoryField`/`MerchantField` (shown for `null`, combobox without « Sans … ») and `TagsField` (shown while untouched); `MerchantCombobox` gains `allowNone` like `CategoryCombobox`.
- `packages/app/src/hooks/useTransactions.ts` -- `useBulkUpdateTransactions` invalidates balances too.
- `packages/app/src/locales/fr.json` -- `operations.bulk.edit`, drawer keys, `updated_one|other`; drop the removed bar keys.
- Tests: `services/ledger/edits.spec.ts`, `routes/transactions.spec.ts`, `schemas/transactions.spec.ts`, `mcp/server.spec.ts`, `mcp/transactions.spec.ts`, `ledger/transfers.spec.ts`, `ledger/filter.spec.ts`, `recurring/series.spec.ts`, `app.spec.ts`; `packages/app/e2e/bulk.spec.ts`.
- Docs: `docs/sure-parity.md` « Bulk edit » Parity and « Creating a category from the pickers »; `docs/deployment.md` and `docs/security-model.md` sentences on `bulk_update_transactions`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/services/ledger/edits.spec.ts`, `routes/transactions.spec.ts`, `schemas/transactions.spec.ts` -- tests first: the matrix, the locks, balances after a date move, a split parent skipped by ids.
- [x] `schemas/transactions.ts`, `services/ledger/edits.ts`, `services/transactions.ts` -- implement.
- [x] `schemas/assistants/transactions.ts`, `mcp/transactions.ts`, `mcp/server.ts` + specs -- the tool's new patch; other specs calling the ledger follow.
- [x] `TransactionFields.tsx`, `MerchantCombobox.tsx`, `BulkEditSheet.tsx`, `BulkBar.tsx`, `useTransactions.ts`, `fr.json` -- interface.
- [x] `packages/app/e2e/bulk.spec.ts` -- bar buttons, two lines renamed and tagged through the drawer, rejected request keeps the selection; drop the picker tests.
- [x] Docs, story and sprint status to done.

**Acceptance Criteria:**
- Given two ticked rows, when « Modifier » opens the drawer « Modifier les opérations » and a libellé and a tag are saved, then both rows show them, the toast says « 2 opérations modifiées » and the selection clears.
- Given the drawer, when nothing is filled and « Enregistrer » is pressed, then it closes and nothing is sent.

## Implementation Notes

Decisions taken alone, the owner unavailable, each aligned with Sure:

- `bulkPatchSchema` reads a blank `categoryId` or `merchantId` as absent too, as Sure's `compact_blank` does for every field; `null` is a `400 invalid_type`, since nothing clears them in bulk.
- The ledger matches only what it edits: a selected split parent is left out of `matched` (the API's `updated`), as Sure's `excluding_split_parents` before `all.size`; `expectedCount` keeps comparing the whole selection, parents included. A filter never selects a parent, so through the list both counts agree.
- A transaction converted into a trade is a parent in AD-20's sense, so a bulk edit by ids skips it too; no list or filter shows it.
- The per-row tag cap check went: `tagIds` replaces the set and the schema already caps it at `MAX_TAGS_PER_TRANSACTION`.
- The drawer offers no creation in the merchant picker either, as Sure's bulk `collection_select`, beside the category picker the spec names; `CategoryField` and `MerchantField` drop « Sans … » and creation once given a `placeholder`.
- Review fixes, as Sure's selects: the category and merchant pickers list their placeholder first, which returns the field to « unchanged » (`noneLabel` on both comboboxes); the tags list « Aucune étiquette » first (`onNone` on `TagCombobox`), the only way to clear, and a set emptied by unticking is « unchanged » again. The bulk mutation refreshes balances only when the patch carries a date.
- The e2e date test moves two rows onto the account's opening date: its valuation sets that day's balance, as Sure's, so the sidebar balance changes and shows the refresh without a reload; a move between two ordinary days leaves today's balance as it was.
- Placeholders: Sure's prompts in Archant's words (« Entrez un libellé qui sera appliqué aux opérations sélectionnées », « Sélectionnez un marchand » where Sure says « commerçant », « Saisissez une note qui sera appliquée aux opérations sélectionnées »). For the untouched tags Sure shows « (aucun) », its blank option; « Sélectionnez des étiquettes » is used instead, so an untouched field never reads like the « Aucune étiquette » that a touched, emptied one sends.
- The drawer's description, « Un champ laissé vide ne change rien. », states Sure's `compact_blank` for a screen reader and a sighted user alike; Sure's drawer has none.
- A refused save keeps the drawer open with the hook's toast, and shows a `patch.date`, `patch.name` or `patch.notes` field error under its field; « Annuler » or Escape then closes it, the selection kept.
- `docs/architecture.md` AD-20 gains one sentence on bulk edit, the epic's technical decision.
- The e2e test that closes the drawer with Escape waits for focus in the date field first: pressed in the same frame the drawer mounts, Escape reached the page before Radix listened for it.

## Spec Change Log

## Review Triage Log

First pass, `bmad-build` review (Blind Hunter, Edge Case Hunter, Verification Gap).

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Ticking then unticking a tag leaves `[]`, which clears every row's tags; nothing returns to « unchanged » (two layers) | medium | patch | « Aucune étiquette » first, as Sure's blank option, is the only way to clear; a set emptied by unticking is untouched again. |
| 2 | A chosen category or merchant cannot go back to « unchanged » | low | patch | The placeholder is the list's first item, as Sure's prompt, resetting to `null`. |
| 3 | The drawer caps the date at today, the API at a year ahead | low | reject | The drawer is Sure's `max: Date.current`; the API keeps the single edit's `isTooFarAhead`. |
| 4 | A date before the account's opening is not checked | false | reject | The single edit checks none either; both recompute from the earlier date. |
| 5 | Per-account recompute tested on one account only (two layers) | medium | patch | Test moving rows of two accounts, both histories checked. |
| 6 | Every bulk edit refreshes every balance | low | patch | Only when the patch carries a date. |
| 7 | The API and tool changes are breaking, unlabelled | low | reject | The route is the interface's own; an assistant reads the tool schema each session, whose description says `tag_ids` replaces. Said in the pull request, as Story 31.1. |
| 8 | `docs/security-model.md` still lists bulk exclusion | low | patch | Reworded: all but the exclusion in bulk. |
| 9 | The toast counts matched rows, not changed ones | low | reject | Sure's notice says `all.size` updated. |
| 10 | `expectedCount` with a parent selected by ids untested | false | reject | `expected_count` is refused with ids, and a filter never selects a parent. |
| 11 | Drawer's date, notes, merchant and the balance after a move untested end to end (two layers) | medium | patch | E2e moves two rows onto the opening day, sets notes and a merchant, the sidebar balance follows. |
| 12 | Spec `in-review` while sprint status says done; `last_updated` goes back | low | patch | Both set to done after review; timestamp refreshed. |
| 13 | Over-long comment line in `services/transactions.ts` | low | patch | Rewrapped. |
| 14 | Closing the drawer mid-save and saving again races the first request | low | reject | Needs lifting the mutation into the bar; a household's one administrator, and the second write is the same edit. |
| 15 | A selection of split parents alone reports 0 and clears | low | reject | Sure's `bulk_update!` does the same. |
| 16 | « its lines take the edit » reads as if picking a parent edits its lines | low | patch | Tool description, comments and docs say a selected line takes every field but the date. |

Second pass, `bmad-code-review` (Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor). Every patch applied.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | A date typed past today is sent, while the parity row says « at most today » (two layers) | low | patch | Sure's `max` limits the picker; the row now says the calendar stops at today. The API keeps the single edit's year ahead. |
| 2 | « Today » read in the browser's time zone | low | reject | Only the calendar's last day; the server judges with `APP_TIMEZONE`. |
| 3 | The drawer still creates tags | low | reject | Harmless, and the bar created them before; Sure's bulk select lists existing tags. |
| 4 | `last_updated` goes back | false | reject | The previous value was ahead of the clock; the new one is the real time. |
| 5 | Code Map names files the diff leaves untouched | low | reject | The fix edits the spec under review. |
| 6 | Assistant instructions and security model omit bulk rewrites | low | patch | `docs/security-model.md` names the labels, notes and tags a bulk update rewrites; the tool description already says what each field replaces. |
| 7 | No schema test of the patch's length caps, nor route or tool test of a skipped parent | low | reject | Caps are the single edit's fields; the skip is covered in the ledger. |
| 8 | Unknown category, merchant or tag shows a toast, not a field error | low | reject | Only after another tab deletes the item; the toast names the failure. |
| 9 | Toast counts child lines whose date did not move | low | reject | Sure's notice counts `all.size` alike. |
| 10 | `pickCategory`'s comment names `typed` | low | patch | Says `search`. |
| 11 | Closing the drawer mid-save then saving again (Edge Case Hunter) | low | reject | Carried from the first pass, #14. |
| 12 | Field errors under the drawer's fields untested | low | defer | Verification Gap's disposition; server paths covered. |
| 13 | Balances refreshed only for a date, unlike the Code Map | false | reject | Deliberate, first pass #6: only a date moves a balance. |
| 14 | `MerchantCombobox` gained `noneLabel`, not `allowNone` | false | reject | `allowNone` already existed. |

## Design Notes

Assumptions taken alone, the owner unavailable, each settled by Sure or Archant's words:

- Words: the story names « Nom » and « Modifier les transactions », Sure's; Archant's transaction drawer says « Libellé » and the bar « opérations », and the owner's standing rule keeps Archant's word for the same thing, as Story 28.16 kept « Exclure des rapports ».
- The assistant's bulk tool follows the same patch so one ledger path remains; it takes no date, as `update_transaction`, so a label read by an assistant never moves money.
- The tags lock follows AD-10's single edit, locking a cleared set too, where Sure's bulk locks tags only when some remain.
- An empty submit closes without a request, where Sure posts and reports 0: the API keeps refusing an empty patch, which the assistant relies on.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.
