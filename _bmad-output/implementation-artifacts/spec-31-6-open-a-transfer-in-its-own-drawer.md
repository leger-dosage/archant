---
title: "Story 31.6: Open a transfer in its own drawer"
type: 'feature'
created: '2026-10-21'
status: 'done'
baseline_commit: '4ca4a69ae556cff96115825e292f3f62fe4a2992'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-31-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (at `00dd977fb`) opens a transfer row in the transfer's own drawer, `transfers/show.html.erb`, never in a side's: `transactions/_transaction.html.erb` sets `open_path` to `transfer_path` whenever the row has a `Transfer`. The drawer shows the amount and `Transfer#name`, « Aperçu » with each side's account, date, amount, fee and total, « Détails » with the outflow's category when `Transfer#categorizable?`, the tags of both sides set at once (`update_tags`) and the transfer's own `notes`, and « Paramètres » with « Marquer comme récurrent » and the deletion, which keeps both sides and deletes the fees (`Transfer#destroy!`). Archant opens a transfer row in the side's transaction sheet, with « Dissocier », « Ne plus proposer » and « Marquer comme récurrent » in a « Virement » block; a transfer has no notes and its tags are set side by side.

**Approach:** `GET /api/transfers/:id` returns what the drawer shows, read by a new `services/ledger/transfer-details.ts`; `PATCH /api/transfers/:id` saves `categoryId` on the outflow and `notes` on a new `transfers.notes` column; `PUT /api/transfers/:id/tags` sets the same tags on both sides and locks them. `DELETE /api/transfers/:id` and `POST /api/transfers/:id/recurring` already do what the drawer's « Paramètres » needs. `TransactionSheet` shows a new `TransferDetails` in place of the form when the row it opens is a transfer side, so both pages keep one sheet and its focus return.

## Boundaries & Constraints

**Always:**
- Fees are the sums of the transfer's `transfer_fees` lines on each account, in integer minor units; « Total » is `-(amount + fee)` on « De », `amount - fee` on « À », shown only when that side has a fee, as Sure's `has_source_fee?`.
- The name is « Virement vers {À} », or « Paiement vers {À} » when « À » is a liability, Sure's `Transfer#name`; the header's amount is the inflow's, Sure's `amount_abs`.
- « Catégorie » shows only when the kind is `loan_payment` or `investment_contribution`, Sure's `categorizable?` (`UNCATEGORIZED_EXCLUDED_KINDS`); the API refuses one otherwise on `categoryId`, `not_categorizable`. It saves through the same lock as a sheet edit (AD-10).
- Tags replace the set on both sides and lock `tags` on both, as `update_tags`'s `lock_attr!(:tag_ids)`; an unknown tag is `400` on `tagIds`.
- Notes are trimmed, at most `NOTES_MAX_LENGTH`, blank saved as `null`; the export writes them in Sure's `Transfer.notes` and the Sure import reads them back.
- Deleting asks « Voulez-vous vraiment supprimer ce virement ? » with Sure's body, then calls `DELETE /api/transfers/:id`: both sides stay, standard, the fee lines go.
- A viewer reads the drawer, every field disabled, no « Paramètres » action (AD-21).

**Ask First:** none; the owner is unavailable and Sure settles every decision below.

