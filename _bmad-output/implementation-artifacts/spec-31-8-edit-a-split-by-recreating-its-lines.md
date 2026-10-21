---
title: "Story 31.8: Edit a split by recreating its lines"
type: 'feature'
created: '2026-10-21'
status: 'done'
baseline_commit: '6647c7ba94c1ab276b8502c11d6c3abe304a7549'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-31-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (at `00dd977fb`) edits a split by deleting every line and creating new ones: `splits_controller.rb#update` runs `@entry.unsplit!` then `@entry.split!(splits)` in one `Entry.transaction`. `Entry#split!` gives each new line the form's `name`, `amount` and `category_id`, the parent's `merchant_id` and `kind`, and nothing else: the old lines' tags, notes, attachments and locks go, and a line's transfer goes with it (`Transaction::Transferable`, `dependent: :destroy`). Sure's `split_params` permits `name`, `amount`, `category_id` and `excluded` per line, no id, no tags, no notes. Archant's `editSplit` in `packages/api/src/services/ledger/splits.ts` keeps the children named by id in place, with their tags, notes, attachments and locks, and `PUT /api/transactions/:id/split` takes per-line `id`, `tagIds` and `notes`.

**Approach:** `editSplit` checks the lines, deletes every child through `deleteTransactionRows`, which takes their keys, transfers, rejected pairs, taggings and attachments with them, then inserts the lines through `insertChildren`, in the same immediate database transaction, then recomputes balances and runs the matcher as today. `splitTransactionSchema` and `SplitLine` keep `label`, `amount` and `categoryId` only; an `id`, `tagIds` or `notes` sent on a line is stripped, as Zod strips unknown keys. `SplitDialog` stops sending ids. AD-20 and `docs/sure-parity.md` « Splits » change with the code.

## Boundaries & Constraints

**Always:**
- One immediate database transaction: a refused edit (sum, category, count, unknown split) writes nothing, the old lines intact.
- New lines get new ids, the parent's account, date, currency, merchant and one-time flag, and the locks a new split gives (`insertChildren`), never an old line's.
- A line in a transfer, confirmed or pending, loses it, the other side a standard transaction again, as deleting a side does (AD-11); the matcher then weighs the new lines, as Sure's `sync_account_later` runs `auto_match_transfers!`.
- Balances do not move: the parent stays excluded, the lines still sum to it.
- The same per-line schema for `POST` and `PUT`, Sure's `split_params`: label, amount, category.

**Ask First:** none; the owner is unavailable and Sure settles every decision below.