**Never:** no amount or fee editing (Sure's `update_transfer_fees_and_amount` has no control in `show.html.erb`); no automatic contribution category (Story 31.7); no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Read | created transfer with both fees | `200`, each side's account, date, amount, fee; `categorizable` from the kind | unknown id: `404` |
| Category | loan payment, a category | outflow's category set and locked | unknown category: `400` on `categoryId` |
| Category refused | internal move, a category | nothing written | `400` `not_categorizable` on `categoryId` |
| Category cleared | `categoryId: null` | outflow « Non classé » | none |
| Notes | « Loyer de mars » | `transfers.notes` saved; blank → `null` | too long: `400` on `notes` |
| Tags | two tags | both sides carry both, `tags` locked on both | unknown tag: `400` on `tagIds` |
| Delete | transfer with fees | sides standard, fees deleted, balances recomputed | already gone: `404` |
| Viewer | `PATCH`, `PUT` | nothing written | `403 FORBIDDEN` |

</frozen-after-approval>

## Code Map

- `~/github/sure` `00dd977fb`: `app/views/transfers/show.html.erb`, `app/controllers/transfers_controller.rb` (`show`, `update`, `update_tags`, `destroy`), `app/models/transfer.rb` (`name`, `amount_abs`, `categorizable?`, `derived_*_fee_amount`), `app/views/transactions/_transaction.html.erb` (`open_path`), `config/locales/views/transfers/fr.yml`.
- `packages/data/schema/transfers.ts` -- `notes: text("notes")`; `packages/data/drizzle/0091_transfer_notes.sql` generated.
- `packages/api/src/schemas/transfers.ts` -- `transferPatchSchema`, `transferTagsSchema`.
- `packages/api/src/services/ledger/transfer-details.ts` -- new: `transferDetails`, `updateTransferDetails`, `setTransferTags`.
- `packages/api/src/services/transfers.ts`, `routes/transfers.ts` -- `GET /:id`, `PATCH /:id`, `PUT /:id/tags`.
- `packages/api/src/services/export.ts`, `sure-import-plan.ts`, `ledger/sure-import.ts` -- `Transfer.notes` out and in.
- `packages/app/src/components/TransferDetails.tsx` -- new: header, « Aperçu », « Détails », « Paramètres ».
- `packages/app/src/components/TransactionSheet.tsx` -- `TransferDetails` for a transfer side.
- `packages/app/src/components/TransactionLinks.tsx` -- « Marquer comme récurrent » leaves the side's block.
- `packages/app/src/hooks/useTransfers.ts` -- `useTransfer`, `useUpdateTransfer`, `useSetTransferTags`.
- `packages/app/src/locales/fr.json` -- `transfers.show.*`.
- Docs: `docs/architecture.md` AD-11, `docs/sure-parity.md` « Category of a transfer side ».

## Tasks & Acceptance

**Execution:**
- [x] `services/ledger/transfer-details.spec.ts`, `routes/transfers.spec.ts` -- tests first: the matrix.
- [x] Schema, migration, request schemas, ledger module, service, routes; export and import of notes.
- [x] `TransferDetails`, `TransactionSheet` branch, hooks, locales; « Marquer comme récurrent » moved.
- [x] e2e: open a transfer, tag it, write a note, delete it; existing transfer tests follow the drawer.
- [x] AD-11, parity row, story and sprint status to done.

**Acceptance Criteria:**
- Given a transfer row, when it is opened, then the drawer shows both sides, their fees and totals, and « Détails ».
- Given « Étiquettes » in the drawer, when a tag is picked, then both sides carry it, locked.
- Given « Supprimer le virement », when confirmed, then both sides stay as standard lines and the fee lines are gone.

## Design Notes

Assumptions taken alone, the owner unavailable, each settled by Sure:

- « virement », not Sure's « transfert », in every label, as the epic decides: « Montant du virement », « Supprimer le virement », « Voulez-vous vraiment supprimer ce virement ? ».
- A transfer row opens the drawer, a pending one included, as Sure's `open_path`; the drawer gives no way to a side's own sheet, as Sure's. « Ne plus proposer » stays on a pending row's buttons, Sure's `_transfer_match`.
- Matching from a standard transaction's sheet still shows the new link with « Dissocier » until the sheet closes; only « Marquer comme récurrent » leaves that block, as the story moves it.
- « Catégorie » saves with the user lock, as every Archant category edit (AD-10), where Sure's `update!` sets none: a rule or sync must not undo a choice made by hand.
- Fields save on change, as Sure's `auto-submit-form`; notes save on blur.
- The account names link to their account pages, as Sure's `account_path`.
- « Sans catégorie » for a blank category, the word Archant already uses everywhere, rather than Sure's « Non classé ».
- The deletion's text says the fees go too, which Sure's `destroy!` does without saying.
- « Détails » and « Paramètres » start folded and « Aperçu » open, as Sure's `DS::Disclosure` sections; « Paramètres » is left out for a viewer.

## Review Triage Log

First pass, `bmad-build` review (Blind Hunter, Edge Case Hunter, Verification Gap).

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Notes typed then closed with `Escape` are lost: no blur on unmount | medium | patch | `DetailsFields` saves pending notes in an unmount effect. |
| 2 | A refused category or tag stays on screen | low | patch | Each `onError` puts the previous value back before the toast. |
| 3 | Quick tag picks send overlapping whole-set `PUT`s that may land out of order | low | patch | `useSetTransferTags` runs in a mutation `scope` per transfer, one at a time. |
| 4 | A reopened drawer seeds « Détails » from a cached copy and may save over a newer change | medium | patch | `useTransfer` refetches on every mount and the drawer waits for it (`isFetchedAfterMount`). |
| 5 | « Ce virement n'existe plus » shown for a network or server error too | low | patch | Only `NOT_FOUND` says so; any other error shows `errors.INTERNAL_ERROR`. |
| 6 | Picking a tag or a category refetched the open picker's list and held the next `Escape` | low | patch | Found in e2e; tags and categories are marked stale (`refetchType: "inactive"`) rather than refetched under the picker. |
| 7 | `refuseSplit` on a split-line outflow is untested | medium | patch | `transfer-details.spec.ts` matches a split line to a loan and checks `TRANSACTION_SPLIT`. |
| 8 | The lock on a side whose tags were already the set is untested | low | patch | Tested after a rule-origin set that locks nothing. |
| 9 | `transferTagsSchema`'s cap and repeat dropping untested; unknown tag's field and the `404`s unchecked | low | patch | `routes/transfers.spec.ts` checks `too_big`, repeats within the cap, `tagIds` path and both `404`s. |
| 10 | AD-11 names the drawer's deletion « Dissocier » | low | patch | It names « Supprimer le virement », which calls the same route. |
| 11 | `<h4>` under the sheet's `<h2>` skips a level | low | patch | `<h3>`. |
| 12 | `SideRows` takes `amount`, `fee` and `total` beside `side` | low | patch | Computed from `side` inside. |
| 13 | A transfer side's own sheet, notes and attachments included, is unreachable from the list | low | defer | Sure's `open_path` does the same; recorded in `deferred-work.md`. |
| 14 | Imported Sure notes are neither trimmed nor capped | low | defer | Same as a transaction's imported notes; recorded in `deferred-work.md`. |
| 15 | `categoryId: null` refused on a kind that takes none, so a leftover category cannot be cleared | low | reject | The drawer never shows nor sends the field there, as Sure's form; the side's category came from before the transfer. |
| 16 | `updated_at` exported as the creation time while notes now change | low | reject | `transfers` has no update time; Sure's import reads neither. |
| 17 | Tracking files disagree with the ticked tasks | low | reject | Set to done at finalisation, in this pull request. |
| 18 | The drawer does not show a pending status nor confirm or reject | low | reject | Sure's `show.html.erb` shows neither; the row's `_transfer_match` buttons do. |
| 19 | « Ne plus proposer » and « Dissocier » in the side's sheet now lack an e2e click | low | reject | Reached only right after a pair by hand; the row's « Rejeter la correspondance » and the drawer's deletion are tested. |
| 20 | `setTransferTags` takes an `origin` only `user` passes | false | reject | Every ledger writer takes one (AD-10); a rule origin is tested. |
| 21 | A split-line outflow shows an editable category that the API refuses | low | reject | Rare, a split line paying a loan; the toast names the refusal. |
| 22 | An edit after the transfer was deleted elsewhere shows a generic toast | low | reject | `NOT_FOUND` has its own toast. |

Second pass, `bmad-code-review`: the three layers above had already reported on this diff, so only its Acceptance Auditor ran.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Sprint status and spec not `done` while the finalisation task is ticked | low | patch | Both set to `done` in this pull request. |
| 2 | The route's deletion test reads no balance, though the matrix says balances are recomputed | low | patch | `routes/transfers.spec.ts` checks each account gets its fee back. |

## Spec Change Log

- Implementation: the drawer's « Détails » saves leave the tags and categories stale rather than refetched (`refetchType: "inactive"`), and `useTransfer` refetches on every opening; both found in e2e and review, behaviour as specified.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.