**Never:** no per-line exclusion (Sure's `excluded` has no field in `splits/edit.html.erb`); no fee-line clean-up for a transfer created with fees (deferred from 31.5); no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Edit | split of two lines, one tagged with a note and an attachment | two new ids, label, amount, category from the form, merchant from the parent; no tag, note or attachment on any line; balance unchanged | none |
| Ids sent | a line with the id of a current child, or of another split | ignored: a new line is created | none |
| Tags or notes sent | a line with `tagIds` or `notes` | stripped, the line untagged and without notes | none |
| Transfer | a line paired with another account's inflow | the transfer and rejected pairs go; the other side stands unpaired or is proposed again to a new line | none |
| Refused | lines not summing to the parent | nothing written, the old lines and their tags intact | `400` `split_sum_mismatch` on `lines` |
| Unknown | an unsplit or unknown id | nothing written | `404` |

</frozen-after-approval>

## Code Map

- `~/github/sure` `00dd977fb`: `app/controllers/splits_controller.rb` (`update`, `split_params`), `app/models/entry.rb` (`split!`, `unsplit!`), `app/models/transaction/transferable.rb`, `app/views/splits/edit.html.erb`.
- `packages/api/src/services/ledger/splits.ts` -- `editSplit` deletes and recreates; `updateChild` and the id check of `checkLines` go; `SplitLine` loses `id`, `tagIds`, `notes`.
- `packages/api/src/schemas/transactions.ts` -- `splitTransactionSchema` loses `id`, `tagIds`, `notes`.
- `packages/app/src/components/SplitDialog.tsx` -- no line id sent; the comments that promised kept tags go.
- Tests: `services/ledger/splits.spec.ts`, `services/ledger/attachments.spec.ts`, `routes/transactions.spec.ts`, `packages/app/e2e/` split test.
- Docs: `docs/architecture.md` AD-20, `docs/sure-parity.md` « Splits ».

## Tasks & Acceptance

**Execution:**
- [x] `splits.spec.ts`, `attachments.spec.ts`, `routes/transactions.spec.ts` -- tests first: the matrix.
- [x] `editSplit`, `SplitLine`, `checkLines`, `splitTransactionSchema`.
- [x] `SplitDialog` sends no id.
- [x] e2e: edit a split whose line carries a tag, the tag gone.
- [x] AD-20, parity row, story and sprint status to done.

**Acceptance Criteria:**
- Given a split whose lines carry tags, notes or attachments, when « Modifier la division » is saved, then every line has a new id and none carries them.
- Given a line in a transfer, when the split is edited, then the transfer is gone.
- Given `PUT /api/transactions/:id/split` with line ids, when it runs, then it ignores them.

## Design Notes

Assumptions taken alone, the owner unavailable, each settled by Sure:

- Per-line `tagIds` and `notes` leave `POST` as well as `PUT`: Sure's `split_params` permits neither, the dialog never sent them, and one line schema serves both routes. A line's tags and notes stay editable in its own sheet, as Sure's drawer.
- The new lines keep Archant's locks of a fresh split (date, amount, label, exclusion, category when set), where Sure's `split!` locks nothing on a child: the same reason as Story 31.3, a sync or rule must not undo a split made by hand (AD-10).
- The dialog gives no warning that tags and notes go: Sure's `splits/edit.html.erb` gives none.
- An old line's transfer is deleted, not moved to the new line with the same amount; the matcher may propose it again as pending, as Sure's `auto_match_transfers!` after `sync_account_later`.

## Review Triage Log

First pass, `bmad-build` review (Blind Hunter, Edge Case Hunter, Verification Gap).

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | `transactions.ts` `editSplit` and `useEditSplit` comments still promise children kept by id | low | patch | Both say every line is deleted and created again. |
| 2 | The ledger test title still names tags, too many tags and an id | low | patch | « refuses an unknown category on its line ». |
| 3 | No test shows `POST` ignoring `tagIds` and `notes`, nor `PUT` leaving `notes` null | low | patch | `routes/transactions.spec.ts` sends both on `POST` and `PUT` and checks `tagIds: []` and `notes: null`. |
| 4 | The edit deletes the lines' attachments without the warning « Annuler la division » gives | low | reject | Sure's `splits/edit.html.erb` warns of nothing, and `unsplit!` destroys the children with their attachments; the story asks for Sure's edit. |
| 5 | A save without change still recreates the lines, dropping tags, notes, attachments and a confirmed transfer | low | reject | Sure's `update` does the same on every save; the story's first criterion. |
| 6 | Rejected pairs go with the old lines, so the matcher may propose a rejected pairing again | low | reject | Sure's `Transaction::Transferable` destroys `rejected_transfer_as_*` with the line, then `auto_match_transfers!` runs; tested. |
| 7 | The counterpart's one-time flag is no longer cleared when a line's transfer goes | low | reject | Deleting a side keeps it too (`deleteTransactionRows`, `edits.ts`), as Sure's `dependent: :destroy` runs no `Transfer#destroy!`; the story says « as deleting a side does ». |
| 8 | A stale dialog in another tab overwrites a concurrent edit, line ids no longer refusing it | low | reject | Sure's `update` takes no ids either; one household, one administrator. |
| 9 | AD-17 « An entry's id never changes » contradicts new line ids | false | reject | AD-17 is about a row replaced by another (absorb); a recreated split line is a deleted entry and a new one, as an unsplit then a split. |
| 10 | The refusal test checks the old lines' ids and tags, not their notes, attachments, locks or transfer | low | reject | `checkLines` refuses before any write, in one immediate transaction. |
| 11 | Editing from a line's sheet deletes the open line | low | reject | The same path as « Annuler la division » from a line, which `onDone` closes and e2e covers. |
| 12 | The export test does not check its new `PATCH` status | false | reject | The CSV expectations read « Reçu » and « Fruits », which only that `PATCH` writes. |
| 13 | `insertChildren`'s « locks what a manual entry locks » is now wrong | false | reject | A line has no notes or tags at creation, so the list is what a manual entry with them empty locks. |
| 14 | Clients sending `tagIds` or `notes` on a line lose them silently: `breaking-change` | low | reject | The interface never sent them and no assistant tool splits; an upgrade needs no action. |
| 15 | Tracking files disagree with the spec | low | reject | Set to done at finalisation, in this pull request. |

Second pass, `bmad-code-review`: the three layers above had already reported on this diff, so only its Acceptance Auditor ran.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Sprint status `review` while the spec reads `done` and its last task is unticked | low | patch | Both set to `done` in this pull request. |
| 2 | The edit's transfer test never shows the rejected pair existed before | low | patch | It checks one rejected pair before the edit. |
| 3 | No edit test starts from a pending transfer | low | reject | The same `deleteTransactionRows` call; a pending line's transfer going is tested by the unsplit and deletion tests. |
| 4 | No test for an id of another split, nor a line paying a bill | low | reject | Ids are stripped before the ledger, as the route test shows; a bill payment's link is `ON DELETE SET NULL` (AD-24), as when a side is deleted. |
